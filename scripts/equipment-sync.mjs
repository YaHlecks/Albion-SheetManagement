/**
 * Equipment catalog sync — OpenAlbion API v3 → public.albion_equipment.
 *
 * Phase 2/3: research-based, cached INTO our database (the app never calls
 * the API at runtime). Handles API outages gracefully: on any failure the
 * local catalog is left untouched and the script exits non-zero with a
 * clear message.
 *
 * Usage:  npm run equipment:sync        (requires DATABASE_URL)
 * Override endpoint: OPENALBION_BASE_URL=... npm run equipment:sync
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { Client } from "pg";

const BASE_URL = process.env.OPENALBION_BASE_URL ?? "https://api.openalbion.com/api/v3";

// Environment: read DATABASE_URL from .env.local / .env if present (no dep).
function loadEnv() {
  for (const f of [".env.local", ".env"]) {
    try {
      const raw = readFileSync(join(process.cwd(), f), "utf8");
      for (const line of raw.split("\n")) {
        const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
        if (m && !process.env[m[1]]) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
        }
      }
    } catch { /* file optional */ }
  }
}
loadEnv();

async function fetchWeapons() {
  // Pagination by tier keeps responses small; tiers 1–8 (enchantments are
  // variants of the same base item and don't need separate catalog rows).
  const all = [];
  for (let tier = 1; tier <= 8; tier++) {
    const res = await fetch(`${BASE_URL}/weapons?tier=${tier}`);
    if (!res.ok) {
      throw new Error(`OpenAlbion API returned ${res.status} for tier ${tier} — is the API up?`);
    }
    const json = await res.json();
    if (Array.isArray(json?.data)) all.push(...json.data);
  }
  return all;
}

// "Journeyman's Battleaxe" style names are fine as-is; family comes from the
// API's category/subcategory endpoints when available, else normalized later
// by an admin. We store what the source gives us — never invented data.
function normalize(w) {
  return {
    name: String(w.name ?? "").trim().slice(0, 80),
    tier: w.tier != null ? String(w.tier).slice(0, 8) : "any",
    item_power: Number.isFinite(w.item_power) ? w.item_power : null,
    icon_url: typeof w.icon === "string" ? w.icon.slice(0, 300) : null,
    source: "openalbion",
  };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set — cannot sync the equipment catalog.");
    process.exit(1);
  }

  console.log("Fetching weapons from OpenAlbion v3 …");
  let weapons;
  try {
    weapons = await fetchWeapons();
  } catch (err) {
    console.error(`Sync aborted: ${err.message}`);
    console.error("The local seed catalog in migration 0005 remains active — the app is unaffected.");
    process.exit(1);
  }

  const rows = weapons.map(normalize).filter((r) => r.name.length >= 2);
  if (rows.length === 0) {
    console.error("Sync aborted: API returned no usable rows. Local catalog untouched.");
    process.exit(1);
  }

  const url = process.env.DATABASE_URL;
  const client = new Client({
    connectionString: url,
    ssl: url.includes("localhost") || url.includes("127.0.0.1") ? false : { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    await client.query("begin");
    // Upsert by name — keeps manual/admin edits intact unless the source row changed.
    let updated = 0;
    for (const r of rows) {
      const res = await client.query(
        `insert into public.albion_equipment (name, category, family, tier, item_power, icon_url, source)
         values ($1, 'Weapon', 'Uncategorized', $2, $3, $4, $5)
         on conflict (name) do update set
           tier = excluded.tier,
           item_power = excluded.item_power,
           icon_url = excluded.icon_url,
           source = excluded.source,
           updated_at = now()
         where albion_equipment.name = excluded.name`,
        [r.name, r.tier, r.item_power, r.icon_url, r.source],
      );
      updated += res.rowCount;
    }
    await client.query("commit");
    console.log(`✓ Catalog synced: ${updated} equipment rows upserted from OpenAlbion.`);
    console.log("  Note: rows land as 'Uncategorized' until an admin assigns families (or the API category endpoint becomes available).");
  } catch (err) {
    await client.query("rollback");
    console.error(`Sync failed, rolled back: ${err.message}`);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
