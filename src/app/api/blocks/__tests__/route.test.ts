import { GET } from '../route';
import { pool, BlockRow } from '@/lib/db';

// Mock the database pool
jest.mock('@/lib/db', () => ({
  pool: {
    query: jest.fn(),
  },
  rowToBlock: (row: BlockRow) => ({
    block: Number(row.block_number),
    gasLimit: Number(row.gas_limit),
    gasUsed: Number(row.gas_used),
    baseFee: Number(row.base_fee),
    blobCount: Number(row.blob_count),
    blobBaseFee: Number(row.blob_base_fee),
    excessBlobGas: Number(row.excess_blob_gas),
    timestamp: row.created_at?.toISOString(),
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

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockBlocks });

      const request = new Request('http://localhost:3000/api/blocks');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.blocks).toHaveLength(1);
      expect(data.blocks[0].block).toBe(100);
      // latestBlock is now derived from result set, not a separate query
      expect(data.latestBlock).toBe(100);
    });
  });

  describe('Time range queries', () => {
    it('should return all blocks for 30m time range (no bucketing)', async () => {
      const mockBlocks = Array.from({ length: 150 }, (_, i) => ({
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

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockBlocks });

      const request = new Request('http://localhost:3000/api/blocks?timeRange=30m');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.blocks.length).toBe(150); // All blocks for 30m (~150)
      // latestBlock is now derived from result set (max block number)
      expect(data.latestBlock).toBe(1149);

      // Verify the query does NOT use bucketing for 30m
      const queryCall = (pool.query as jest.Mock).mock.calls[0];
      expect(queryCall[0]).toContain('SELECT * FROM blocks');
      expect(queryCall[0]).toContain('WHERE block_timestamp IS NOT NULL');
      expect(queryCall[0]).toContain("INTERVAL '30 minutes'");
      expect(queryCall[0]).not.toContain('GROUP BY'); // No bucketing
    });

    it('should return bucketed data for 4h time range', async () => {
      const mockBucketedBlocks = Array.from({ length: 120 }, (_, i) => ({
        block_number: String(2000 + i),
        min_block: String(2000 + i * 10),
        max_block: String(2000 + i * 10 + 9),
        gas_limit: '30000000',
        gas_used: '15000000',
        base_fee: '50000000000',
        blob_count: 3,
        blob_base_fee: '1000000',
        excess_blob_gas: '500000',
        created_at: new Date(),
      }));

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockBucketedBlocks });

      const request = new Request('http://localhost:3000/api/blocks?timeRange=4h');
      const response = await GET(request);
      await response.json();

      expect(response.status).toBe(200);

      // Verify 2-minute buckets (120 seconds) and correct aggregations
      const queryCall = (pool.query as jest.Mock).mock.calls[0];
      expect(queryCall[0]).toContain('/ 120');
      expect(queryCall[0]).toContain('AVG(gas_limit)'); // Average limit
      expect(queryCall[0]).toContain('SUM(gas_used)'); // Total gas used
      expect(queryCall[0]).toContain('AVG(base_fee)'); // Average fee
      expect(queryCall[0]).toContain('SUM(blob_count)'); // Total blobs
      // Blob fee uses a complex calculation: avg(floor) + avg(congestion)
      expect(queryCall[0]).toContain('AVG(floor_blob_base_fee)'); // Average floor component
      expect(queryCall[0]).toContain('AVG(congestion)'); // Average congestion component
      expect(queryCall[0]).toContain('AVG(excess_blob_gas)'); // Average excess
      expect(queryCall[0]).toContain('MIN(block_number)'); // Block range
      expect(queryCall[0]).toContain('MAX(block_number)'); // Block range
    });

    it('should return error for invalid time range', async () => {
      const request = new Request('http://localhost:3000/api/blocks?timeRange=invalid');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(400);
      expect(data.error).toBe('Invalid timeRange. Use: 30m, 4h, 12h, 24h, or 7d');
    });

    it('should only query blocks with timestamps', async () => {
      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: [] });

      const request = new Request('http://localhost:3000/api/blocks?timeRange=30m');
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

      (pool.query as jest.Mock).mockResolvedValueOnce({ rows: mockBlocks });

      const request = new Request('http://localhost:3000/api/blocks?after=100&limit=50');
      const response = await GET(request);
      const data = await response.json();

      expect(response.status).toBe(200);
      expect(data.blocks[0].block).toBe(101);

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
