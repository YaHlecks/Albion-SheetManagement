import { Bell } from "lucide-react";
import { requirePageSession } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { NotificationsList } from "@/components/notifications-list";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  const ctx = await requirePageSession();
  const supabase = await createSupabaseServerClient();

  const { data } = await supabase
    .from("notifications")
    .select("id, title, body, type, read, link, created_at")
    .order("created_at", { ascending: false })
    .limit(50);

  const notifications = data ?? [];

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="mt-1 text-sm text-muted">Approvals, team changes and moderation updates.</p>
      </div>

      {notifications.length === 0 ? (
        <EmptyState
          icon={<Bell size={36} />}
          title="No notifications"
          description="You're all caught up. Notifications about your account and teams will appear here."
        />
      ) : (
        <NotificationsList initial={notifications} />
      )}
    </div>
  );
}
