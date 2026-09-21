import Link from "next/link";
import {
  ArrowRight,
  CalendarClock,
  Eye,
  Bell,
  Lock,
  ShieldCheck,
  Swords,
  Users,
} from "lucide-react";
import { Logo } from "@/components/ui";

export const dynamic = "force-static";

const features = [
  {
    icon: Swords,
    title: "Mass Spreadsheet Builder",
    text: "Build parties and slots with roles and required equipment in minutes — no more rebuilding the same sheet every week.",
  },
  {
    icon: CalendarClock,
    title: "Event Scheduling",
    text: "Location, set, date, massing time and caller — published events show members exactly when and where to show up.",
  },
  {
    icon: Users,
    title: "Member Self-Registration",
    text: "Members browse open slots and sign themselves in with their IGN. One signup per member, one member per slot — enforced by the database.",
  },
  {
    icon: Bell,
    title: "Instant Notifications",
    text: "Publishing an event notifies every approved member. Locked, completed or cancelled events are announced too.",
  },
  {
    icon: Eye,
    title: "Live Updates",
    text: "When someone claims a slot, everyone viewing the sheet sees it instantly — no manual refreshing during form-up.",
  },
  {
    icon: ShieldCheck,
    title: "Admin Oversight",
    text: "Approve members, move or remove signups, lock the roster, and audit every action. Row-level security enforces it all in the database.",
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
              Albion <span className="text-brand">Event Sheets</span>
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
              Run your Albion masses without the{" "}
              <span className="text-brand">chaos of shared spreadsheets</span>.
            </h1>
            <p className="mt-5 max-w-2xl text-lg text-muted">
              The admin plans the mass, publishes the sheet, and members sign themselves into
              slots. Parties, builds, priorities and signups — all in one live, audited place.
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
                <Eye size={14} className="text-brand" /> Every action audited
              </span>
            </div>
          </div>
        </div>
      </section>

      {/* Features */}
      <section id="features" className="border-b border-line py-20">
        <div className="mx-auto max-w-6xl px-4 sm:px-6">
          <h2 className="font-display text-3xl font-bold tracking-tight">
            Everything a mass needs, nothing it doesn&apos;t
          </h2>
          <p className="mt-3 max-w-2xl text-muted">
            One purpose: the caller prepares the sheet, members fill the slots, the roster is
            locked and the mass happens.
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
                title: "Admin builds the event",
                text: "Parties, roles, required builds, priorities and instructions — then publish.",
              },
              {
                step: "2",
                title: "Members get notified",
                text: "Every approved member sees the event and claims the slot that fits their build.",
              },
              {
                step: "3",
                title: "Lock and run the mass",
                text: "Watch signups fill live, lock the roster, mark it complete afterwards.",
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
                Stop fighting spreadsheets. Start running masses.
              </h2>
              <p className="mx-auto mt-3 max-w-xl text-muted">
                Plan events in advance, let members sign themselves up, and keep a full audit
                trail — with moderation tools built for real guild leadership.
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
            <span>Albion Event Sheets</span>
          </div>
          <p>Not affiliated with Sandbox Interactive. Built for the Albion community.</p>
        </div>
      </footer>
    </div>
  );
}
