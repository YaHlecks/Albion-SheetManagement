import Link from "next/link";
import {
  CheckCircle2,
  Clock,
  MailQuestion,
  ShieldCheck,
  ShieldX,
  TriangleAlert,
} from "lucide-react";
import { ResendVerification } from "@/components/resend-verification";
import { createSupabaseServerClient } from "@/lib/supabase-server";
import { env } from "@/lib/env";

export const dynamic = "force-dynamic";
export const metadata = { title: "Email verification" };

type SearchParams = Promise<Record<string, string | string[] | undefined>>;

function first(v: string | string[] | undefined): string | null {
  return Array.isArray(v) ? (v[0] ?? null) : (v ?? null);
}

const refreshHint =
  "If the page still shows an old state, refresh once — your session was just updated.";

export default async function VerifyEmailPage({ searchParams }: { searchParams: SearchParams }) {
  const sp = await searchParams;
  const status = first(sp.status); // "expired" | "invalid" (from the callback)
  const fresh = first(sp.fresh) === "1"; // set by the callback on success

  // Not configured → tell the operator instead of looping.
  if (!env.supabaseConfigured) {
    return (
      <Frame>
        <Icon tone="danger">
          <TriangleAlert size={22} />
        </Icon>
        <H1>Email verification unavailable</H1>
        <Body>
          Authentication is not configured on this deployment. Set
          NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY.
        </Body>
        <BackToLogin />
      </Frame>
    );
  }

  const supabase = await createSupabaseServerClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // ---------------------------------------------------------------- expired /
  // ---------------------------------------------------------------- invalid
  if (!user) {
    if (status === "expired" || status === "invalid") {
      return (
        <Frame>
          <Icon tone="warn">
            <Clock size={22} />
          </Icon>
          <H1>Verification link invalid or expired</H1>
          <Body>
            This verification link is no longer valid — it may have expired or already been used.
            Your account is unaffected. Request a new verification email and try again.
          </Body>
          <ResendVerification askForEmail />
          <BackToLogin />
        </Frame>
      );
    }

    // No session and no error flags: a bare /verify-email visit.
    return (
      <Frame>
        <Icon tone="info">
          <MailQuestion size={22} />
        </Icon>
        <H1>Verify your email address</H1>
        <Body>
          Open the verification email we sent when you registered and click
          &ldquo;Verify My Account&rdquo;. Didn&apos;t get it? Request a new one below.
        </Body>
        <ResendVerification askForEmail />
        <BackToLogin />
      </Frame>
    );
  }

  const emailConfirmed = Boolean(user.email_confirmed_at || user.confirmed_at);
  const email = user.email ?? "";

  // ---------------------------------------------------------------- unverified
  // A signed-in user whose email is still unverified (e.g. they clicked an
  // old link that no longer carries a usable code). Never an error state.
  if (!emailConfirmed) {
    return (
      <Frame>
        <Icon tone="warn">
          <Clock size={22} />
        </Icon>
        <H1>Your email is not verified yet</H1>
        <Body>
          We&apos;re still waiting for verification of{" "}
          <strong className="text-ink">{email}</strong>. Open the verification email and click
          &ldquo;Verify My Account&rdquo;, or request a new email below.
        </Body>
        <ResendVerification email={email} />
        <BackToLogin />
      </Frame>
    );
  }

  // ---------------------------------------------------------------- verified
  // The email IS verified. Now resolve the ACCOUNT state — approval is a
  // separate concept and must never be reported as "approved" prematurely.
  const { data: profileRow, error: profileError } = await supabase
    .from("profiles")
    .select("status, is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();

  if (profileError) {
    console.error("[auth] verify-email profile load failed:", profileError.message);
  }

  // Self-healing profile provisioning on first login (race-safe, DB-side).
  if (!profileRow) {
    await supabase.rpc("ensure_profile");
    await supabase.rpc("claim_first_admin");
  }

  const profile = await supabase
    .from("profiles")
    .select("status, is_platform_admin")
    .eq("id", user.id)
    .maybeSingle();

  const status0 = (profile.data?.status ?? profileRow?.status ?? null) as
    | "pending"
    | "approved"
    | "rejected"
    | "suspended"
    | "archived"
    | null;
  const isAdmin = (profile.data?.is_platform_admin ?? profileRow?.is_platform_admin) === true;

  const accountState = !status0
    ? "error"
    : status0 === "pending"
      ? "pending"
      : status0 === "approved"
        ? isAdmin
          ? "admin"
          : "active"
        : status0; // rejected | suspended | archived

  return (
    <Frame>
      <Icon tone="success">
        <CheckCircle2 size={22} />
      </Icon>
      <H1>Email verified!</H1>
      <Body>
        Your email address <strong className="text-ink">{email}</strong> has been successfully
        verified.
      </Body>

      {/* Distinct, truthful account-state messaging (never "approved" unless it is). */}
      {accountState === "pending" ? (
        <>
          <div className="mt-4 w-full space-y-2 text-left text-sm">
            <StateLine ok text="Email verified" />
            <StateLine warn text="Account approval pending" hint="An administrator will review your account shortly." />
          </div>
          <Body muted>
            We&apos;ll let you know when your account has been approved. You can then sign in as
            usual.
          </Body>
          <Link href="/login" className="btn btn-primary mt-6 w-full">Return to login</Link>
        </>
      ) : null}

      {accountState === "active" ? (
        <>
          <div className="mt-4 w-full space-y-2 text-left text-sm">
            <StateLine ok text="Email verified" />
            <StateLine ok text="Account active" />
          </div>
          <Link href="/dashboard" className="btn btn-primary mt-6 w-full">Continue to dashboard</Link>
        </>
      ) : null}

      {accountState === "admin" ? (
        <>
          <div className="mt-4 w-full space-y-2 text-left text-sm">
            <StateLine ok text="Email verified" />
            <StateLine ok text="Account active" />
            <StateLine ok text="Administrator" />
          </div>
          <Link href="/admin" className="btn btn-primary mt-6 w-full">Continue to admin dashboard</Link>
        </>
      ) : null}

      {accountState === "error" ? (
        <>
          <div className="mt-4 w-full space-y-2 text-left text-sm">
            <StateLine ok text="Email verified" />
            <StateLine warn text="Account status temporarily unavailable" hint="Your verification succeeded; the account state could not be read." />
          </div>
          <p className="mt-3 text-xs text-faint">{refreshHint}</p>
          <Link href="/dashboard" className="btn btn-secondary mt-6 w-full">Continue</Link>
        </>
      ) : null}

      {accountState === "rejected" || accountState === "suspended" || accountState === "archived" ? (
        <>
          <div className="mt-4 w-full space-y-2 text-left text-sm">
            <StateLine ok text="Email verified" />
            <StateLine danger text={`Account ${accountState}`} />
          </div>
          <Body muted>
            {accountState === "rejected"
              ? "This registration was not approved. Contact your guild leadership if you believe this is a mistake."
              : accountState === "suspended"
                ? "This account has been suspended. Contact your guild leadership."
                : "This account has been archived. Contact your guild leadership."}
          </Body>
          <BackToLogin />
        </>
      ) : null}

      {fresh ? (
        <p className="mt-4 text-xs text-faint">Verified just now — this page confirmed it live.</p>
      ) : (
        <p className="mt-4 text-xs text-faint">Your email was already verified.</p>
      )}
    </Frame>
  );
}

/* ---------------------------- design-system bits --------------------------- */

function Frame({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-bg px-4 py-10">
      <div className="auth-card text-center">{children}</div>
    </div>
  );
}

function Icon({ tone, children }: { tone: "success" | "warn" | "danger" | "info"; children: React.ReactNode }) {
  const cls =
    tone === "success"
      ? "bg-success-soft text-success"
      : tone === "warn"
        ? "bg-warn-soft text-warn"
        : tone === "danger"
          ? "bg-danger-soft text-danger"
          : "bg-info-soft text-info";
  return (
    <span className={`mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full ${cls}`}>
      {children}
    </span>
  );
}

function H1({ children }: { children: React.ReactNode }) {
  return <h1 className="font-display text-2xl font-bold tracking-tight">{children}</h1>;
}

function Body({ children, muted = false }: { children: React.ReactNode; muted?: boolean }) {
  return <p className={`mt-3 text-sm leading-relaxed ${muted ? "text-faint" : "text-muted"}`}>{children}</p>;
}

function BackToLogin() {
  return (
    <div className="mt-6 flex flex-col gap-2">
      <Link href="/login" className="btn btn-secondary w-full">Return to login</Link>
      <Link href="/" className="text-sm text-faint hover:text-muted">Back to home</Link>
    </div>
  );
}

function StateLine({
  ok,
  warn,
  danger,
  text,
  hint,
}: {
  ok?: boolean;
  warn?: boolean;
  danger?: boolean;
  text: string;
  hint?: string;
}) {
  const icon = ok ? (
    <ShieldCheck size={15} className="text-success" />
  ) : danger ? (
    <ShieldX size={15} className="text-danger" />
  ) : (
    <Clock size={15} className="text-warn" />
  );
  return (
    <div className="flex items-start gap-2 rounded-lg border border-line bg-elevated/40 px-3 py-2">
      <span className="mt-0.5 shrink-0">{icon}</span>
      <span className="min-w-0">
        <span className={`block font-semibold ${ok ? "text-ink" : danger ? "text-danger" : "text-warn"}`}>
          {text}
        </span>
        {hint ? <span className="block text-xs text-faint">{hint}</span> : null}
      </span>
    </div>
  );
}
