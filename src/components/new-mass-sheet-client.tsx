"use client";

/**
 * Client wrapper for the create wizard: owns the BuilderState, saves via the
 * save_mass_sheet RPC, then offers Publish. Explicit save strategy (§35):
 * nothing is lost silently, publish is always a deliberate second step.
 */
import { useState } from "react";
import { useRouter } from "next/navigation";
import { useToast } from "@/components/toast";
import { createBrowserClient } from "@/lib/supabase-browser";
import {
  MassSheetBuilder,
  emptySheet,
  type BuilderState,
} from "@/components/mass-sheet-builder";
import { composeMassAt, saveMassSheet, setMassSheetStatus } from "@/lib/mass";

export function NewMassSheetClient({ teams }: { teams: Array<{ id: string; name: string }> }) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createBrowserClient();
  const [state, setState] = useState<BuilderState>(() => emptySheet(teams[0]?.id ?? ""));
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);

  const save = async (draft: BuilderState, thenPublish: boolean) => {
    setBusy(true);
    try {
      const { id, created } = await saveMassSheet(supabase, savedId, {
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
            sort_order: si,
          })),
        })),
      });
      setSavedId(id);
      if (thenPublish) {
        await setMassSheetStatus(supabase, id, "published");
        toast.success("Mass sheet published — members can now fill slots.");
        router.push(`/admin/sheets/${id}`);
        router.refresh();
        return;
      }
      toast.success(created ? "Draft saved." : "Changes saved.");
      router.push(`/admin/sheets/${id}`);
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
      saveLabel={busy ? "Saving…" : "Save draft"}
      onSave={(draft) => {
        void save(draft, false);
      }}
      onCancel={() => router.push("/admin/sheets")}
    />
  );
}
