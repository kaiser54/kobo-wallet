/**
 * Debit a wallet atomically.
 *
 * Same atomicity and idempotency guarantees as creditWallet, plus an
 * additional balance check: we refuse to overdraw the wallet.
 *
 * Note: we check the balance AFTER acquiring the row lock. Checking it
 * before would create a TOCTOU (time-of-check-to-time-of-use) race —
 * by the time we wrote, the balance could have changed.
 */

import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/generated/prisma/client";
import {
  DuplicateReferenceError,
  InsufficientFundsError,
  WalletNotFoundError,
} from "@/lib/ledger/errors";
import { assertPositiveKobo } from "@/lib/money";

type DebitInput = {
  walletId: string;
  amountKobo: bigint;
  reference: string;
  source: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  metadata?: any;
};

export async function debitWallet(input: DebitInput) {
  assertPositiveKobo(input.amountKobo, "debitWallet");

  try {
    return await prisma.$transaction(async (tx) => {
      // STEP 1: lock the wallet row AND read its current balance.
      // Single query, single round-trip.
      const wallets = await tx.$queryRaw<
        Array<{ id: string; user_id: string; balance_kobo: bigint }>
      >`
        SELECT id, user_id, balance_kobo FROM wallets
        WHERE id = ${input.walletId}::uuid
          AND deleted_at IS NULL
        FOR UPDATE
      `;

      if (wallets.length === 0) {
        throw new WalletNotFoundError(input.walletId);
      }

      const wallet = wallets[0];

      // STEP 2: balance check.
      // We have the lock, so this value is authoritative for the duration
      // of the transaction.
      if (wallet.balance_kobo < input.amountKobo) {
        throw new InsufficientFundsError(
          input.walletId,
          wallet.balance_kobo,
          input.amountKobo,
        );
      }

      // STEP 3: insert the debit ledger row.
      const transaction = await tx.transaction.create({
        data: {
          walletId: input.walletId,
          userId: wallet.user_id,
          reference: input.reference,
          type: "DEBIT",
          amountKobo: input.amountKobo,
          status: "SUCCESS",
          source: input.source,
          metadata: input.metadata ?? undefined,
        },
      });

      // STEP 4: update cached balance (decrement).
      const updatedWallet = await tx.wallet.update({
        where: { id: input.walletId },
        data: { balanceKobo: { decrement: input.amountKobo } },
      });

      return { transaction, wallet: updatedWallet };
    });
  } catch (err) {
    if (
      err instanceof Prisma.PrismaClientKnownRequestError &&
      err.code === "P2002"
    ) {
      throw new DuplicateReferenceError(input.reference);
    }
    throw err;
  }
}