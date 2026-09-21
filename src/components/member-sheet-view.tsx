"use client";

/**
 * Member mass-sheet experience (§13/§14/§18): header + instructions, party
 * grid via the shared MassSheetView, claim/unclaim with IGN prefill, and
 * realtime updates so everyone's view converges without manual refreshes.
 */
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Badge, LoadingBlock } from "@/components/ui";
import { useToast } from "@/components/toast";
import { createBrowserClient } from "@/lib/supabase-browser";
import { MassSheetView } from "@/components/mass-sheet-view";
import {
  claimMassSlot,
  fetchMassSheet,
  friendlyClaimError,
  MassSheetError,
  sheetStats,
  subscribeToMassSheet,
  unclaimMassSlot,
  type MassSheetFull,
} from "@/lib/mass";

const STATUS_LABEL: Record<string, string> = {
  published: "approved", locked: "locked",
};

export function MemberSheetView({ teamId, initialSheet, userId, ign }: {
  teamId: string;
  initialSheet: MassSheetFull;
  userId: string;
  ign: string | null;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createBrowserClient();
  const [sheet, setSheet] = useState<MassSheetFull>(initialSheet);
  const [reloadError, setReloadError] = useState(false);

  const reload = useCallback(async () => {
    try {
      const fresh = await fetchMassSheet(supabase, initialSheet.id);
      if (fresh) setSheet(fresh);
    } catch {
      setReloadError(true);
    }
  }, [supabase, initialSheet.id]);

  // Realtime (§18): single channel per sheet, cleaned up on unmount.
  useEffect(() => {
    const off = subscribeToMassSheet(supabase, initialSheet.id, () => {
      void reload();
    });
    return off;
  }, [supabase, initialSheet.id, reload]);

  const stats = sheetStats(sheet);
  const locked = sheet.status === "locked";
  const team = Array.isArray(sheet.teams) ? sheet.teams[0] : sheet.teams;

  const onAction = async (action: { kind: "claim" | "unclaim" | "clear"; slot: { id: string }; ign?: string }) => {
    if (action.kind === "claim") {
      try {
        await claimMassSlot(supabase, action.slot.id, action.ign ?? ign ?? "");
      } catch (err) {
        throw err instanceof MassSheetError ? err : new MassSheetError("UNKNOWN");
      }
      toast.success("Slot claimed — your IGN is on the sheet.");
      await reload();
    } else if (action.kind === "unclaim") {
      try {
        await unclaimMassSlot(supabase, action.slot.id);
        toast.success("Slot released.");
      } catch (err) {
        if (err instanceof MassSheetError) {
          toast.error(friendlyClaimError(err.code));
          return;
        }
        toast.error("Could not release the slot. Please try again.");
        return;
      }
      await reload();
    }
  };

  return (
    <div className="mt-1 space-y-5">
      {/* Header — reads like an Albion mass sheet, not a CRUD row (§13) */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-display text-2xl font-bold tracking-tight">{sheet.title}</h1>
            <Badge status={STATUS_LABEL[sheet.status] ?? "neutral"} />
          </div>
          <p className="mt-1 text-sm text-muted">
            {[
              sheet.location && `MASS LOCATION: ${sheet.location}`,
              sheet.set_name && `SET: ${sheet.set_name}`,
              sheet.mass_at && `MASSING TIME: ${fmt(sheet.mass_at, sheet.timezone)}`,
            ].filter(Boolean).join("  ·  ")}
          </p>
          <p className="text-xs text-faint">Team: {team?.name ?? "—"}</p>
        </div>
        <div className="panel px-4 py-3 text-right">
          <p className="section-title">Slots filled</p>
          <p className="text-xl font-bold">{stats.filled} / {stats.total}</p>
          <p className="text-xs text-faint">{stats.open} open</p>
        </div>
      </div>

      {sheet.description && (
        <p className="panel p-4 text-sm text-muted">{sheet.description}</p>
      )}
      {sheet.instructions && (
        <div className="panel border-l-4 border-l-brand p-4">
          <p className="section-title">Instructions</p>
          <p className="mt-1 whitespace-pre-wrap text-sm text-muted">{sheet.instructions}</p>
        </div>
      )}

      {locked && (
        <p className="panel p-3 text-sm text-warn" role="status">
          This mass is locked — the roster is final. You can still view it.
        </p>
      )}
      {reloadError && (
        <p className="panel p-3 text-sm text-warn" role="status">
          Live updates were interrupted — refresh the page to get the latest assignments.
        </p>
      )}

      <MassSheetView
        sheet={sheet}
        currentUserId={userId}
        isAdmin={false}
        editable={!locked}
        defaultIgn={ign}
        onAction={onAction}
      />
    </div>
  );
}

function fmt(at: string, tz: string | null): string {
  try {
    return `${new Intl.DateTimeFormat("en-GB", { timeZone: tz || "UTC", dateStyle: "medium", timeStyle: "short" }).format(new Date(at))} (${tz || "UTC"})`;
  } catch {
    return new Date(at).toLocaleString();
  }
}
