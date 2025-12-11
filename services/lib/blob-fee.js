/**
 * Blob base fee calculation utilities
 * Implements EIP-4844 fake exponential approximation with BPO1 upgrade support
 */

const {
  MIN_BASE_FEE_PER_BLOB_GAS,
  BLOB_BASE_FEE_UPDATE_FRACTION,
  BPO1_UPGRADE_TIMESTAMP,
  OLD_TARGET_BLOBS,
  NEW_TARGET_BLOBS,
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
 * Calculate blob base fee from excess blob gas
 * - Always uses parameter 5007716
 * - Pre-BPO1: Use raw excess blob gas
 * - Post-BPO1: Scale excess by old_target/new_target (6/10 = 0.6) due to target change
 *
 * @param {number} excessBlobGas - The excess blob gas
 * @param {number|null} blockTimestamp - Unix timestamp of the block (optional)
 * @returns {number} The calculated blob base fee in wei
 */
function calculateBlobBaseFee(excessBlobGas, blockTimestamp) {
  let effectiveExcess = excessBlobGas;

  // After BPO1, scale excess by old target / new target (6/10 = 0.6)
  const isBPO1Active = blockTimestamp && blockTimestamp >= BPO1_UPGRADE_TIMESTAMP;
  if (isBPO1Active) {
    effectiveExcess = Math.floor(excessBlobGas * OLD_TARGET_BLOBS / NEW_TARGET_BLOBS);
  }

  return fakeExponential(
    MIN_BASE_FEE_PER_BLOB_GAS,
    effectiveExcess,
    BLOB_BASE_FEE_UPDATE_FRACTION
  );
}

module.exports = {
  fakeExponential,
  calculateBlobBaseFee,
};
