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