/**
 * Shared constants for Ethereum gas calculations
 * These constants are used across all services for blob base fee calculations
 */

// EIP-4844/7691/7892 parameters for blob basefee calculation
const MIN_BASE_FEE_PER_BLOB_GAS = 1;
const BLOB_GAS_PER_BLOB = 131072;

// Blob base fee update fractions per upgrade (from EIP-7892)
// These increase proportionally with target blob count to maintain price stability
const BLOB_BASE_FEE_UPDATE_FRACTION_PRAGUE = 5007716;  // target 6
const BLOB_BASE_FEE_UPDATE_FRACTION_BPO1 = 8346193;    // target 10 (5007716 * 10/6)
const BLOB_BASE_FEE_UPDATE_FRACTION_BPO2 = 11684671;   // target 14 (5007716 * 14/6)

// Upgrade timestamps
const BPO1_UPGRADE_TIMESTAMP = 1765290071;  // Dec 9, 2025
const BPO2_UPGRADE_TIMESTAMP = 1767747671;  // Jan 7, 2026

module.exports = {
  MIN_BASE_FEE_PER_BLOB_GAS,
  BLOB_GAS_PER_BLOB,
  BLOB_BASE_FEE_UPDATE_FRACTION_PRAGUE,
  BLOB_BASE_FEE_UPDATE_FRACTION_BPO1,
  BLOB_BASE_FEE_UPDATE_FRACTION_BPO2,
  BPO1_UPGRADE_TIMESTAMP,
  BPO2_UPGRADE_TIMESTAMP,
};
