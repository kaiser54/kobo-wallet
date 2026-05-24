# Architecture Decisions

A log of significant technical choices made on this project, why they were made, and what we considered. Update as decisions evolve.

---

## ADR-001: Next.js App Router (not Pages Router, not separate Express backend)

**Status:** Accepted

### Context
I need a framework for a fintech wallet app with both UI and backend (API routes, webhook handler).

### Decision
Next.js 16 with App Router.

### Why
- One codebase for frontend + backend, no CORS or deployment split.
- Server Components let us fetch user wallet data on the server with no client-side fetch library needed.
- App Router is the current standard; Pages Router is in maintenance mode.
- Industry-standard for fintech dashboards in 2026.

### Alternatives considered
- **Express + separate React app**: more idiomatic, but doubles the codebase and deployment complexity for an app this size.
- **Remix / TanStack Start**: viable, but smaller ecosystem and less common in fintech hiring.

---

## ADR-002: PostgreSQL + Prisma for data layer

**Date:** [today's date]
**Status:** Accepted

### Decision
Postgres 16 locally, Prisma 7 as the ORM.

### Why
- Postgres has ACID transactions — non-negotiable for atomic credit/debit operations.
- Prisma gives us type-safe queries and a readable schema file. Migrations are well-supported.
- Industry standard for fintech in 2026.

### Alternatives considered
- **Drizzle ORM**: lower-level, closer to SQL. Powerful but more verbose; Prisma wins on developer ergonomics for a learning project.
- **Raw SQL with `pg`**: maximum control, but no type safety; mistakes are caught at runtime, not at compile time.

---

## ADR-003: fetch over axios for HTTP calls

**Date:** [today's date]
**Status:** Accepted

### Decision
Use the built-in `fetch` API. No axios.

### Why
- Zero dependencies.
- Server Components in Next.js 16 mean most data fetching is server-side and synchronous from the caller's perspective; fetch is sufficient.
- For outbound Paystack calls, fetch's slightly more verbose error handling forces us to be explicit about HTTP status checks, which is good discipline.

### Trade-off accepted
- fetch doesn't throw on 4xx/5xx, so every Paystack call must check `response.ok` and `body.status` explicitly.
- We wrap this in a custom `PaystackError` class so the verbosity lives in one place.

---

## ADR-004: Auth.js v5 with Credentials provider + bcrypt

**Date:** [today's date]
**Status:** Accepted

### Decision
Use Auth.js v5 with the Credentials provider. Hash passwords with bcryptjs. Hash password reset tokens before storing them.

### Why
- Rolling our own auth is the single most security-sensitive code in any app; we get it wrong and accounts get taken over.
- Auth.js is the standard for Next.js. It handles sessions, cookies, and CSRF; we control the user schema.
- Resend for password reset emails (free tier, simple SDK).

### Alternatives considered
- **Roll our own**: maximum learning, maximum risk. Not worth it.
- **Clerk / Supabase Auth**: too much abstraction; learning value is low because everything is hosted.

---

## ADR-005: Single-entry ledger (not double-entry, not balance column)

**Date:** [today's date]
**Status:** Accepted

### Decision
The wallet `balance_kobo` is a *cached* value, updated atomically with every ledger entry. Source of truth is `SUM(credits) - SUM(debits)` from the transactions table.

### Why
- A `balance` column with `UPDATE balance = balance + N` has no audit trail, corrupts under concurrent writes, and can't be reconciled.
- A reconciliation script can verify the cached balance equals the ledger sum at any time. Drift = bug, and we'll see it.

### When we'd upgrade
- Double-entry becomes necessary when money moves *between* internal accounts (e.g., a P2P transfer needs both a debit on one wallet and a credit on another, recorded as a single atomic event with matching legs). For App #1 we don't have internal transfers, so single-entry is correct.

---

## ADR-006: Money stored as integers in minor units (kobo)

**Date:** [today's date]
**Status:** Accepted

### Decision
All amounts are `bigint` in kobo (1 NGN = 100 kobo). No floats anywhere. Naira is a display concept only, computed at the UI layer.

### Why
- Float arithmetic is lossy: `0.1 + 0.2 !== 0.3` in JavaScript. Over millions of transactions this compounds into real money.
- Paystack's API also expects amounts in kobo, so our internal representation matches the wire format.
- `bigint` over `int` because plain int caps around ₦21M, which a real account will hit eventually.

---

## ADR-007: Secrets in `.env.local`, Prisma reads it via dotenv-cli

**Date:** [today]
**Status:** Accepted

### Decision
- All secrets live in `.env.local` (gitignored).
- `.env` is not used; Prisma's default behavior is overridden by prefixing every Prisma command with `dotenv -e .env.local --`.
- Shortcut npm scripts (`db:migrate`, `db:studio`, etc.) bake this in so we never forget.

### Why
- Follows the Next.js convention for environment files.
- A single source of truth for secrets avoids the "is it in .env or .env.local?" confusion.
- The npm scripts mean every team member runs commands the same way.

### What we're trading off
- Slightly more verbose configuration than letting Prisma use its default `.env`.
- Worth it: one secrets file, one place to check before committing.

---

## ADR-008: Prisma 7 with driver adapter (pg)

**Date:** [today]
**Status:** Accepted

### Decision
- Use Prisma 7 (not 6, not 5).
- Use the `@prisma/adapter-pg` driver adapter with the `pg` driver for Postgres.
- Database URL lives in `prisma.config.ts`, not in `schema.prisma`.
- Generated Prisma Client goes to a project-controlled folder, not `node_modules`.

### Why
- Prisma 7 is the current version as of mid-2026; new fintech codebases will use it.
- Driver adapters mean smaller bundles and the ability to deploy to edge runtimes if needed later.
- Separating connection config (TS file) from schema (model definitions) is cleaner.

### Trade-off
- Less Stack Overflow coverage than Prisma 6 since 7 is newer.
- One more package to install (`pg` + adapter) than the old all-in-one setup.

---

## ADR-009: Dependency vs devDependency classification

**Date:** [today]
**Status:** Accepted

### Decision
- `prisma` (the CLI) lives in `devDependencies`. It's used for migrations, generation, and Studio — never at app runtime.
- `@prisma/client` (the runtime library) lives in `dependencies`. The app imports it.
- General rule: if `import` it at runtime → dependency. If it's a CLI or build tool → devDependency.

### Why
- Production installs with `--prod` skip devDependencies. Anything misplaced is wasted bundle size and attack surface.
- Misplacement is the most common dependency bug I see in junior codebases.

### How to audit
Ask of each package: "Does my running app `import` this?" If no, it's a dev dependency.

---

## ADR-010: Soft delete for users and wallets; hard delete blocked at FK level

**Date:** [today]
**Status:** Accepted

### Decision
- Add nullable `deletedAt` column to `User` and `Wallet`.
- Change all `onDelete` FK behaviors to `Restrict`. No hard deletes from app code.
- `Transaction` table has no soft delete — ledger entries are immutable.
- All queries of User/Wallet go through wrapper functions in `lib/` that filter `deletedAt: null`.

### Why
- Financial regulations require multi-year transaction retention.
- Anonymization (not deletion) is the right answer to "delete my account" when history exists.
- Database-level FK restrictions prevent accidental hard deletes via buggy code.

### Trade-off accepted
- Slightly larger tables over time (deleted rows aren't reclaimed).
- Every query needs the `deletedAt: null` filter; forgotten filters can leak deleted data into UI.
- Mitigated by funneling all queries through `lib/` wrappers.

---

## ADR-011: JWT sessions (not database sessions)

**Date:** [today]
**Status:** Forced by Auth.js Credentials provider

### Decision
Use Auth.js v5 JWT sessions. No `Session` table. No `Account` table (no OAuth providers).

### Why
- Auth.js v5's Credentials provider supports ONLY JWT sessions. This isn't optional — database sessions are blocked at the framework level for Credentials.
- Smaller schema, fewer moving parts.
- One DB hit saved per authenticated request (no session table lookup).

### Trade-off
- Can't revoke a session server-side without extra work (e.g. a token blocklist).
- For App #1's threat model, this is fine. For a real production fintech, we'd add a server-side revocation mechanism (often via a "tokens issued after this timestamp are invalid" column on User, bumped on logout/password-change).

### What we still keep
- `VerificationToken` table — Auth.js adapter requires it even with JWT sessions.
- Our own `PasswordResetToken` table — Credentials provider doesn't include reset; we build it ourselves.

---

## ADR-012: Multi-file Prisma schema, organized by bounded context

**Date:** [today]
**Status:** Accepted

### Decision
Split `schema.prisma` into a `prisma/schema/` folder with one file per bounded context:
- `config.prisma` — generator + datasource
- `auth.prisma` — User, Role, VerificationToken, PasswordResetToken
- `wallet.prisma` — Wallet, Transaction, TransactionType, TransactionStatus

### Why
- For App #1 specifically, a single file would be fine (only 6 models).
- BUT: learning the split pattern now means it's already in place when the codebase grows.
- Bounded contexts give clear PR boundaries — billing changes never touch auth files.
- Each file fits on a screen; no scrolling to find a model.
- Multi-file is now a first-class Prisma feature (was a preview, became stable).

### Trade-off
- One more concept to understand vs single file.
- Need to update `prisma.config.ts` to point at a folder, not a file.
- Worth it: the cost of splitting later is much higher than the cost of starting split.

### When to split (heuristics for future projects)
- Single file: <15 models, tight coupling, small team
- Multiple files: >15 models, clear domain clustering, multiple teams

---

## ADR-013: Prisma 7 import path — use /client explicitly

**Date:** [today]
**Status:** Accepted

### Decision
Always import `PrismaClient` from `@/lib/generated/prisma/client`, not from `@/lib/generated/prisma` (the folder).

### Why
- Prisma 7's `prisma-client` generator produces multiple files: `client.ts`, `models.ts`, `enums.ts`, `commonInputTypes.ts`, etc.
- The folder-level import is ambiguous and can resolve to the wrong barrel file, producing a `PrismaClient` instance whose model methods (`.user`, `.wallet`) are undefined.
- Importing directly from `client.ts` is unambiguous and matches the official Prisma 7 docs.

### Symptom of getting this wrong
`prisma.user` (or any model accessor) is `undefined` at runtime. The import resolves and the type checks pass, but the instance has no model methods.

### Future-proof
If Prisma reorganizes their generated output in 8.x, we may need to revisit. For now, `/client` is correct.

---

## ADR-014: Project is ESM (`"type": "module"` in package.json)

**Date:** [today]
**Status:** Accepted

### Decision
Set `"type": "module"` in package.json. The whole project is ESM, not CommonJS.

### Why
- Prisma 7's generated client (`prisma-client` provider) is ESM-only. Without this, tsx loads it as CommonJS and model methods (`.user`, `.wallet`) come back undefined.
- Next.js 16 is ESM-friendly by default; no compatibility issues there.
- Modern JavaScript is ESM. Anything CommonJS-only in 2026 is legacy.

### Symptom of getting this wrong
`prisma.user` is undefined at runtime. The import succeeds, types check, but the instance has no model methods. Error stack shows CJS loader (`Module._compile (node:internal/modules/cjs/loader...)`).

### Impact
- All relative imports must include extensions in standalone scripts run by tsx. Next.js's bundler handles this automatically for app code.
- Any CommonJS-only npm package may need workarounds. None encountered so far.

---