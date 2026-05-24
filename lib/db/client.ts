/**
 * Prisma Client singleton.
 *
 * WHY a singleton: in Next.js dev mode, every code change reloads modules,
 * which can create many PrismaClient instances. Each one opens its own pool
 * of database connections. After a few minutes of hot reload, you exhaust
 * Postgres's max_connections (default 100) and the app stops working.
 *
 * The trick: store the client on `globalThis` (which survives reloads in dev)
 * so we only ever have one. In production this isn't needed — there's no
 * hot reload — but the same code is safe to run.
 *
 * Pattern from official Prisma docs: https://www.prisma.io/docs/guides/nextjs
 *
 * WHY we wire the PrismaPg adapter explicitly: Prisma 7 dropped the built-in
 * Rust query engine. Drivers are now BYO — we provide @prisma/adapter-pg
 * wrapping the `pg` driver. This makes the runtime smaller and deploy-anywhere.
 */

import { PrismaClient } from "@/lib/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import { config } from "@/lib/config";

// WHY this declaration: TypeScript doesn't know about our custom `prisma`
// property on globalThis. We tell it with `declare global` so the
// `globalThis.prisma` access below type-checks.
declare global {
  var prisma: PrismaClient | undefined;
}

function createPrismaClient() {
  const adapter = new PrismaPg({
    connectionString: config.DATABASE_URL,
  });

  return new PrismaClient({
    adapter,
    // WHY log queries in development only: helpful for debugging,
    // noisy and slow in production. The `error` level always logs.
    log:
      config.NODE_ENV === "development"
        ? ["query", "error", "warn"]
        : ["error"],
  });
}

export const prisma = globalThis.prisma ?? createPrismaClient();

// WHY only cache the global in non-production: in production we WANT a
// fresh client per process, never a shared one. In dev we WANT to reuse
// across hot reloads.
if (config.NODE_ENV !== "production") {
  globalThis.prisma = prisma;
}