#!/usr/bin/env node
/**
 * Applies supabase/migrations/*.sql to the database in DATABASE_URL.
 * Uses pg if available; otherwise prints the SQL for manual execution.
 */
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

const url = process.env.DATABASE_URL;
if (!url) {
  console.error(
    "DATABASE_URL is not set.\n" +
      "Set it to your Postgres connection string (found in Supabase → Project Settings → Database)\n" +
      "and run `npm run db:push` again.\n\n" +
      "Alternative: paste supabase/migrations/0001_init.sql into the Supabase SQL Editor."
  );
  process.exit(1);
}

const dir = join(process.cwd(), "supabase", "migrations");
const files = readdirSync(dir).filter((f) => f.endsWith(".sql")).sort();

let Client;
try {
  ({ Client } = await import("pg"));
} catch {
  console.error("The 'pg' package is not installed. Run:\n  npm install --no-save pg\nThen re-run npm run db:push.");
  process.exit(1);
}

const client = new Client({
  connectionString: url,
  ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
});

await client.connect();

for (const file of files) {
  const sql = readFileSync(join(dir, file), "utf8");
  process.stdout.write(`Applying ${file}… `);
  try {
    await client.query(sql);
    console.log("done.");
  } catch (err) {
    console.log("FAILED.");
    console.error(err.message);
    process.exitCode = 1;
    break;
  }
}

await client.end();
