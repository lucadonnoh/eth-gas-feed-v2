/**
 * Shared constants for Ethereum gas calculations
 * These constants are used across all services for blob base fee calculations
 */

// EIP-7691 parameters for blob basefee calculation
// Note: Parameter 5007716 is used for ALL blocks (both pre and post BPO1)
const MIN_BASE_FEE_PER_BLOB_GAS = 1;
const BLOB_BASE_FEE_UPDATE_FRACTION = 5007716;
const BLOB_GAS_PER_BLOB = 131072;

// BPO1 upgrade parameters
const BPO1_UPGRADE_TIMESTAMP = 1765290071;
const OLD_TARGET_BLOBS = 6;
const NEW_TARGET_BLOBS = 10;

module.exports = {
  MIN_BASE_FEE_PER_BLOB_GAS,
  BLOB_BASE_FEE_UPDATE_FRACTION,
  BLOB_GAS_PER_BLOB,
  BPO1_UPGRADE_TIMESTAMP,
  OLD_TARGET_BLOBS,
  NEW_TARGET_BLOBS,
};
