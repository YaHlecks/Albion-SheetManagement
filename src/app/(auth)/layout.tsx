import Link from "next/link";
import { ShieldCheck, Users, Eye } from "lucide-react";
import { Logo } from "@/components/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      {/* Brand panel */}
      <div className="landing-grid relative hidden border-r border-line lg:block">
        <div className="flex h-full flex-col justify-between p-10 xl:p-14">
          <Link href="/" className="flex items-center gap-2.5">
            <Logo />
            <span className="font-display text-lg font-bold tracking-tight">
              Albion <span className="text-brand">Event Sheets</span>
            </span>
          </Link>
          <div className="max-w-md">
            <h2 className="font-display text-3xl font-bold leading-tight tracking-tight">
              Your masses, <span className="text-brand">under control</span>.
            </h2>
            <ul className="mt-8 space-y-4 text-sm text-muted">
              <li className="flex items-start gap-3">
                <Users size={18} className="mt-0.5 shrink-0 text-brand" />
                Members see published events and sign into the slot that fits their build.
              </li>
              <li className="flex items-start gap-3">
                <Eye size={18} className="mt-0.5 shrink-0 text-brand" />
                Live sheets: claims appear for everyone instantly.
              </li>
              <li className="flex items-start gap-3">
                <ShieldCheck size={18} className="mt-0.5 shrink-0 text-brand" />
                Approvals, moderation and a full audit trail for admins.
              </li>
            </ul>
          </div>
          <p className="text-xs text-faint">Not affiliated with Sandbox Interactive.</p>
        </div>
      </div>

      {/* Form panel */}
      <div className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-md">
          <Link href="/" className="mb-8 flex items-center justify-center gap-2.5 lg:hidden">
            <Logo />
            <span className="font-display text-lg font-bold tracking-tight">
              Albion <span className="text-brand">Event Sheets</span>
            </span>
          </Link>
          {children}
        </div>
      </div>
    </div>
  );
}
