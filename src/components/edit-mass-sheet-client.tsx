"use client";

/**
 * Edit-mode client: hydrates the builder from the loaded sheet and saves the
 * whole structure with one atomic RPC (assignments on untouched slots are
 * preserved by save_mass_sheet; deletions cascade with a UI warning).
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { createBrowserClient } from "@/lib/supabase-browser";
import {
  MassSheetBuilder,
  draftFromSheet,
  type BuilderState,
} from "@/components/mass-sheet-builder";
import { composeMassAt, saveMassSheet, setMassSheetStatus } from "@/lib/mass";

export function EditMassSheetClient({ sheetId, sheet, teams }: {
  sheetId: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheet: any;
  teams: Array<{ id: string; name: string }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createBrowserClient();
  const [state, setState] = useState<BuilderState>(() => draftFromSheet(sheet));
  const [busy, setBusy] = useState(false);

  const save = async (draft: BuilderState, thenStatus?: "published" | "draft") => {
    setBusy(true);
    try {
      await saveMassSheet(supabase, sheetId, {
        title: draft.title.trim(),
        team_id: draft.team_id,
        location: draft.location.trim() || null,
        set_name: draft.set_name.trim() || null,
        mass_at: composeMassAt(draft.mass_date, draft.mass_time, draft.timezone),
        timezone: draft.timezone,
        description: draft.description.trim() || null,
        instructions: draft.instructions.trim() || null,
        parties: draft.parties.map((p, pi) => ({
          id: p.id,
          name: p.name.trim() || `Party ${pi + 1}`,
          fill_note: p.fill_note.trim() || null,
          sort_order: pi,
          slots: p.slots.map((s, si) => ({
            id: s.id,
            role: s.role.trim() || "Fill",
            build_name: s.build_name.trim() || "TBD",
            priority: s.priority,
            notes: s.notes.trim() || null,
            required: s.required,
            tier_requirement: s.tier_requirement ?? "any",
            sort_order: si,
          })),
        })),
      });
      if (thenStatus) await setMassSheetStatus(supabase, sheetId, thenStatus);
      toast.success(thenStatus === "published" ? "Saved and published." : "Changes saved.");
      router.push(`/admin/sheets/${sheetId}`);
      router.refresh();
    } catch (err) {
      const code = err instanceof Error && "code" in err ? String((err as { code: unknown }).code) : null;
      toast.error(code ? `Could not save the sheet (${code}).` : "Could not save the sheet. Please try again.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <MassSheetBuilder
      state={state}
      onChange={setState}
      teams={teams}
      busy={busy}
      saveLabel="Save changes"
      onSave={(draft) => {
        void save(draft);
      }}
      onCancel={() => router.push(`/admin/sheets/${sheetId}`)}
    />
  );
}
