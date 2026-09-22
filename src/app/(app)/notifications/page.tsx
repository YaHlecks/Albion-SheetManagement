import { Bell } from "lucide-react";
import { requirePageSession } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { fetchNotifications } from "@/lib/notifications";
import { NotificationsList } from "@/components/notifications-list";
import { EmptyState } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Notifications" };

export default async function NotificationsPage() {
  await requirePageSession();
  const supabase = await createSupabaseServerClient();

  // Contract-safe helper (kind, not type) — a DB failure shows an error state
  // instead of an empty list pretending everything is fine.
  let notifications: Awaited<ReturnType<typeof fetchNotifications>> = [];
  let loadError: string | null = null;
  try {
    notifications = await fetchNotifications(supabase, 50);
  } catch (err) {
    console.error("[notifications] load failed:", err);
    loadError = "Notifications could not be loaded. Please refresh the page.";
  }

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Notifications</h1>
        <p className="mt-1 text-sm text-muted">Event announcements and account updates.</p>
      </div>

      {loadError ? (
        <p className="panel p-4 text-sm text-warn" role="alert">{loadError}</p>
      ) : notifications.length === 0 ? (
        <EmptyState
          icon={<Bell size={36} />}
          title="No notifications"
          description="You're all caught up. Notifications about events and your account will appear here."
        />
      ) : (
        <NotificationsList initial={notifications} />
      )}
    </div>
  );
}
