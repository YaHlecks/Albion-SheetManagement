import Link from "next/link";
import { Clock, ShieldX, XCircle } from "lucide-react";
import { Logo } from "@/components/ui";
import { createSupabaseServerClient } from "@/lib/supabase-server";

export const dynamic = "force-dynamic";

const statusCopy: Record<string, { title: string; body: string; icon: React.ComponentType<{ size?: number }>; tone: string }> = {
  pending: {
    title: "Waiting for approval",
    body: "Your account has been created and is currently waiting for administrator approval. You will be able to log in once an administrator approves it.",
    icon: Clock,
    tone: "warn",
  },
  suspended: {
    title: "Account suspended",
    body: "This account has been suspended by an administrator. If you believe this is a mistake, contact your guild leadership.",
    icon: ShieldX,
    tone: "danger",
  },
  rejected: {
    title: "Registration rejected",
    body: "This registration was not approved. If you believe this is a mistake, contact your guild leadership.",
    icon: XCircle,
    tone: "danger",
  },
  archived: {
    title: "Account archived",
    body: "This account has been archived. Contact your guild leadership if you need access again.",
    icon: XCircle,
    tone: "danger",
  },
};

export default async function PendingApprovalPage({
  searchParams,
}: {
  searchParams: Promise<{ status?: string }>;
}) {
  const sp = await searchParams;
  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  let status = sp.status ?? "pending";
  if (user) {
    // Prefer the authoritative DB value when a session exists.
    const { data: profile } = await supabase
      .from("profiles")
      .select("status")
      .eq("id", user.id)
      .maybeSingle();
    if (profile?.status) status = profile.status;
  }

  const copy = statusCopy[status] ?? statusCopy.pending;
  const Icon = copy.icon;

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4">
      <div className="auth-card text-center">
        <div className="mb-4 flex justify-center">
          <Logo size={40} />
        </div>
        <span
          className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${
            copy.tone === "warn" ? "bg-warn-soft text-warn" : "bg-danger-soft text-danger"
          }`}
        >
          <Icon size={22} />
        </span>
        <h1 className="font-display text-2xl font-bold tracking-tight">{copy.title}</h1>
        <p className="mt-3 text-sm leading-relaxed text-muted">{copy.body}</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link href="/login" className="btn btn-secondary w-full">Back to login</Link>
          <Link href="/" className="text-sm text-faint hover:text-muted">Back to home</Link>
        </div>
      </div>
    </div>
  );
}
