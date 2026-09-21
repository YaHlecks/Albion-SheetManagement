import Link from "next/link";
import { requirePageSession } from "@/lib/api";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { ProfileForm } from "@/components/profile-form";
import { PasswordChangeForm } from "@/components/password-form";
import { Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Profile" };

export default async function ProfilePage() {
  const ctx = await requirePageSession();
  const supabase = await createSupabaseServerClient();

  // My event signups (recent first).
  const { data: mySignups } = await supabase
    .from("event_signups")
    .select("id, signed_up_at, events ( id, title, status, event_date )")
    .eq("user_id", ctx.userId)
    .order("signed_up_at", { ascending: false })
    .limit(10);

  return (
    <div className="mx-auto max-w-3xl space-y-6">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Profile & settings</h1>
        <p className="mt-1 text-sm text-muted">Manage your account information.</p>
      </div>

      <div className="panel p-5">
        <h2 className="section-title mb-4">Account information</h2>
        <dl className="desc-list grid gap-4 sm:grid-cols-2">
          <div>
            <dt>Email</dt>
            <dd>{ctx.email}</dd>
          </div>
          <div>
            <dt>Status</dt>
            <dd className="flex items-center gap-2">
              <Badge status={ctx.profile?.status ?? "approved"} />
              {ctx.isPlatformAdmin ? <span className="badge badge-admin">admin</span> : null}
            </dd>
          </div>
          <div>
            <dt>Registered</dt>
            <dd>{formatDateTime(ctx.profile?.createdAt)}</dd>
          </div>
          <div>
            <dt>Last login</dt>
            <dd>{formatDateTime(ctx.profile?.lastLoginAt)}</dd>
          </div>
        </dl>
      </div>

      <ProfileForm
        ign={ctx.profile?.ign ?? ""}
        discord={ctx.profile?.discord ?? ""}
        email={ctx.email}
      />

      <PasswordChangeForm />

      <div className="panel p-5">
        <h2 className="section-title mb-4">My event signups</h2>
        {(mySignups ?? []).length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">You haven't signed up to any events yet.</p>
        ) : (
          <ul className="divide-y divide-line">
            {(mySignups ?? []).map((s) => {
              const e = Array.isArray(s.events) ? s.events[0] : s.events;
              if (!e || typeof e !== "object") return null;
              const ev = e as { id: string; title: string; status: string; event_date: string | null };
              return (
                <li key={s.id} className="flex items-center justify-between py-2.5 text-sm">
                  <Link href={`/events/${ev.id}`} className="font-semibold text-ink hover:text-brand">{ev.title}</Link>
                  <span className="flex items-center gap-2">
                    <span className="text-xs text-faint">{ev.event_date ?? "TBA"}</span>
                    <Badge status={ev.status === "published" ? "approved" : ev.status === "locked" ? "locked" : "archived"} />
                  </span>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
