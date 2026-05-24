/**
 * Typed, validated configuration loader.
 *
 * WHY this file exists: a single source of truth for every environment
 * variable the app uses. Loading and validating happens once, on boot.
 * If anything is missing or malformed, the app crashes immediately with
 * a clear error pointing at the exact problem.
 *
 * USAGE: import { config } from "@/lib/config";
 *        config.PAYSTACK_SECRET_KEY  // <- fully typed, guaranteed non-null
 *
 * NEVER read process.env directly anywhere else in the app. The reason:
 * - Bypasses validation (could be undefined and you wouldn't know).
 * - Loses type safety (every process.env.X is `string | undefined`).
 * - Hides which env vars the app actually depends on.
 */

import { z } from "zod";

// =============================================================================
// SCHEMA
// =============================================================================
// One zod object describing every env var we expect.
// Each field documents itself: type, format, minimum length, etc.

const ConfigSchema = z.object({
  // ---------------------------------------------------------------------------
  // DATABASE
  // ---------------------------------------------------------------------------
  DATABASE_URL: z
    .string()
    .min(1, "DATABASE_URL is required")
    .url("DATABASE_URL must be a valid URL")
    .refine(
      (url) => url.startsWith("postgresql://") || url.startsWith("postgres://"),
      "DATABASE_URL must be a postgresql:// connection string",
    ),

  // ---------------------------------------------------------------------------
  // AUTH.JS
  // ---------------------------------------------------------------------------
  // Minimum 32 chars to be cryptographically secure. Auth.js will technically
  // accept shorter, but we enforce a higher bar.
  AUTH_SECRET: z
    .string()
    .min(32, "AUTH_SECRET must be at least 32 characters (use `openssl rand -base64 33`)"),

  // ---------------------------------------------------------------------------
  // PAYSTACK
  // ---------------------------------------------------------------------------
  // Test keys start with sk_test_ / pk_test_; live keys with sk_live_ / pk_live_.
  // We accept both so this same code works in production, but we'll add a check
  // later that prevents accidentally running test keys against production data.
  PAYSTACK_SECRET_KEY: z
    .string()
    .min(1, "PAYSTACK_SECRET_KEY is required")
    .regex(/^sk_(test|live)_/, "PAYSTACK_SECRET_KEY must start with sk_test_ or sk_live_"),

  PAYSTACK_PUBLIC_KEY: z
    .string()
    .min(1, "PAYSTACK_PUBLIC_KEY is required")
    .regex(/^pk_(test|live)_/, "PAYSTACK_PUBLIC_KEY must start with pk_test_ or pk_live_"),

  // ---------------------------------------------------------------------------
  // RESEND (transactional email)
  // ---------------------------------------------------------------------------
  RESEND_API_KEY: z
    .string()
    .min(1, "RESEND_API_KEY is required")
    .regex(/^re_/, "RESEND_API_KEY must start with re_"),

  EMAIL_FROM: z
    .string()
    .min(1, "EMAIL_FROM is required")
    .email("EMAIL_FROM must be a valid email address"),

  // ---------------------------------------------------------------------------
  // APP
  // ---------------------------------------------------------------------------
  APP_URL: z
    .string()
    .min(1, "APP_URL is required")
    .url("APP_URL must be a valid URL (e.g. http://localhost:3000)"),

  // Node's standard NODE_ENV. Defaults to "development" if not set.
  // We don't crash if missing — tools set it implicitly.
  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),
});

// =============================================================================
// PARSE & EXPORT
// =============================================================================
// This runs at import time. The first import of this module triggers
// validation, so if anything is wrong the app dies immediately with a
// readable error pointing at the offending var.

function loadConfig() {
  const result = ConfigSchema.safeParse(process.env);

  if (!result.success) {
    // WHY format manually: zod's default error output is JSON, which is hard
    // to read in a terminal. We turn each issue into a one-line message.
    const issues = result.error.issues
      .map((i) => `  - ${i.path.join(".")}: ${i.message}`)
      .join("\n");

    // We log AND throw. The log makes it visible even if the throw is
    // swallowed by something upstream (rare, but defensive).
    const message = `\n❌ Invalid environment configuration:\n${issues}\n\nCheck .env.local against .env.example.\n`;
    console.error(message);
    throw new Error("Invalid environment configuration. See logs above.");
  }

  return result.data;
}

export const config = loadConfig();

// =============================================================================
// TYPE EXPORT
// =============================================================================
// Other files can import this if they need to type a function parameter
// as "a config object." Rarely needed in practice; the singleton above is enough.
export type Config = typeof config;