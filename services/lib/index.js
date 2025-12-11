/**
 * Services library exports
 * Single entry point for all shared utilities
 */

const constants = require('./constants');
const blobFee = require('./blob-fee');
const db = require('./db');

module.exports = {
  // Constants
  ...constants,

  // Blob fee calculations
  fakeExponential: blobFee.fakeExponential,
  calculateBlobBaseFee: blobFee.calculateBlobBaseFee,

  // Database utilities
  log: db.log,
  getPool: db.getPool,
  queryWithRetry: db.queryWithRetry,
  testConnection: db.testConnection,
  insertBlock: db.insertBlock,
  getLatestBlockNumber: db.getLatestBlockNumber,
  cleanupOldBlocks: db.cleanupOldBlocks,
  findGaps: db.findGaps,
  closePool: db.closePool,
};
