/**
 * Credit a wallet atomically.
 *
 * Atomicity guarantees: either BOTH the ledger row is inserted AND the
 * cached balance is updated, or NEITHER. There is no in-between state.
 * Implemented via Prisma's interactive transactions, which translate to
 * a Postgres BEGIN/COMMIT.
 *
 * Idempotency: enforced by the UNIQUE constraint on `transactions.reference`.
 * If a caller (e.g. a retried webhook) calls this twice with the same
 * reference, the second INSERT fails at the DB level and we translate that
 * into a typed DuplicateReferenceError that the caller can handle.
 */

import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  DuplicateReferenceError,
  WalletNotFoundError,
} from "@/lib/ledger/errors";
import { assertPositiveKobo } from "@/lib/money";

type CreditInput = {
  walletId: string;
  amountKobo: bigint;
  reference: string;
  source: string;          // "topup" | "refund" | etc.
  gateway?: string | null; // "paystack" | "flutterwave" | null
  gatewayRef?: string | null;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
};

export async function creditWallet(input: CreditInput) {
  // GUARD: don't let bugs upstream poison the ledger with zero/negative credits.
  assertPositiveKobo(input.amountKobo, "creditWallet");

  try {
    // prisma.$transaction with an async callback gives us interactive
    // transactions. All queries inside the callback run within the same
    // Postgres BEGIN/COMMIT. If the callback throws, Prisma issues ROLLBACK.
    return await prisma.$transaction(async (tx) => {
      // STEP 1: lock the wallet row.
      //
      // WHY $queryRaw with FOR UPDATE: Prisma doesn't have a first-class
      // row-locking primitive yet, so we drop to raw SQL for this one line.
      // FOR UPDATE acquires a row-level exclusive lock that blocks other
      // transactions trying to lock the same row, preventing the classic
      // double-spend race condition.
      //
      // WHY `deleted_at IS NULL`: soft-deleted wallets are not creditable.
      const wallets = await tx.$queryRaw<Array<{ id: string }>>`
        SELECT id FROM wallets
        WHERE id = ${input.walletId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;

      if (wallets.length === 0) {
        throw new WalletNotFoundError(input.walletId);
      }

      // STEP 2: insert the ledger row.
      // The UNIQUE constraint on `reference` is what enforces idempotency.
      // If this reference exists already, Prisma throws P2002 (unique
      // constraint violation), which we catch below and rethrow as a typed
      // DuplicateReferenceError.
      const transaction = await tx.transaction.create({
        data: {
          walletId: input.walletId,
          userId: (
            await tx.wallet.findUniqueOrThrow({
              where: { id: input.walletId },
              select: { userId: true },
            })
          ).userId,
          reference: input.reference,
          type: "CREDIT",
          amountKobo: input.amountKobo,
          status: "SUCCESS",
          source: input.source,
          gateway: input.gateway ?? null,
          gatewayRef: input.gatewayRef ?? null,
          metadata: input.metadata ?? undefined,
        },
      });

      // STEP 3: update the cached balance.
      // This MUST happen in the same transaction as the insert.
      // If it doesn't, balance and ledger drift, and the system is broken.
      const wallet = await tx.wallet.update({
        where: { id: input.walletId },
        data: { balanceKobo: { increment: input.amountKobo } },
      });

      return { transaction, wallet };
    });
  } catch (err) {
    // Translate Prisma's P2002 (unique violation on `reference`) into
    // a typed error the caller can switch on.
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new DuplicateReferenceError(input.reference);
    }
    throw err;
  }
}