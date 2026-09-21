import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Regression guards for migration 0004 (Albion mass sheets).
 *
 * Encoded mechanical facts:
 *   * Every mass_* table: RLS enabled, anon = zero access, authenticated =
 *     SELECT-only at grant level. All writes flow through security-definer
 *     RPCs that re-verify identity/role/status inside the database.
 *   * UNIQUE(slot_id) on mass_assignments makes concurrent claims race-safe
 *     at the storage layer; the RPC maps the loss to SLOT_TAKEN.
 *   * No policy may reference its own table (42P17 recursion guard).
 */
const sql = readFileSync(
  join(process.cwd(), "supabase", "migrations", "0004_mass_sheets.sql"),
  "utf8",
);

const TABLES = ["mass_sheets", "mass_parties", "mass_slots", "mass_assignments"];

describe("0004 mass sheets — tables & constraints", () => {
  it("creates all four tables with FKs to teams/mass chains", () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`create table if not exists public\\.${t}`));
    }
    expect(sql).toMatch(/mass_sheets\s*\(\s*[\s\S]*?team_id uuid not null references public\.teams\(id\)/);
    expect(sql).toMatch(/mass_parties\s*\(\s*[\s\S]*?sheet_id uuid not null references public\.mass_sheets\(id\) on delete cascade/);
    expect(sql).toMatch(/mass_slots\s*\(\s*[\s\S]*?party_id uuid not null references public\.mass_parties\(id\) on delete cascade/);
    expect(sql).toMatch(/mass_assignments\s*\(\s*[\s\S]*?slot_id uuid not null unique references public\.mass_slots\(id\)/);
  });

  it("stores massing time as a sortable timestamptz (not a string)", () => {
    expect(sql).toMatch(/mass_at timestamptz/);
  });

  it("constrains sheet status and slot priority", () => {
    expect(sql).toMatch(/status in \('draft','published','locked','archived'\)/);
    expect(sql).toMatch(/priority in \('high','normal','low'\)/);
  });

  it("indexes the hot lookup paths", () => {
    expect(sql).toMatch(/mass_sheets_team_idx/);
    expect(sql).toMatch(/mass_parties_sheet_idx/);
    expect(sql).toMatch(/mass_slots_party_idx/);
    expect(sql).toMatch(/mass_assignments_user_idx/);
  });
});

describe("0004 mass sheets — claim concurrency (§15)", () => {
  it("enforces one active assignment per slot via UNIQUE at storage level", () => {
    expect(sql).toMatch(/slot_id uuid not null unique references public\.mass_slots/);
  });

  it("claim RPC detects the silent no-op race and returns SLOT_TAKEN", () => {
    expect(sql).toMatch(/on conflict \(slot_id\) do update\s*\n\s*set ign = excluded\.ign/);
    expect(sql).toMatch(/Race guard[\s\S]*?SLOT_TAKEN/);
  });

  it("claim verifies membership, approval and sheet status in-database", () => {
    expect(sql).toMatch(/function public\.claim_mass_slot[\s\S]*?NOT_TEAM_MEMBER/);
    expect(sql).toMatch(/function public\.claim_mass_slot[\s\S]*?ACCOUNT_NOT_APPROVED/);
    expect(sql).toMatch(/function public\.claim_mass_slot[\s\S]*?SHEET_NOT_OPEN/);
  });

  it("identity always comes from auth.uid(), never from the client", () => {
    const fn = sql.match(/function public\.claim_mass_slot[\s\S]*?\$\$;/)![0];
    expect(fn).toMatch(/values \(p_slot_id, auth\.uid\(\), v_ign/);
    expect(fn).not.toMatch(/p_user_id/);
  });
});

describe("0004 mass sheets — grants (§23/§24: grant + policy + RPC)", () => {
  it("gives authenticated SELECT only on every mass table", () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`grant select on public\\.${t}\\s+to authenticated`));
      expect(sql).toMatch(new RegExp(`revoke insert, update, delete[\\s\\S]{0,400}?on public\\.[\\s\\S]*?from authenticated`));
    }
  });

  it("keeps anon at zero access", () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`revoke all on public\\.${t}\\s+from anon`));
    }
  });

  it("gives service_role full access (server-side only)", () => {
    expect(sql).toMatch(/grant select, insert, update, delete\s+on public\.mass_sheets[\s\S]*?to service_role/);
  });

  it("grants EXECUTE on all RPCs to authenticated + service_role", () => {
    for (const fn of [
      "claim_mass_slot\\(uuid, text\\)",
      "unclaim_mass_slot\\(uuid\\)",
      "save_mass_sheet\\(uuid, jsonb\\)",
      "duplicate_mass_sheet\\(uuid\\)",
      "set_mass_sheet_status\\(uuid, text\\)",
      "admin_set_slot_assignment\\(uuid, uuid, text\\)",
    ]) {
      expect(sql).toMatch(new RegExp(`grant execute on function public\\.${fn}\\s+to authenticated, service_role`));
    }
  });
});

describe("0004 mass sheets — RLS (no weakening, no recursion)", () => {
  it("enables RLS on every mass table", () => {
    for (const t of TABLES) {
      expect(sql).toMatch(new RegExp(`alter table public\\.${t}\\s+enable row level security`));
    }
  });

  it("select policies cascade visibility through security-definer helpers", () => {
    expect(sql).toMatch(/create policy "mass_sheets: team and admins read"[\s\S]*?using \(public\.is_mass_sheet_visible\(id\)\)/);
    expect(sql).toMatch(/create policy "mass_parties: sheet-visible read"[\s\S]*?using \(public\.is_mass_party_visible\(id\)\)/);
    expect(sql).toMatch(/create policy "mass_slots: party-visible read"[\s\S]*?using \(public\.is_mass_slot_visible\(id\)\)/);
    expect(sql).toMatch(/create policy "mass_assignments: sheet-visible read"[\s\S]*?using \(public\.is_mass_slot_visible\(slot_id\)\)/);
  });

  it("helpers are security definer (42P17-safe) and check team membership", () => {
    expect(sql).toMatch(/function public\.is_mass_sheet_visible[\s\S]*?security definer/);
    expect(sql).toMatch(/is_mass_sheet_visible[\s\S]*?team_members tm\s*\n\s*where tm\.team_id = s\.team_id and tm\.user_id = auth\.uid\(\)/);
  });

  it("member assignment policy is ownership + published-status scoped", () => {
    expect(sql).toMatch(/create policy "mass_assignments: own row on published"[\s\S]*?user_id = auth\.uid\(\)[\s\S]*?m\.status = 'published'/);
  });

  it("no policy or helper reads the table it protects (recursion guard)", () => {
    const policies = sql.split(/create policy /).slice(1);
    const selfRefs: string[] = [];
    for (const p of policies) {
      const name = p.match(/"([^"]+)"/)?.[1] ?? "?";
      const body = p.slice(p.indexOf("using"));
      for (const t of TABLES) {
        if (name.includes(t) && body.includes(`from public.${t}`)) selfRefs.push(name);
      }
    }
    expect(selfRefs).toEqual([]);
  });
});

describe("0004 mass sheets — structure & lifecycle RPCs", () => {
  it("save RPC is admin-only and creates a SHEET_CREATED audit row", () => {
    expect(sql).toMatch(/function public\.save_mass_sheet[\s\S]*?FORBIDDEN/);
    expect(sql).toMatch(/'SHEET_CREATED', v_actor/);
    expect(sql).toMatch(/'SHEET_UPDATED', v_actor/);
  });

  it("duplicate copies structure but starts empty and draft (§26)", () => {
    const fn = sql.match(/function public\.duplicate_mass_sheet[\s\S]*?\$\$;/)![0];
    expect(fn).toMatch(/'draft', v_actor/);
    expect(fn).not.toMatch(/mass_assignments/);
  });

  it("status RPC audits every lifecycle transition", () => {
    expect(sql).toMatch(/'SHEET_PUBLISHED'/);
    expect(sql).toMatch(/'SHEET_LOCKED'/);
    expect(sql).toMatch(/'SHEET_ARCHIVED'/);
    expect(sql).toMatch(/'SHEET_RESTORED'/);
  });

  it("admin assignment RPC re-checks approval and audits moves vs assigns", () => {
    expect(sql).toMatch(/function public\.admin_set_slot_assignment[\s\S]*?USER_NOT_APPROVED/);
    expect(sql).toMatch(/'MEMBER_MOVED'/);
    expect(sql).toMatch(/'MEMBER_ASSIGNED'/);
  });
});

describe("0004 mass sheets — realtime publication (§18)", () => {
  it("adds assignments + sheets to supabase_realtime when present", () => {
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.mass_assignments/);
    expect(sql).toMatch(/alter publication supabase_realtime add table public\.mass_sheets/);
  });
});

describe("mass client helpers", async () => {
  const { composeMassAt, sheetStats, friendlyClaimError, MassSheetError } = await import("../src/lib/mass");

  it("composes UTC instants from date+time+timezone", () => {
    const at = composeMassAt("2026-09-25", "13:30", "UTC");
    expect(at).toBe(new Date("2026-09-25T13:30:00Z").toISOString());
  });

  it("returns null for incomplete time inputs", () => {
    expect(composeMassAt("", "13:30", "UTC")).toBeNull();
    expect(composeMassAt("2026-09-25", "", "UTC")).toBeNull();
  });

  it("handles non-integer offsets like half-hour timezones", () => {
    const at = composeMassAt("2026-09-25", "13:30", "Asia/Kolkata");
    expect(at).toBe(new Date("2026-09-25T08:00:00Z").toISOString());
  });

  it("computes fill stats including per-party breakdown", () => {
    const mkSlot = (filled: boolean) => ({
      id: Math.random().toString(), party_id: "p", role: "Tank", build_name: "B",
      priority: "normal" as const, notes: null, required: true, sort_order: 0,
      mass_assignments: filled ? [{ id: "a", slot_id: "s", user_id: "u", ign: "X", assigned_at: "", assigned_by: null }] : [],
    });
    const sheet = {
      mass_parties: [
        { mass_slots: [mkSlot(true), mkSlot(false)] },
        { mass_slots: [mkSlot(true)] },
      ],
    };
    const s = sheetStats(sheet as never);
    expect(s.total).toBe(3);
    expect(s.filled).toBe(2);
    expect(s.open).toBe(1);
    expect(s.perParty).toHaveLength(2);
    expect(s.perParty[0]).toMatchObject({ filled: 1, total: 2 });
  });

  it("maps error codes to friendly copy and never leaks raw errors", () => {
    expect(friendlyClaimError("SLOT_TAKEN")).toMatch(/claimed by someone else/i);
    expect(friendlyClaimError("SHEET_NOT_OPEN")).toMatch(/not open/i);
    expect(friendlyClaimError("ACCOUNT_NOT_APPROVED")).toMatch(/awaiting approval/i);
    expect(friendlyClaimError("MYSTERY_CODE")).toMatch(/try again/i);
  });

  it("MassSheetError carries its code", () => {
    expect(new MassSheetError("SLOT_TAKEN").code).toBe("SLOT_TAKEN");
  });
});
