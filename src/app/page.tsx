import Link from "next/link";
import {
  ArrowRight,
  ClipboardList,
  Eye,
  History,
  Lock,
  ShieldCheck,
  UserCheck,
  Users,
} from "lucide-react";
import { Logo } from "@/components/ui";

export const dynamic = "force-static";

const features = [
  {
    icon: ClipboardList,
    title: "Controlled Team Sheets",
    text: "Only authorized members can access team information, and every member edits only what belongs to them.",
  },
  {
    icon: UserCheck,
    title: "Account Approval",
    text: "Administrators control who joins the system. New registrations wait in a review queue before gaining access.",
  },
  {
    icon: Users,
    title: "Team-Based Access",
    text: "Members see exactly the teams they belong to — nothing more, nothing less.",
  },
  {
    icon: Eye,
    title: "Activity Tracking",
    text: "Every important change is recorded automatically: who changed what, when, and from which value to which.",
  },
  {
    icon: ShieldCheck,
    title: "Moderation",
    text: "Suspend disruptive accounts, remove members, and lock sheets without losing any history.",
  },
  {
    icon: History,
    title: "Change History",
    text: "Previous values are preserved. Administrators can inspect any change and restore the earlier value with one click.",
  },
];

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-bg text-ink">
      {/* Header */}
      <header className="sticky top-0 z-40 border-b border-line bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-[17px] font-bold tracking-tight">
              Albion <span className="text-brand">Team Sheets</span>
            </span>
          </Link>
          <nav className="hidden items-center gap-6 text-sm text-muted md:flex" aria-label="Main">
            <a href="#features" className="hover:text-ink">Features</a>
            <a href="#how" className="hover:text-ink">How it works</a>
            <a href="#about" className="hover:text-ink">About</a>
          </nav>
          <div className="flex items-center gap-2">
            <Link href="/login" className="btn btn-ghost">Log in</Link>
            <Link href="/register" className="btn btn-primary">Get Started</Link>
          </div>
        </div>
      </header>

      {/* Hero */}
      <section className="landing-grid border-b border-line">
        <div className="mx-auto max-w-6xl px-4 py-20 sm:px-6 sm:py-28">
          <div className="max-w-3xl">
            <p className="badge badge-admin mb-5 inline-flex">Built for Albion Online guilds</p>
            <h1 className="hero-title">
              Build your Albion teams without the{" "}
              <span className="text-brand">chaos of shared spreadsheets</span>.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted">
              Controlled team sheets, approved members, activity tracking, and administrator
              moderation in one place.
            </p>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link href="/register" className="btn btn-primary h-11 px-6 text-sm">
                Get Started <ArrowRight size={16} />
              </Link>
              <Link href="/login" className="btn btn-secondary h-11 px-6 text-sm">
                Log in
              </Link>
            </div>
            <div className="mt-10 flex flex-wrap gap-x-8 gap-y-2 text-sm text-faint">
              <span className="inline-flex items-center gap-2">
                <Lock size={14} className="text-brand" /> Row-level security enforced in the database
              </span>
              <span className="inline-flex items-center gap-2">
                <Eye size={14} className="text-brand" /> Full change history on every sheet
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-b border-line py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight">
            Everything a roster needs, nothing it doesn&apos;t
          </h2>
          <p className="mt-3 max-w-2xl text-muted">
            Replace unrestricted spreadsheet editing with an approval-gated, permissioned and
            fully-audited system designed for real guild operations.
          </p>
          <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {features.map((f) => (
              <div key={f.title} className="feature-card">
                <span className="feature-icon">
                  <f.icon size={19} />
                </span>
                <h3 className="font-display text-base font-semibold">{f.title}</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted">{f.text}</p>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* How it works */}
      <section id="how" className="border-b border-line py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight">How it works</h2>
          <ol className="mt-10 grid gap-4 md:grid-cols-3">
            {[
              {
                step: "1",
                title: "Register",
                text: "Create an account with your in-game name. It waits for administrator approval.",
              },
              {
                step: "2",
                title: "Get assigned",
                text: "An admin approves your account and adds you to your teams. You get notified instantly.",
              },
              {
                step: "3",
                title: "Fill your sheet",
                text: "Update your role, weapon, availability and notes. Every change is tracked and restorable.",
              },
            ].map((s) => (
              <li key={s.step} className="panel p-6">
                <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-brand text-sm font-bold text-[#241703]">
                  {s.step}
                </span>
                <h3 className="mt-4 font-display text-lg font-semibold">{s.title}</h3>
                <p className="mt-2 text-sm text-muted">{s.text}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* About / final CTA */}
      <section id="about" className="py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <div className="panel overflow-hidden">
            <div className="landing-grid px-6 py-14 text-center sm:px-12">
              <h2 className="font-display text-3xl font-bold tracking-tight">
                Stop fighting spreadsheets. Start running teams.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-muted">
                Know who changed what, approve who joins, and keep every roster reliable — with
                moderation tools built for real guild leadership.
              </p>
              <div className="mt-8 flex flex-wrap justify-center gap-3">
                <Link href="/register" className="btn btn-primary h-11 px-7">
                  Get Started <ArrowRight size={16} />
                </Link>
                <Link href="/login" className="btn btn-secondary h-11 px-7">
                  Log in
                </Link>
              </div>
            </div>
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="border-t border-line py-8">
        <div className="mx-auto flex max-w-6xl flex-col items-center justify-between gap-3 px-4 text-sm text-faint sm:flex-row sm:px-6">
          <div className="flex items-center gap-2">
            <Logo size={22} />
            <span>Albion Team Sheets</span>
          </div>
          <p>Not affiliated with Sandbox Interactive. Built for the Albion community.</p>
        </div>
      </footer>
    </div>
  );
}
