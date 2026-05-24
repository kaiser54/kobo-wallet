# Ledger design notes

## Why the balance is a cached aggregate, not a stored value

The `wallets.balance_kobo` column is denormalized — it's a cached copy of `SUM(credit transactions) - SUM(debit transactions)` for that wallet.

We do this because:
1. We need fast balance reads (every dashboard load).
2. Computing the sum from the ledger on every read becomes slow as transactions grow.
3. But the ledger remains the source of truth; the cache is just an optimization.

The reconciliation script periodically verifies that `balance_kobo == SUM(ledger)`. If it ever doesn't match, we have a bug.

## Why we never delete transactions

Database constraint: `onDelete: Restrict` on the Transaction → Wallet and Transaction → User foreign keys. Even if app code tries to delete a wallet or user, Postgres refuses if any transactions reference them.

The right way to "undo" a transaction is to write a reversing entry (another row, opposite type, referencing the original). This preserves the audit trail.

This isn't a preference — it's a regulatory requirement in most jurisdictions for financial records.





## Why we use Cascade for Wallet→User but Restrict for Transaction→User/Wallet

This is deliberate, not arbitrary. The rules combine into a single principle:
**users without transaction history can be deleted; users with history cannot.**

- A user with no transactions is just a row of personal data → delete it normally.
- A user with transactions has financial history attached → physically refused at the DB level.

Why physical refusal matters:
- Financial regulations require 5-10 years of transaction retention (CBN: 6 years).
- Ledger entries must be immutable for audit. Corrections happen as new entries, not edits/deletes.
- Deleting a transacting user would lose the link between money in our bank account and where it came from → books no longer balance → AML violation.

How real fintechs handle "delete my account" requests for users with history:
- Anonymize the user row (email, name) instead of deleting it.
- Keep the user row pointing at the transactions.
- Disable login by overwriting password_hash.
- Add a `deleted_at` column to filter the user out of UI/admin views.

The database constraints we set up guide us toward this design by making the wrong path impossible.





## Soft delete on users and wallets; immutable transactions

### Rules

- `User` and `Wallet` have a nullable `deleted_at` column.
- `deleted_at IS NULL` → row is active; `deleted_at IS NOT NULL` → row is logically deleted.
- All foreign keys use `onDelete: Restrict`. Hard delete is impossible from app code.
- `Transaction` has NO `deleted_at`. Transactions are immutable. Mistakes are corrected by writing reversing entries.

### Why soft delete

1. Financial regulations require 5–10 years of transaction retention (CBN: 6). A deleted user with transactions would orphan or break those records.
2. Audit trails. "What happened on March 14?" should always have an answer.
3. Recovery from mistakes. A buggy delete can be undone if the data is still there.

### How GDPR / NDPR "right to be forgotten" works with soft delete

The right to be forgotten is satisfied by ANONYMIZATION, not deletion, when transaction history exists:
- Replace email with `anon-{uuid}@deleted.local`
- Clear `name`
- Overwrite `passwordHash` with an invalid value (e.g. random bytes)
- Set `deletedAt = now()`
- KEEP the user row and all transactions

For users with no transactions, a regular soft delete is sufficient.

### Query rule

Every query of `User` or `Wallet` MUST include `WHERE deletedAt IS NULL` unless deliberately querying deleted rows (admin restore, audit). We enforce this through wrapper functions in `lib/users.ts` and `lib/wallets.ts` — never call `prisma.user.findMany()` directly from a route.