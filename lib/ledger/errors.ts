/**
 * Typed errors for ledger operations.
 *
 * WHY typed errors: routes and frontend code need to distinguish between
 * "the user doesn't have enough money" (show a friendly message) and "the
 * database is unreachable" (show a generic error, page the engineer).
 * Catching `Error` and reading `.message` is fragile; checking `instanceof`
 * is robust.
 */

export class LedgerError extends Error {
    constructor(message: string) {
      super(message);
      this.name = "LedgerError";
    }
  }
  
  /**
   * The wallet doesn't have enough balance for this debit.
   * Recoverable from the user's perspective ("top up first").
   */
  export class InsufficientFundsError extends LedgerError {
    constructor(
      public readonly walletId: string,
      public readonly availableKobo: bigint,
      public readonly requestedKobo: bigint,
    ) {
      super(
        `Insufficient funds in wallet ${walletId}: ` +
          `available ${availableKobo} kobo, requested ${requestedKobo} kobo`,
      );
      this.name = "InsufficientFundsError";
    }
  }
  
  /**
   * The wallet referenced doesn't exist (or was soft-deleted).
   * Indicates a bug — routes should resolve the wallet before calling ledger.
   */
  export class WalletNotFoundError extends LedgerError {
    constructor(public readonly walletId: string) {
      super(`Wallet not found or deleted: ${walletId}`);
      this.name = "WalletNotFoundError";
    }
  }
  
  /**
   * A transaction with this reference already exists.
   * This is the IDEMPOTENCY GUARD firing — duplicate webhook, duplicate request.
   * Caller can usually treat this as success (the operation already happened).
   */
  export class DuplicateReferenceError extends LedgerError {
    constructor(public readonly reference: string) {
      super(`Transaction with reference already exists: ${reference}`);
      this.name = "DuplicateReferenceError";
    }
  }