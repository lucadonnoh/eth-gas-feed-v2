import { GET } from '../route';
import { pool, BlockRow } from '@/lib/db';

// Mock the database pool
jest.mock('@/lib/db', () => ({
  pool: {
    query: jest.fn(),
  },
  rowToBlock: (row: BlockRow) => ({
    blockNumber: Number(row.block_number),
    gasLimit: Number(row.gas_limit),
    gasUsed: Number(row.gas_used),
    baseFee: Number(row.base_fee),
    blobCount: Number(row.blob_count),
    blobBaseFee: Number(row.blob_base_fee),
    excessBlobGas: Number(row.excess_blob_gas),
    timestamp: row.created_at,
  }),
}));

describe('/api/blocks', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Recent blocks (no params)', () => {
    it('should return recent blocks with default limit', async () => {
      const mockBlocks = [
        {
          block_number: '100',
          gas_limit: '30000000',
          gas_used: '15000000',
          base_fee: '50000000000',
          blob_count: '3',
          blob_base_fee: '1000000',
          excess_blob_gas: '500000',
          created_at: new Date(),
        },
      ];

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: mockBlocks }) // Main query
        .mockResolvedValueOnce({ rows: [{ block_number: '100' }] }); // Latest block query

      const request = new Request('http://localhost:3000/api/blocks');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.blocks).toHaveLength(1);
      expect(data.blocks[0].blockNumber).toBe(100);
      expect(data.latestBlock).toBe(100);
    });
  });

  describe('Time range queries', () => {
    it('should return all blocks for 1h time range (no bucketing)', async () => {
      const mockBlocks = Array.from({ length: 300 }, (_, i) => ({
        block_number: String(1000 + i),
        gas_limit: '30000000',
        gas_used: '15000000',
        base_fee: '50000000000',
        blob_count: 3,
        blob_base_fee: '1000000',
        excess_blob_gas: '500000',
        created_at: new Date(),
        block_timestamp: new Date(),
      }));

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: mockBlocks }) // All blocks query
        .mockResolvedValueOnce({ rows: [{ block_number: '1300' }] }); // Latest block query

      const request = new Request('http://localhost:3000/api/blocks?timeRange=1h');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.blocks.length).toBe(300); // All blocks for 1h (~300)

      // Verify the query does NOT use bucketing for 1h
      const queryCall = (pool.query as jest.Mock).mock.calls[0];
      expect(queryCall[0]).toContain('SELECT * FROM blocks');
      expect(queryCall[0]).toContain('WHERE block_timestamp IS NOT NULL');
      expect(queryCall[0]).toContain("INTERVAL '1 hour'");
      expect(queryCall[0]).not.toContain('GROUP BY'); // No bucketing
    });

    it('should return bucketed data for 4h time range', async () => {
      const mockBucketedBlocks = Array.from({ length: 48 }, (_, i) => ({
        block_number: String(2000 + i),
        min_block: String(2000 + i * 5),
        max_block: String(2000 + i * 5 + 4),
        gas_limit: '30000000',
        gas_used: '15000000',
        base_fee: '50000000000',
        blob_count: 3,
        blob_base_fee: '1000000',
        excess_blob_gas: '500000',
        created_at: new Date(),
      }));

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: mockBucketedBlocks })
        .mockResolvedValueOnce({ rows: [{ block_number: '2048' }] });

      const request = new Request('http://localhost:3000/api/blocks?timeRange=4h');
      const response = await GET(request);
      await response.json();

      expect(response.status).toBe(200);

      // Verify 5-minute buckets (300 seconds) and correct aggregations
      const queryCall = (pool.query as jest.Mock).mock.calls[0];
      expect(queryCall[0]).toContain('/ 300');
      expect(queryCall[0]).toContain('AVG(gas_limit)'); // Average limit
      expect(queryCall[0]).toContain('SUM(gas_used)'); // Total gas used
      expect(queryCall[0]).toContain('AVG(base_fee)'); // Average fee
      expect(queryCall[0]).toContain('SUM(blob_count)'); // Total blobs
      expect(queryCall[0]).toContain('AVG(blob_base_fee)'); // Average blob fee
      expect(queryCall[0]).toContain('AVG(excess_blob_gas)'); // Average excess
      expect(queryCall[0]).toContain('MIN(block_number)'); // Block range
      expect(queryCall[0]).toContain('MAX(block_number)'); // Block range
    });

    it('should return error for invalid time range', async () => {
      const request = new Request('http://localhost:3000/api/blocks?timeRange=invalid');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid timeRange. Use: 1h, 4h, 12h, or 24h');
    });

    it('should only query blocks with timestamps', async () => {
      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: [] })
        .mockResolvedValueOnce({ rows: [{ block_number: '1000' }] });

      const request = new Request('http://localhost:3000/api/blocks?timeRange=1h');
      await GET(request);

      const queryCall = (pool.query as jest.Mock).mock.calls[0];
      expect(queryCall[0]).toContain('WHERE block_timestamp IS NOT NULL');
    });
  });

  describe('Cursor-based pagination', () => {
    it('should return blocks after cursor', async () => {
      const mockBlocks = [
        {
          block_number: '101',
          gas_limit: '30000000',
          gas_used: '15000000',
          base_fee: '50000000000',
          blob_count: '3',
          blob_base_fee: '1000000',
          excess_blob_gas: '500000',
          created_at: new Date(),
        },
      ];

      (pool.query as jest.Mock)
        .mockResolvedValueOnce({ rows: mockBlocks })
        .mockResolvedValueOnce({ rows: [{ block_number: '101' }] });

      const request = new Request('http://localhost:3000/api/blocks?after=100&limit=50');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.blocks[0].blockNumber).toBe(101);

      const queryCall = (pool.query as jest.Mock).mock.calls[0];
      expect(queryCall[0]).toContain('WHERE block_number > $1');
      expect(queryCall[1]).toEqual([100, 50]);
    });
  });

  describe('Error handling', () => {
    it('should return 500 on database error', async () => {
      (pool.query as jest.Mock).mockRejectedValueOnce(new Error('Database connection failed'));

      const request = new Request('http://localhost:3000/api/blocks');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(500);
      expect(data.error).toBe('Failed to fetch blocks');
    });
  });
});
