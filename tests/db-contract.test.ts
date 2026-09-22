import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Frontend ↔ database column-contract regression guards.
 *
 * The original incidents this file prevents:
 *   * notifications.type does not exist  → PGRST204/42703 on every
 *     notification load (bell + /notifications page silently empty)
 *   * ensure_profile() does not exist    → PostgREST 404 on the login page
 *
 * Every UI file that touches notifications must go through
 * src/lib/notifications.ts (which selects `kind`) or select `kind` directly —
 * never a `type` column, which the database does not have.
 */

function listFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...listFiles(p));
    else if (/\.(tsx?|mjs)$/.test(entry.name)) out.push(p);
  }
  return out;
}

const SRC_FILES = listFiles(join(process.cwd(), "src"));
const src = (f: string) => readFileSync(f, "utf8");

describe("notifications contract", () => {
  it("src/lib/notifications.ts selects `kind` (the real column)", () => {
    const content = src(join(process.cwd(), "src", "lib", "notifications.ts"));
    expect(content).toMatch(/NOTIFICATION_SELECT = "id, title, body, kind, read, link, created_at"/);
    expect(content).not.toMatch(/\btype,\s*read\b/);
  });

  it("no source file selects a notifications `type` column", () => {
    const offenders = SRC_FILES.filter((f) => {
      const c = src(f);
      return (
        /from\(\s*"notifications"\s*\)/.test(c) ||
        /NOTIFICATION_SELECT|fetchNotifications/.test(c)
      ) && /\.select\(\s*"[^"]*\btype\b[^"]*"/.test(c);
    });
    expect(offenders, `files selecting a nonexistent 'type' column: ${offenders.join(", ")}`).toEqual([]);
  });

  it("UI code styles notifications by `kind`, never by `type`", () => {
    const offenders = SRC_FILES.filter((f) => src(f).match(/\bn\.type\b|notification.*\.type ===/) && !f.includes("node_modules"));
    expect(offenders.join(", ")).toBe("");
  });
});

describe("auth/profile RPC contract", () => {
  const migrations = [
    "0001_init.sql",
    "0002_auth_profile_layer.sql",
  ].map((f) => readFileSync(join(process.cwd(), "supabase", "migrations", f), "utf8")).join("\n");

  it("defines every RPC the frontend calls", () => {
    for (const rpc of ["ensure_profile\\(\\)", "touch_login\\(\\)", "check_ign_available\\(", "claim_first_admin\\(\\)", "update_own_profile\\("]) {
      expect(migrations).toMatch(new RegExp(`create or replace function public\\.${rpc}`));
    }
  });

  it("members save their profile through the update_own_profile RPC", () => {
    const form = src(join(process.cwd(), "src", "components", "profile-form.tsx"));
    expect(form).toMatch(/rpc\(\s*"update_own_profile"/);
    expect(form).not.toMatch(/from\(\s*"profiles"\s*\)[\s\S]*?\.update\(/);
  });
});

describe("signup double-submit guards", () => {
  it("member event view serializes claim/leave actions", () => {
    const view = src(join(process.cwd(), "src", "components", "member-event-view.tsx"));
    expect(view).toMatch(/actionBusy/);
  });

  it("claim modal blocks re-submission while busy", () => {
    const sheet = src(join(process.cwd(), "src", "components", "event-sheet.tsx"));
    expect(sheet).toMatch(/if \(!claimSlot \|\| busy\) return/);
  });
});
