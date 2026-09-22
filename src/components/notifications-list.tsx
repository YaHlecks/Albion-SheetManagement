"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase-browser";
import {
  notificationTone,
  type NotificationRow,
} from "@/lib/notifications";
import { cn, formatDateTime } from "@/lib/utils";

export function NotificationsList({ initial }: { initial: NotificationRow[] }) {
  const [items, setItems] = useState(initial);
  const [busy, setBusy] = useState(false);
  const unread = items.filter((n) => !n.read).length;

  async function markAllRead() {
    setBusy(true);
    try {
      // Optimistic update first; the RLS policy scopes the update to the
      // caller's own rows (user_id = auth.uid()), so no id filter is needed.
      setItems((prev) => prev.map((n) => ({ ...n, read: true })));
      const supabase = createBrowserClient();
      const { error } = await supabase.from("notifications").update({ read: true }).eq("read", false);
      if (error) throw error;
    } catch (err) {
      console.error("[notifications] mark-all-read failed:", err);
      // Re-fetch authoritative state on failure instead of leaving a lie on screen.
      const supabase = createBrowserClient();
      const { data } = await supabase
        .from("notifications")
        .select("id, title, body, kind, read, link, created_at")
        .order("created_at", { ascending: false })
        .limit(50);
      if (data) setItems(data as NotificationRow[]);
    } finally {
      setBusy(false);
    }
  }

  async function markRead(id: string) {
    if (items.find((n) => n.id === id)?.read) return;
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    const supabase = createBrowserClient();
    const { error } = await supabase.from("notifications").update({ read: true }).eq("id", id);
    if (error) console.error("[notifications] mark-read failed:", error.message);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {unread > 0 ? `${unread} unread` : "All read"}
        </p>
        {unread > 0 ? (
          <button
            type="button"
            className="btn btn-secondary btn-sm gap-1.5"
            onClick={() => void markAllRead()}
            disabled={busy}
          >
            <CheckCheck size={14} /> {busy ? "Marking…" : "Mark all read"}
          </button>
        ) : null}
      </div>

      <div className="panel divide-y divide-line overflow-hidden">
        {items.map((n) => {
          const tone = notificationTone(n.kind);
          const toneBg =
            tone === "success" ? "bg-success"
            : tone === "danger" ? "bg-danger"
            : tone === "brand" ? "bg-brand"
            : "bg-info";
          const content = (
            <div
              className={cn("flex items-start gap-3 px-4 py-3.5", !n.read && "notif-unread")}
              onClick={() => void markRead(n.id)}
            >
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-line-strong" : toneBg)} />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-semibold text-ink">{n.title}</p>
                {n.body ? <p className="mt-0.5 text-sm text-muted">{n.body}</p> : null}
                <p className="mt-1 text-xs text-faint">{formatDateTime(n.created_at)}</p>
              </div>
              {!n.read ? <span className="mt-1 badge badge-pending">new</span> : null}
            </div>
          );
          return n.link ? (
            <Link key={n.id} href={n.link} className="block hover:bg-white/[0.015]">
              {content}
            </Link>
          ) : (
            <div key={n.id}>{content}</div>
          );
        })}
      </div>
    </div>
  );
}
