/**
 * Blob base fee calculation utilities
 * Implements EIP-4844 fake exponential approximation with BPO1/BPO2 upgrade support
 */

const {
  MIN_BASE_FEE_PER_BLOB_GAS,
  BLOB_BASE_FEE_UPDATE_FRACTION_PRAGUE,
  BLOB_BASE_FEE_UPDATE_FRACTION_BPO1,
  BLOB_BASE_FEE_UPDATE_FRACTION_BPO2,
  BPO1_UPGRADE_TIMESTAMP,
  BPO2_UPGRADE_TIMESTAMP,
} = require('./constants');

/**
 * Fake exponential approximation from EIP-4844
 * @param {number} factor - The factor multiplier
 * @param {number} numerator - The numerator (excess blob gas)
 * @param {number} denominator - The denominator (update fraction)
 * @returns {number} The calculated value
 */
function fakeExponential(factor, numerator, denominator) {
  let i = 1;
  let output = 0;
  let numeratorAccum = factor * denominator;

  while (numeratorAccum > 0) {
    output += numeratorAccum;
    numeratorAccum = Math.floor((numeratorAccum * numerator) / (denominator * i));
    i += 1;
  }

  return Math.floor(output / denominator);
}

/**
 * Get the blob base fee update fraction for a given timestamp
 * Each upgrade increases the fraction proportionally with the target blob count
 * to maintain price stability (per EIP-7892)
 *
 * @param {number|null} blockTimestamp - Unix timestamp of the block
 * @returns {number} The update fraction to use
 */
function getUpdateFraction(blockTimestamp) {
  if (blockTimestamp && blockTimestamp >= BPO2_UPGRADE_TIMESTAMP) {
    return BLOB_BASE_FEE_UPDATE_FRACTION_BPO2;
  }
  if (blockTimestamp && blockTimestamp >= BPO1_UPGRADE_TIMESTAMP) {
    return BLOB_BASE_FEE_UPDATE_FRACTION_BPO1;
  }
  return BLOB_BASE_FEE_UPDATE_FRACTION_PRAGUE;
}

/**
 * Calculate blob base fee from excess blob gas
 * Uses the appropriate update fraction based on block timestamp (per EIP-7892)
 *
 * @param {number} excessBlobGas - The excess blob gas
 * @param {number|null} blockTimestamp - Unix timestamp of the block (optional)
 * @returns {number} The calculated blob base fee in wei
 */
function calculateBlobBaseFee(excessBlobGas, blockTimestamp) {
  const updateFraction = getUpdateFraction(blockTimestamp);

  return fakeExponential(
    MIN_BASE_FEE_PER_BLOB_GAS,
    excessBlobGas,
    updateFraction
  );
}

module.exports = {
  fakeExponential,
  calculateBlobBaseFee,
};
