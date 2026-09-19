import { AppShell } from "@/components/app-shell";
import { requirePageSession } from "@/lib/api";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await requirePageSession();

  return (
    <AppShell
      user={{
        ign: ctx.profile?.ign ?? "Member",
        email: ctx.email,
        status: ctx.profile?.status ?? "approved",
        isPlatformAdmin: ctx.isPlatformAdmin,
      }}
    >
      {children}
    </AppShell>
  );
}
