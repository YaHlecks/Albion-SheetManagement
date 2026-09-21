#!/usr/bin/env node
/**
 * db:reset — wrapper that runs supabase/reset.sql with an explicit,
 * typed confirmation so it can never fire by accident in CI.
 *
 * ⚠️  DESTRUCTIVE: wipes all application tables (NOT auth.users).
 * Usage: npm run db:reset -- --yes     (or interactively confirm)
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";
import pg from "pg";

for (const f of [".env.local", ".env"]) {
  try {
    const raw = readFileSync(join(process.cwd(), f), "utf8");
    for (const line of raw.split("\n")) {
      const m = line.match(/^\s*DATABASE_URL\s*=\s*(.*)\s*$/);
      if (m && !process.env.DATABASE_URL) {
        process.env.DATABASE_URL = m[1].replace(/^["']|["']$/g, "");
      }
    }
  } catch { /* optional */ }
}

const url = process.env.DATABASE_URL;
if (!url) {
  console.error("DATABASE_URL is not set — nothing was touched.");
  process.exit(1);
}

const sql = readFileSync(join(process.cwd(), "supabase", "reset.sql"), "utf8");

const confirmed = process.argv.includes("--yes");
if (!confirmed) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const answer = await rl.question(
    "⚠️  This DELETES all application data (events, signups, profiles, audit logs). auth.users is preserved.\n" +
    `Target: ${url.replace(/:[^:@/]+@/, ":****@")}\nType RESET to continue: `,
  );
  rl.close();
  if (answer.trim() !== "RESET") {
    console.log("Aborted — nothing was changed.");
    process.exit(0);
  }
}

const client = new pg.Client({
  connectionString: url,
  ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
});
await client.connect();
try {
  await client.query(sql);
  console.error("✓ Application schema reset. Run `npm run db:push` to recreate it.");
} catch (err) {
  console.error(`Reset failed: ${err.message}`);
  process.exitCode = 1;
} finally {
  await client.end();
}
