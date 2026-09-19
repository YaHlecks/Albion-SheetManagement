"use client";

import { useState } from "react";
import Link from "next/link";
import { CheckCheck } from "lucide-react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { cn, formatDateTime } from "@/lib/utils";

export interface NotificationRowData {
  id: string;
  title: string;
  body: string | null;
  type: string;
  read: boolean;
  link: string | null;
  created_at: string;
}

export function NotificationsList({ initial }: { initial: NotificationRowData[] }) {
  const [items, setItems] = useState(initial);
  const unread = items.filter((n) => !n.read).length;

  async function markAllRead() {
    setItems((prev) => prev.map((n) => ({ ...n, read: true })));
    const supabase = createBrowserClient();
    await supabase.from("notifications").update({ read: true }).eq("read", false);
  }

  async function markRead(id: string) {
    setItems((prev) => prev.map((n) => (n.id === id ? { ...n, read: true } : n)));
    const supabase = createBrowserClient();
    await supabase.from("notifications").update({ read: true }).eq("id", id);
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <p className="text-sm text-muted">
          {unread > 0 ? `${unread} unread` : "All read"}
        </p>
        {unread > 0 ? (
          <button type="button" className="btn btn-secondary btn-sm gap-1.5" onClick={markAllRead}>
            <CheckCheck size={14} /> Mark all read
          </button>
        ) : null}
      </div>

      <div className="panel divide-y divide-line overflow-hidden">
        {items.map((n) => {
          const tone =
            n.type === "success"
              ? "bg-success"
              : n.type === "warning" || n.type === "error"
                ? "bg-warn"
                : "bg-info";
          const content = (
            <div
              className={cn("flex items-start gap-3 px-4 py-3.5", !n.read && "notif-unread")}
              onClick={() => void markRead(n.id)}
            >
              <span className={cn("mt-1.5 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-line-strong" : tone)} />
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
