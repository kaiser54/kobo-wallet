/**
 * Money utilities.
 *
 * Money is ALWAYS stored and computed as integers in the smallest unit (kobo).
 * Floats are NEVER used for money — they have precision errors that compound.
 * Example: 0.1 + 0.2 === 0.30000000000000004 in JavaScript.
 *
 * Naira is a DISPLAY concept only. Convert at the UI boundary.
 *
 * In our DB, BigInt is used for amounts because regular Int (32-bit) caps
 * at ~21 million naira in kobo, which real wallets exceed.
 *
 * In TypeScript, we use the `bigint` type for parity. Operations on bigint
 * are integer-only — no floats, no precision loss.
 */

// =============================================================================
// CONVERSION
// =============================================================================

/**
 * Convert a naira amount (number) to kobo (bigint).
 *
 * NOTE: This is the ONE place we accept a JS number for money input — at the
 * boundary where humans type naira amounts. We round to handle UI input like
 * "100.50" cleanly, then never use a number again downstream.
 *
 * @example
 *   nairaToKobo(100)      // → 10000n
 *   nairaToKobo(100.5)    // → 10050n
 *   nairaToKobo(0.01)     // → 1n
 */
export function nairaToKobo(naira: number): bigint {
    if (!Number.isFinite(naira)) {
      throw new RangeError(`Invalid naira amount: ${naira}`);
    }
    if (naira < 0) {
      throw new RangeError(`Naira amount must be non-negative: ${naira}`);
    }
    // WHY Math.round and not Math.floor or Math.ceil: prevents "₦100.50 became
    // ₦100.49 due to float drift." Banker's rounding (round-half-to-even) would
    // be more correct for accounting, but for user input where they typed the
    // value themselves, round-to-nearest matches user expectations.
    return BigInt(Math.round(naira * 100));
  }
  
  /**
   * Convert kobo (bigint) to a naira number for display.
   *
   * WARNING: this returns a JS number, which has precision limits above
   * ~9 quadrillion. For display purposes only. NEVER round-trip through
   * this — kobo → naira → kobo can lose precision for huge amounts.
   *
   * @example
   *   koboToNaira(10000n)   // → 100
   *   koboToNaira(10050n)   // → 100.5
   */
  export function koboToNaira(kobo: bigint): number {
    return Number(kobo) / 100;
  }
  
  // =============================================================================
  // FORMATTING
  // =============================================================================
  
  /**
   * Format kobo as a user-facing naira string with thousands separators.
   *
   * @example
   *   formatNaira(10050n)         // → "₦100.50"
   *   formatNaira(1234567890n)    // → "₦12,345,678.90"
   *   formatNaira(0n)             // → "₦0.00"
   */
  export function formatNaira(kobo: bigint): string {
    const naira = koboToNaira(kobo);
    return new Intl.NumberFormat("en-NG", {
      style: "currency",
      currency: "NGN",
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(naira);
  }
  
  // =============================================================================
  // VALIDATION HELPERS
  // =============================================================================
  
  /**
   * Check whether a kobo amount is a valid positive integer.
   * Used in ledger functions to guard against bugs.
   */
  export function assertPositiveKobo(kobo: bigint, context: string): void {
    if (kobo <= 0n) {
      throw new RangeError(`${context}: amount must be positive, got ${kobo}`);
    }
  }