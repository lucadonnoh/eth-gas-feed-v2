/**
 * Ethereum network parameters and helper functions
 */

// Slot 13205504 is when BPO1 upgrade activates (blob target/max increase from 6/9 to 10/15)
// Timestamp: 1765290071 (approximately December 9, 2025)
export const BPO1_UPGRADE_SLOT = 13205504;
export const BPO1_UPGRADE_TIMESTAMP = 1765290071;

// Genesis time for Ethereum Beacon Chain (December 1, 2020, 12:00:00 UTC)
export const BEACON_GENESIS_TIME = 1606824000;

// Seconds per slot
export const SECONDS_PER_SLOT = 12;

/**
 * Convert Beacon Chain slot to Unix timestamp
 */
export function slotToTimestamp(slot: number): number {
  return BEACON_GENESIS_TIME + (slot * SECONDS_PER_SLOT);
}

/**
 * Convert Unix timestamp to Beacon Chain slot
 */
export function timestampToSlot(timestamp: number): number {
  return Math.floor((timestamp - BEACON_GENESIS_TIME) / SECONDS_PER_SLOT);
}

/**
 * Get blob target and max for a given slot/timestamp
 */
export function getBlobLimits(slotOrTimestamp: number, isSlot: boolean = true): { target: number; max: number } {
  const timestamp = isSlot ? slotToTimestamp(slotOrTimestamp) : slotOrTimestamp;

  if (timestamp >= BPO1_UPGRADE_TIMESTAMP) {
    // Post-BPO1: 10 target, 15 max
    return { target: 10, max: 15 };
  } else {
    // Pre-BPO1: 6 target, 9 max
    return { target: 6, max: 9 };
  }
}

/**
 * Get current slot number
 */
export function getCurrentSlot(): number {
  return timestampToSlot(Math.floor(Date.now() / 1000));
}

/**
 * Check if BPO1 upgrade has activated
 */
export function isBPO1Active(): boolean {
  return getCurrentSlot() >= BPO1_UPGRADE_SLOT;
}

/**
 * Check if BPO1 upgrade has activated at a specific timestamp
 */
export function isBPO1ActiveAtTimestamp(timestamp: number): boolean {
  return timestamp >= BPO1_UPGRADE_TIMESTAMP;
}
