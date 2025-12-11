/**
 * Blob Fee Recalculation Service
 * Recalculates and updates blob base fees for existing records in the database
 * Useful after algorithm changes or BPO1 upgrade
 */

const { log, getPool, queryWithRetry, calculateBlobBaseFee, closePool } = require('./lib');

async function fixBlobBaseFees() {
  log('info', 'Starting blob base fee recalculation');

  try {
    // Get all blocks that need checking
    const result = await queryWithRetry(`
      SELECT block_number, excess_blob_gas, blob_base_fee,
             EXTRACT(EPOCH FROM block_timestamp)::bigint as timestamp
      FROM blocks
      ORDER BY block_number ASC
    `);

    log('info', 'Processing blocks', { total: result.rows.length });

    let updated = 0;
    let unchanged = 0;
    let errors = 0;

    for (const row of result.rows) {
      try {
        const blockNumber = row.block_number;
        const excessBlobGas = Number(row.excess_blob_gas);
        const oldBlobBaseFee = Number(row.blob_base_fee);
        const timestamp = Number(row.timestamp);

        // Calculate correct blob base fee
        const newBlobBaseFee = calculateBlobBaseFee(excessBlobGas, timestamp);

        // Only update if different
        if (newBlobBaseFee !== oldBlobBaseFee) {
          await queryWithRetry(
            'UPDATE blocks SET blob_base_fee = $1 WHERE block_number = $2',
            [newBlobBaseFee, blockNumber]
          );

          const oldGwei = (oldBlobBaseFee / 1e9).toFixed(9);
          const newGwei = (newBlobBaseFee / 1e9).toFixed(9);
          log('info', 'Block updated', { blockNumber, oldGwei, newGwei });
          updated++;
        } else {
          unchanged++;
        }

        // Progress indicator every 500 blocks
        if ((updated + unchanged) % 500 === 0) {
          log('info', 'Progress', {
            processed: updated + unchanged,
            total: result.rows.length,
            updated,
            unchanged
          });
        }
      } catch (err) {
        log('error', 'Error fixing block', { blockNumber: row.block_number, error: err.message });
        errors++;
      }
    }

    log('info', 'Blob fee recalculation complete', { updated, unchanged, errors });

    await closePool();
    process.exit(errors > 0 ? 1 : 0);
  } catch (err) {
    log('error', 'Fatal error', { error: err.message, stack: err.stack });
    await closePool();
    process.exit(1);
  }
}

fixBlobBaseFees();
