/**
 * Verify Phase 3 setup: config loads, Prisma connects, schema is reachable.
 * Run with: pnpm tsx scripts/verify-setup.ts
 *
 * This script is just for confirming the wiring. Delete it after Phase 3
 * if you like — or keep it as a smoke-test you can run anytime.
 */

import "dotenv/config";
import { config as loadEnv } from "dotenv";
loadEnv({ path: ".env.local" });

import { config } from "@/lib/config";
import { prisma } from "@/lib/db/client";

async function main() {
  console.log("✅ Config loaded successfully.");
  console.log(`   NODE_ENV: ${config.NODE_ENV}`);
  console.log(`   DATABASE_URL: ${config.DATABASE_URL.replace(/:.*@/, ":****@")}`);
  console.log(`   APP_URL: ${config.APP_URL}`);

  // Count rows in each table — proves we can hit the DB.
  const userCount = await prisma.user.count();
  const walletCount = await prisma.wallet.count();
  const txCount = await prisma.transaction.count();

  console.log("\n✅ Database connected. Row counts:");
  console.log(`   users:        ${userCount}`);
  console.log(`   wallets:      ${walletCount}`);
  console.log(`   transactions: ${txCount}`);

  await prisma.$disconnect();
  console.log("\n🎉 Phase 3 wiring verified.\n");
}

main().catch((err) => {
  console.error("\n❌ Verification failed:\n", err);
  process.exit(1);
});