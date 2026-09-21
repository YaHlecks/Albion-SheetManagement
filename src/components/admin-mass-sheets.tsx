"use client";

/**
 * Admin Mass Sheets section (§5): cards with status, team, massing time and
 * live fill counters. Every action calls a 0004 RPC through the browser
 * Supabase client — nothing is faked.
 */
import { useRouter } from "next/navigation";
import Link from "next/link";
import { useState } from "react";
import { Badge, Button, ConfirmDialog, EmptyState } from "@/components/ui";
import { useToast } from "@/components/toast";
import { createBrowserClient } from "@/lib/supabase-browser";
import {
  duplicateMassSheet,
  setMassSheetStatus,
  type MassSheet,
} from "@/lib/mass";

function fmtWhen(sheet: MassSheet): string {
  if (!sheet.mass_at) return "No time set";
  const tz = sheet.timezone || "UTC";
  try {
    return `${new Intl.DateTimeFormat("en-GB", {
      timeZone: tz, dateStyle: "medium", timeStyle: "short",
    }).format(new Date(sheet.mass_at))} (${tz})`;
  } catch {
    return new Date(sheet.mass_at).toLocaleString();
  }
}

const STATUS_LABEL: Record<string, string> = {
  draft: "draft", published: "approved", locked: "locked", archived: "archived",
};

export function AdminMassSheets({ sheets, fillCounts }: {
  sheets: MassSheet[];
  /** sheet_id → filled/total, computed server-side in one aggregate query. */
  fillCounts: Record<string, { filled: number; total: number }>;
}) {
  const router = useRouter();
  const toast = useToast();
  const supabase = createBrowserClient();
  const [busy, setBusy] = useState(false);
  const [confirm, setConfirm] = useState<
    | { kind: "duplicate"; sheet: MassSheet }
    | { kind: "archive"; sheet: MassSheet }
    | { kind: "lock"; sheet: MassSheet; next: "locked" | "published" }
    | null
  >(null);

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      toast.success(confirm?.kind === "duplicate" ? "Mass sheet duplicated as a new draft." : "Done.");
      router.refresh();
    } catch (err) {
      const msg = err instanceof Error && "code" in err && typeof (err as { code: unknown }).code === "string"
        ? `Action failed (${(err as { code: string }).code})`
        : "Action failed. Please try again.";
      toast.error(msg);
    } finally {
      setBusy(false);
      setConfirm(null);
    }
  };

  return (
    <div className="space-y-3">
      {sheets.length === 0 ? (
        <EmptyState
          title="No mass sheets yet"
          description="Create a mass sheet for your team, configure parties and builds, then publish it for members to fill."
          action={<Link href="/admin/sheets/new" className="btn btn-primary">Create Mass Sheet</Link>}
        />
      ) : (
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {sheets.map((sheet) => {
            const counts = fillCounts[sheet.id] ?? { filled: 0, total: 0 };
            const team = Array.isArray(sheet.teams) ? sheet.teams[0] : sheet.teams;
            return (
              <div key={sheet.id} className="panel flex flex-col p-4">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <h3 className="truncate font-display text-base font-semibold text-ink">
                      <Link href={`/admin/sheets/${sheet.id}`} className="hover:underline">{sheet.title}</Link>
                    </h3>
                    <p className="mt-0.5 text-xs text-faint">
                      {[sheet.location, sheet.set_name].filter(Boolean).join(" · ") || "No location"}
                    </p>
                  </div>
                  <Badge status={STATUS_LABEL[sheet.status] ?? "neutral"} />
                </div>

                <dl className="mt-3 space-y-1 text-xs text-muted">
                  <div className="flex justify-between gap-2"><dt>Team</dt><dd className="truncate">{team?.name ?? "—"}</dd></div>
                  <div className="flex justify-between gap-2"><dt>Massing</dt><dd className="truncate">{fmtWhen(sheet)}</dd></div>
                </dl>

                <p className="mt-3 text-sm font-semibold">
                  {counts.filled} / {counts.total} slots filled
                </p>
                <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-elevated">
                  <div
                    className="h-full rounded-full bg-brand transition-all"
                    style={{ width: counts.total ? `${Math.round((counts.filled / counts.total) * 100)}%` : "0%" }}
                    role="progressbar"
                    aria-valuenow={counts.filled}
                    aria-valuemin={0}
                    aria-valuemax={counts.total}
                    aria-label={`Slots filled: ${counts.filled} of ${counts.total}`}
                  />
                </div>

                <div className="mt-4 flex flex-wrap gap-1 border-t border-line pt-3">
                  <Link href={`/admin/sheets/${sheet.id}`} className="btn btn-secondary btn-sm">Open</Link>
                  {sheet.status !== "archived" && (
                    <Link href={`/admin/sheets/${sheet.id}/edit`} className="btn btn-secondary btn-sm">Edit</Link>
                  )}
                  <Button
                    size="sm" variant="ghost"
                    loading={busy && confirm?.kind === "duplicate"}
                    onClick={() => setConfirm({ kind: "duplicate", sheet })}
                  >
                    Duplicate
                  </Button>
                  {sheet.status === "published" && (
                    <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: "lock", sheet, next: "locked" })}>Lock</Button>
                  )}
                  {sheet.status === "locked" && (
                    <Button size="sm" variant="ghost" onClick={() => setConfirm({ kind: "lock", sheet, next: "published" })}>Unlock</Button>
                  )}
                  {sheet.status !== "archived" && (
                    <Button size="sm" variant="outline-danger" onClick={() => setConfirm({ kind: "archive", sheet })}>Archive</Button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmDialog
        open={confirm !== null}
        title={
          confirm?.kind === "duplicate" ? "Duplicate mass sheet?"
          : confirm?.kind === "archive" ? "Archive mass sheet?"
          : confirm?.next === "locked" ? "Lock mass sheet?"
          : "Unlock mass sheet?"
        }
        body={
          confirm?.kind === "duplicate"
            ? `"${confirm?.sheet.title}" will be copied with the same parties and slots, but WITHOUT any member assignments. The copy starts as a draft.`
            : confirm?.kind === "archive"
              ? `"${confirm?.sheet.title}" becomes read-only for reference. Members lose access; you can restore it later.`
              : confirm?.next === "locked"
                ? `Members will still see "${confirm?.sheet.title}" but cannot claim, change or unclaim slots until unlocked.`
                : `Members can claim and change slots on "${confirm?.sheet.title}" again.`
        }
        confirmLabel={confirm?.kind === "duplicate" ? "Duplicate" : confirm?.kind === "archive" ? "Archive" : confirm?.next === "locked" ? "Lock" : "Unlock"}
        danger={confirm?.kind === "archive"}
        busy={busy}
        onCancel={() => setConfirm(null)}
        onConfirm={() => {
          if (!confirm) return;
          const { sheet } = confirm;
          if (confirm.kind === "duplicate") {
            void run(async () => { await duplicateMassSheet(supabase, sheet.id); });
          } else if (confirm.kind === "archive") {
            void run(async () => { await setMassSheetStatus(supabase, sheet.id, "archived"); });
          } else {
            void run(async () => { await setMassSheetStatus(supabase, sheet.id, confirm.next); });
          }
        }}
      />
    </div>
  );
}
