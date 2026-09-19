import { describe, expect, it } from "vitest";

/**
 * Mirrors the authorization logic enforced in the update_member_field RPC
 * (supabase/migrations/0001_init.sql). The database re-checks everything;
 * these tests document and verify the client-side mirror used for UX.
 */
function canEditCell(opts: {
  canEdit: boolean;
  locked: boolean;
  isAdmin: boolean;
  isOwnRow: boolean;
  teamStatus: string;
}): boolean {
  if (!opts.canEdit) return false;
  if (opts.teamStatus === "archived") return false;
  if (opts.locked && !opts.isAdmin) return false;
  return opts.isAdmin || opts.isOwnRow;
}

describe("sheet cell editability", () => {
  it("member can edit own row on an open sheet", () => {
    expect(
      canEditCell({ canEdit: true, locked: false, isAdmin: false, isOwnRow: true, teamStatus: "open" })
    ).toBe(true);
  });

  it("member cannot edit someone else's row", () => {
    expect(
      canEditCell({ canEdit: true, locked: false, isAdmin: false, isOwnRow: false, teamStatus: "open" })
    ).toBe(false);
  });

  it("member cannot edit a locked sheet", () => {
    expect(
      canEditCell({ canEdit: true, locked: true, isAdmin: false, isOwnRow: true, teamStatus: "open" })
    ).toBe(false);
  });

  it("admin can edit a locked sheet", () => {
    expect(
      canEditCell({ canEdit: true, locked: true, isAdmin: true, isOwnRow: false, teamStatus: "open" })
    ).toBe(true);
  });

  it("nobody can edit an archived team", () => {
    expect(
      canEditCell({ canEdit: true, locked: false, isAdmin: true, isOwnRow: true, teamStatus: "archived" })
    ).toBe(false);
  });

  it("member cannot edit when global edit is disabled", () => {
    expect(
      canEditCell({ canEdit: false, locked: false, isAdmin: false, isOwnRow: true, teamStatus: "open" })
    ).toBe(false);
  });
});
