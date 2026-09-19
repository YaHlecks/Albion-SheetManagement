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

  const { data: memberships } = await supabase
    .from("team_members")
    .select("id, role, teams(id, name, status)")
    .eq("user_id", ctx.userId);

  const teams = (memberships ?? [])
    .map((m) => {
      const t = Array.isArray(m.teams) ? m.teams[0] : m.teams;
      if (!t || typeof t === "string") return null;
      return { id: (t as { id: string }).id, name: (t as { name: string }).name, status: (t as { status: string }).status, role: m.role };
    })
    .filter((t): t is NonNullable<typeof t> => t !== null);

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
        <h2 className="section-title mb-4">Your teams</h2>
        {teams.length === 0 ? (
          <p className="py-4 text-center text-sm text-muted">You are not assigned to any team.</p>
        ) : (
          <ul className="divide-y divide-line">
            {teams.map((t) => (
              <li key={t.id} className="flex items-center justify-between py-2.5 text-sm">
                <span className="font-semibold text-ink">{t.name}</span>
                <span className="flex items-center gap-2">
                  <span className="badge badge-role">{t.role}</span>
                  <span className="badge badge-neutral">{t.status}</span>
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
