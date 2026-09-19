import { requireAdminPage } from "@/lib/api";
import { hasServiceRole } from "@/lib/supabase-admin";
import { Badge } from "@/components/ui";
import { formatDateTime } from "@/lib/utils";

export const dynamic = "force-dynamic";
export const metadata = { title: "Admin Settings" };

export default async function AdminSettingsPage() {
  const ctx = await requireAdminPage();

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div>
        <h1 className="font-display text-2xl font-bold tracking-tight">Settings</h1>
        <p className="mt-1 text-sm text-muted">System configuration overview.</p>
      </div>

      <section className="panel p-5">
        <h2 className="section-title mb-4">Your administrator account</h2>
        <dl className="desc-list grid gap-4 sm:grid-cols-2">
          <div><dt>IGN</dt><dd>{ctx.profile?.ign}</dd></div>
          <div><dt>Email</dt><dd>{ctx.email}</dd></div>
          <div><dt>Status</dt><dd><Badge status={ctx.profile?.status ?? "approved"} /> <span className="badge badge-admin ml-1">admin</span></dd></div>
          <div><dt>Registered</dt><dd>{formatDateTime(ctx.profile?.createdAt)}</dd></div>
        </dl>
        <p className="mt-4 text-xs text-faint">
          Admin status is stored in the database (profiles.is_platform_admin) and enforced by
          Row Level Security plus server-side checks on every request. It cannot be changed
          from the browser.
        </p>
      </section>

      <section className="panel p-5">
        <h2 className="section-title mb-4">Security configuration</h2>
        <dl className="desc-list grid gap-4 sm:grid-cols-2">
          <div>
            <dt>Service-role key</dt>
            <dd>
              {hasServiceRole() ? (
                <span className="badge badge-approved">configured</span>
              ) : (
                <span className="badge badge-pending">fallback mode</span>
              )}
            </dd>
          </div>
          <div>
            <dt>Authorization mode</dt>
            <dd className="text-sm">
              {hasServiceRole()
                ? "Direct policy enforcement via service role"
                : "Security-definer RPCs (set SUPABASE_SERVICE_ROLE_KEY for direct mode)"}
            </dd>
          </div>
          <div>
            <dt>Audit logging</dt>
            <dd><span className="badge badge-approved">enabled</span></dd>
          </div>
          <div>
            <dt>Row Level Security</dt>
            <dd><span className="badge badge-approved">enforced</span></dd>
          </div>
        </dl>
        <p className="mt-4 text-xs text-faint">
          In fallback mode (no service-role key), admin writes go through the
          security-definer admin_action RPC, which re-verifies admin rights inside the
          database on every call. Both modes are safe; direct mode is faster.
        </p>
      </section>

      <section className="panel p-5">
        <h2 className="section-title mb-4">Data retention</h2>
        <p className="text-sm text-muted">
          Accounts are soft-deleted (archived) rather than removed, so audit history stays
          complete. Audit events are append-only — they cannot be edited or deleted through
          the application.
        </p>
      </section>
    </div>
  );
}
