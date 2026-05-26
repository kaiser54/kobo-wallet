/**
 * Read-side ledger queries: get balance, get transaction history.
 *
 * No locking, no transactions — these are pure reads. Postgres MVCC means
 * concurrent reads never block each other or writers.
 */

import { prisma } from "@/lib/db/client";

/**
 * Get the cached balance for a wallet by user ID.
 * Returns null if the user has no wallet (shouldn't happen post-signup,
 * but we return null instead of throwing to keep this query forgiving).
 */
export async function getBalanceByUserId(userId: string): Promise<bigint | null> {
  const wallet = await prisma.wallet.findFirst({
    where: { userId, deletedAt: null },
    select: { balanceKobo: true },
  });
  return wallet?.balanceKobo ?? null;
}

/**
 * Get a user's recent transactions, newest first.
 * Default limit 50 — pagination comes later if we need it.
 */
export async function getTransactionsByUserId(
  userId: string,
  options: { limit?: number; offset?: number } = {},
) {
  return prisma.transaction.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    take: options.limit ?? 50,
    skip: options.offset ?? 0,
  });
}

/**
 * Compute the AUTHORITATIVE balance from the ledger (not the cache).
 * Used by the reconciliation script to verify the cache hasn't drifted.
 *
 * WHY two queries instead of one: simpler SQL, both queries hit the same
 * index, and the addition happens in TypeScript with bigint precision.
 */
export async function computeBalanceFromLedger(walletId: string): Promise<bigint> {
  const [credits, debits] = await Promise.all([
    prisma.transaction.aggregate({
      where: { walletId, type: "CREDIT", status: "SUCCESS" },
      _sum: { amountKobo: true },
    }),
    prisma.transaction.aggregate({
      where: { walletId, type: "DEBIT", status: "SUCCESS" },
      _sum: { amountKobo: true },
    }),
  ]);

  const totalCredits = credits._sum.amountKobo ?? 0n;
  const totalDebits = debits._sum.amountKobo ?? 0n;
  return totalCredits - totalDebits;
}