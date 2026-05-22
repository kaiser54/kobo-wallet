# Kobo Wallet

A production-shaped Nigerian wallet app built around the patterns real fintechs actually use: a single-entry ledger, atomic balance updates, idempotent webhooks, provider-agnostic payment routing, and role-based access control.

Users sign up with email and password, top up their wallet via **Paystack** (with **Flutterwave** support added as a refactor in Phase 15), and see their own transaction history. Admins see every transaction across every user from a separate dashboard.

> Part of [**fintech-lab**](#related-projects) — a series of 8 production-shaped fintech apps exploring real-world patterns: ledger design, KYC tiers, card issuing, reconciliation, multi-currency settlement, and P2P escrow.

---

## Why this project exists

Most wallet tutorials teach you to do this:

```sql
UPDATE users SET balance = balance + 5000 WHERE id = ?;
```

This is wrong. It has no audit trail, it corrupts under concurrent writes, and it cannot be reconciled against a payment gateway. Every real fintech — from Kuda to Wise to Stripe — uses a **ledger** instead: the balance is not a stored number, it is the *sum of every transaction that ever happened*. The cached `balance_kobo` column is updated atomically in the same database transaction that inserts the ledger row, so the two can never drift.

This project demonstrates that pattern, and a handful of others that separate hobby code from production code:

- **Money stored as integers in the smallest unit (kobo)** — never floats, never naira-as-decimal.
- **Database-level idempotency** — a `UNIQUE` constraint on transaction references makes double-processing a webhook physically impossible, not just unlikely.
- **HMAC signature verification on every webhook** — using the raw request body, before any JSON parsing.
- **Thin routes, fat lib** — HTTP handlers do nothing but parse input and call a function. All business logic is testable without Next.js running.
- **Fail-fast configuration** — missing environment variables crash the app at boot, not when a customer tries to pay.
- **Hashed passwords and hashed reset tokens** — bcrypt for credentials, hashed single-use tokens for password resets. If the database leaks, nothing useful leaks with it.
- **Role-based access control** — every API route either requires a session, requires admin, or is explicitly public. There is no fourth category.
- **A reconciliation script** — verifies that every wallet balance equals the sum of its ledger entries. If they ever disagree, you have a bug, and you find out before the customer does.

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Framework | Next.js 15 (App Router) | Frontend + backend in one codebase |
| Language | TypeScript (strict) | Compile-time safety for money math |
| Database | PostgreSQL 16 | ACID transactions, JSONB for metadata |
| ORM | Prisma | Type-safe queries, readable schema, painless migrations |
| Auth | Auth.js v5 (Credentials provider) | Standard for Next.js, sessions handled, you control the schema |
| Password hashing | bcryptjs | Industry-standard, slow by design |
| Email | Resend + React Email | Modern transactional email, free tier sufficient for dev |
| Validation | Zod | Runtime input validation at every trust boundary |
| Styling | Tailwind CSS | Utility-first, no context-switching to CSS files |
| HTTP client | Axios | Better error handling than `fetch` for outbound API calls |
| Package manager | pnpm | Fast, disk-efficient, strict about dependencies |

---

## Architecture

```
┌────────────────┐    1. POST /api/wallet/topup/initialize
│   Browser      │       (with session cookie)
│  (logged in    │ ─────────────────────────────────────────┐
│   user)        │                                          │
└────────────────┘                                          ▼
        ▲                                          ┌──────────────────┐
        │ 2. redirect to                           │  Next.js API     │
        │    Paystack checkout                     │  /api/wallet/... │
        │                                          │  (requireAuth)   │
        │                                          └──────────────────┘
        │                                                  │
        │                                          3. INSERT pending
        │                                             transaction
        │                                             (scoped to user)
        │                                                  │
        │                                                  ▼
        │                                          ┌──────────────────┐
        │                                          │   PostgreSQL     │
        │                                          │  (single source  │
        │                                          │    of truth)     │
        │                                          └──────────────────┘
        │                                                  ▲
        │                                                  │
┌────────────────┐    4. user pays              7. credit │ wallet
│   Paystack     │ ◄───────────────────                    │ atomically
│    Checkout    │                                         │
└────────────────┘                                         │
        │                                          ┌──────────────────┐
        │ 5. webhook POST                          │  Next.js API     │
        └─────────────────────────────────────────►│  /api/webhooks   │
            (signed with HMAC-SHA512)              │   /paystack      │
                                                   └──────────────────┘
                                                          │
                                            6. verify signature,
                                               parse event, call
                                               creditWallet(userId, ...)
```

**Key principles encoded here:**

- The browser is never trusted. Auth cookies prove identity for user-initiated calls; HMAC signatures prove identity for webhook calls.
- The webhook is the source of truth for "did this payment succeed." Even if the user closes their browser at step 4, the webhook still arrives and the wallet is still credited.
- Every wallet operation is scoped to a user. There is no global "get wallet" — only `getWallet(userId)`.
- The admin dashboard reads from the same database with a different filter (no user scope), gated by middleware that requires `role === 'admin'`.

---

## Data model

Six tables. The three Auth.js plumbing tables are auto-managed; the others encode the ledger and password reset flow.

```
users
  id              uuid primary key
  email           text unique not null
  password_hash   text not null                  -- bcrypt, never plain
  name            text
  role            text not null default 'user'   -- 'user' | 'admin'
  email_verified  timestamptz                    -- null until verified
  created_at      timestamptz
  updated_at      timestamptz

wallets
  id              uuid primary key
  user_id         uuid references users(id) unique
  balance_kobo    bigint not null default 0      -- cached; sum of ledger entries
  currency        text not null default 'NGN'
  created_at      timestamptz
  updated_at      timestamptz

transactions                                     -- the ledger
  id              uuid primary key
  wallet_id       uuid references wallets(id)
  user_id         uuid references users(id)      -- denormalized for admin queries
  reference       text unique not null           -- our reference; idempotency anchor
  type            text not null                  -- 'credit' | 'debit'
  amount_kobo     bigint not null                -- always positive; type carries the sign
  status          text not null                  -- 'pending' | 'success' | 'failed'
  source          text not null                  -- 'topup' | 'simulated_debit' | ...
  gateway         text                           -- 'paystack' | 'flutterwave' | null
  gateway_ref     text                           -- the gateway's own reference
  metadata        jsonb                          -- raw gateway response, for audit
  created_at      timestamptz
  updated_at      timestamptz

password_reset_tokens
  id              uuid primary key
  user_id         uuid references users(id)
  token_hash      text unique not null           -- we hash reset tokens too
  expires_at      timestamptz not null
  used_at         timestamptz                    -- null until consumed
  created_at      timestamptz

-- Auth.js plumbing (managed by @auth/prisma-adapter)
sessions          (id, user_id, expires, session_token)
verification_tokens (identifier, token, expires)
```

A few design notes:

- **`user_id` on transactions** is denormalized — technically `wallet → user` is enough, but having it on every transaction makes admin queries faster and the ledger simpler to query directly.
- **`password_hash`, not `password`.** Plain passwords are never stored.
- **`token_hash`, not `token`** on reset tokens. The plain token is sent in the email; only the hash is in the DB. Same rationale.
- **`used_at` timestamp on reset tokens** — single-use enforced at the row level.
- **`role` as text with two values** — `user` and `admin`. Simple, expandable.

---

## Authorization model

| Page | Anonymous | User | Admin |
|---|---|---|---|
| `/` (landing) | ✓ | redirected to `/dashboard` | redirected to `/dashboard` |
| `/login`, `/signup` | ✓ | redirected to `/dashboard` | redirected to `/dashboard` |
| `/forgot-password`, `/reset-password` | ✓ | ✓ | ✓ |
| `/dashboard` (own wallet) | redirected to `/login` | ✓ (own data only) | ✓ (own data only) |
| `/admin` (all data) | 404 | 404 | ✓ |

Every API route belongs to one of three categories — public, authenticated, or admin-only — and the gate is enforced in `lib/auth/session.ts` via three helpers: `getCurrentUser()`, `requireAuth()`, `requireAdmin()`. Route handlers contain one line of authorization, no exceptions.

The admin does **not** get a "view as user" capability. That's a separate feature with separate security implications and is deliberately out of scope.

---

## Getting started

### Prerequisites

- Node.js 20+ (Node 22 recommended)
- pnpm 9+
- PostgreSQL 16+ running locally, or a Neon/Supabase free-tier database
- A Paystack test account ([sign up free](https://paystack.com))
- A Resend account for transactional email ([sign up free](https://resend.com))

### Setup

```bash
# Clone and install
git clone https://github.com/YOUR-USERNAME/kobo-wallet.git
cd kobo-wallet
pnpm install

# Configure environment
cp .env.example .env.local
# fill in DATABASE_URL, NEXTAUTH_SECRET, NEXTAUTH_URL,
# PAYSTACK_SECRET_KEY, PAYSTACK_PUBLIC_KEY,
# RESEND_API_KEY, EMAIL_FROM

# Set up the database
pnpm prisma migrate dev
pnpm tsx scripts/seed.ts   # creates one user and one admin

# Run
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000). Sign up for a new account, or log in with the seeded credentials (printed when seed runs).

### Testing the top-up flow

Sign up → log in → click "Top up" → enter amount → pay with Paystack test card:

| Field | Value |
|---|---|
| Card number | `4084 0840 8408 4081` |
| Expiry | any future date |
| CVV | `408` |
| PIN | `0000` |
| OTP | `123456` |

The webhook fires automatically; your balance updates on next page load.

### Exposing localhost for webhooks (dev)

Paystack needs to reach your local server. Use ngrok:

```bash
ngrok http 3000
```

Set the HTTPS URL as your webhook URL in Paystack dashboard under **Settings → API Keys & Webhooks**, appending `/api/webhooks/paystack`.

---

## Project structure

```
kobo-wallet/
├── app/                              # Routes only — no business logic
│   ├── (auth)/                       # Public auth pages (centered card layout)
│   │   ├── login/page.tsx
│   │   ├── signup/page.tsx
│   │   ├── forgot-password/page.tsx
│   │   └── reset-password/page.tsx
│   ├── (dashboard)/                  # Authenticated pages (sidebar shell)
│   │   ├── layout.tsx
│   │   ├── dashboard/page.tsx        # User's wallet
│   │   └── admin/
│   │       ├── page.tsx              # All transactions
│   │       └── users/[id]/page.tsx   # Drill into a user
│   ├── payment/callback/page.tsx     # Where Paystack redirects after pay
│   ├── page.tsx                      # Landing page
│   └── api/
│       ├── auth/
│       │   ├── [...nextauth]/route.ts    # Auth.js handler
│       │   ├── signup/route.ts
│       │   ├── forgot-password/route.ts
│       │   └── reset-password/route.ts
│       ├── wallet/
│       │   ├── route.ts                  # GET own wallet
│       │   ├── topup/initialize/route.ts
│       │   └── debit/simulate/route.ts
│       ├── transactions/[reference]/route.ts
│       ├── admin/
│       │   ├── transactions/route.ts
│       │   └── users/route.ts
│       └── webhooks/paystack/route.ts
│
├── lib/                              # All business logic
│   ├── auth/
│   │   ├── config.ts                 # Auth.js configuration
│   │   ├── password.ts               # hash(), verify() — bcrypt
│   │   ├── reset-tokens.ts           # generate, hash, verify, consume
│   │   └── session.ts                # getCurrentUser, requireAuth, requireAdmin
│   ├── db/
│   │   ├── client.ts                 # Prisma client singleton
│   │   └── seed.ts
│   ├── ledger/
│   │   ├── credit.ts                 # creditWallet(userId, ...)
│   │   ├── debit.ts                  # debitWallet(userId, ...)
│   │   ├── balance.ts
│   │   └── errors.ts
│   ├── payments/
│   │   └── paystack.ts               # initialize + verifySignature
│   ├── email/
│   │   ├── client.ts                 # Resend client
│   │   └── templates/
│   │       └── password-reset.tsx    # React Email template
│   ├── validation/
│   │   ├── auth.ts                   # zod: signup, login, reset
│   │   ├── topup.ts
│   │   └── webhooks.ts
│   ├── money.ts                      # kobo ↔ naira, integer-safe
│   ├── reference.ts
│   ├── logger.ts
│   └── config.ts                     # typed env loader, fails fast on boot
│
├── components/                       # React components
│   ├── ui/                           # Primitives (Button, Input, Modal)
│   ├── auth/
│   │   ├── LoginForm.tsx
│   │   ├── SignupForm.tsx
│   │   ├── ForgotPasswordForm.tsx
│   │   └── ResetPasswordForm.tsx
│   ├── wallet/
│   │   ├── BalanceCard.tsx
│   │   ├── TopUpModal.tsx
│   │   ├── TransactionList.tsx
│   │   └── TransactionRow.tsx
│   ├── admin/
│   │   ├── AllTransactionsTable.tsx
│   │   └── UsersTable.tsx
│   └── shared/
│       ├── Spinner.tsx
│       └── EmptyState.tsx
│
├── prisma/
│   ├── schema.prisma
│   └── migrations/
│
├── scripts/
│   ├── seed.ts                       # Creates user + admin
│   ├── reconcile.ts                  # Audit: balance == sum(ledger)?
│   └── replay-webhook.ts
│
├── types/
│   └── index.ts                      # Shared TypeScript types + Auth.js augmentation
│
├── middleware.ts                     # Route protection (project root)
├── .env.local                        # Secrets (gitignored)
├── .env.example                      # Template (committed, no values)
└── README.md
```

The cardinal rules:

- **The `app/` folder contains only routes.** Route handlers are 10-20 lines: parse input, call a `lib/` function, return response.
- **`lib/ledger/` is the only place that touches the wallets table.** API routes never write to `wallets` directly — they call `creditWallet()` or `debitWallet()`.
- **`lib/auth/session.ts` is the only place that resolves the current user.** Routes call `requireAuth()` or `requireAdmin()` once and trust the return value.

---

## Production-grade patterns demonstrated

| Pattern | Where to see it |
|---|---|
| Single-entry ledger | `lib/ledger/` |
| Atomic credit/debit | `lib/ledger/credit.ts`, `lib/ledger/debit.ts` |
| Database-level idempotency | `unique` constraint on `transactions.reference` |
| HMAC webhook verification | `lib/payments/paystack.ts` |
| bcrypt password hashing | `lib/auth/password.ts` |
| Hashed single-use reset tokens | `lib/auth/reset-tokens.ts` |
| Route protection middleware | `middleware.ts` |
| Role-based authorization | `lib/auth/session.ts` (`requireAdmin`) |
| Fail-fast configuration | `lib/config.ts` |
| Money-as-integers | `lib/money.ts` (no floats anywhere) |
| Input validation at trust boundaries | `lib/validation/` |
| Reconciliation script | `scripts/reconcile.ts` |
| Provider abstraction *(Phase 15)* | `lib/payments/index.ts` |

---

## Roadmap

This project is built in phases. Each phase produces something testable end-to-end.

- [x] Phase 1 — Foundation
- [ ] Phase 2 — Database & schema (users, wallets, transactions, auth tables, reset tokens)
- [ ] Phase 3 — Environment & secrets (Paystack, Auth.js, Resend)
- [ ] Phase 4 — Core ledger logic (user-scoped)
- [ ] Phase 5 — Paystack integration
- [ ] Phase 6 — Auth.js setup + signup/login pages
- [ ] Phase 7 — Password reset flow with Resend
- [ ] Phase 8 — Route protection middleware + admin role gating
- [ ] Phase 9 — Wallet API routes (user-scoped) + Admin API routes
- [ ] Phase 10 — Wallet dashboard UI (own data only)
- [ ] Phase 11 — Admin dashboard UI (all data)
- [ ] Phase 12 — Payment callback page
- [ ] Phase 13 — End-to-end testing & chaos drills (incl. auth attacks)
- [ ] Phase 14 — Polish, reconciliation, structured logging
- [ ] Phase 15 — Flutterwave integration (the provider abstraction refactor)

---

## What this project deliberately does *not* do

To stay focused, the following are out of scope (they're built in other apps in the series):

- **Email verification on signup** — accounts are usable immediately. Easy to add later if needed.
- **Two-factor authentication** — out of scope for App #1.
- **Multi-currency** — NGN only. Multi-currency checkout is `fxcheckout`.
- **KYC** — anyone can sign up. KYC tiers are `verify-kyc`.
- **Outbound transfers** — debits are simulated. Real outbound transfers need a bank-grade compliance regime.
- **Production deployment** — runs locally. Deployment is straightforward (Vercel + Neon) but not the point.

---

## Related projects

This is App #1 in the **fintech-lab** series. Each app is independently runnable but shares the same engineering principles.

1. **kobo-wallet** *(this repo)* — wallet with Paystack/Flutterwave top-ups, ledger, and role-based auth
2. **fxcheckout** — multi-currency checkout with FX rates and settlement currency handling *(coming)*
3. **reconciler** — gateway vs internal-ledger reconciliation tooling *(coming)*
4. **verify-kyc** — KYC/KYB onboarding with tiered limits *(coming)*
5. **cardforge** — virtual card management *(coming)*
6. **piggykit** — savings dashboard with interest accrual *(coming)*
7. **loanflow** — loan dashboard with amortization *(coming)*
8. **peerswap** — P2P trading interface with escrow *(coming)*

---

## License

MIT