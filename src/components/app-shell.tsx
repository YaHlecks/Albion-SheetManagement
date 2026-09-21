"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import {
  Activity,
  Bell,
  CheckCheck,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Menu,
  Settings,
  ShieldCheck,
  UserCircle2,
  Users,
  X,
} from "lucide-react";
import { Logo, Badge, Spinner } from "@/components/ui";
import { cn, timeAgo } from "@/lib/utils";
import { createBrowserClient } from "@/lib/supabase-browser";

export interface ShellUser {
  ign: string;
  email: string;
  status: string;
  isPlatformAdmin: boolean;
}

interface NotificationItem {
  id: string;
  title: string;
  body: string | null;
  type: string;
  read: boolean;
  link: string | null;
  created_at: string;
}

const memberNav = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/teams", label: "My Teams", icon: ClipboardList },
  { href: "/notifications", label: "Notifications", icon: Bell },
  { href: "/profile", label: "Profile", icon: UserCircle2 },
];

const adminNav = [
  { href: "/admin", label: "Dashboard", icon: LayoutDashboard },
  { href: "/admin/approvals", label: "Approvals", icon: ShieldCheck },
  { href: "/admin/accounts", label: "Members", icon: Users },
  { href: "/admin/teams", label: "Teams", icon: FolderKanban },
  { href: "/admin/activity", label: "Activity", icon: Activity },
  { href: "/admin/settings", label: "Settings", icon: Settings },
];

export function AppShell({ user, children }: { user: ShellUser; children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [notifOpen, setNotifOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [notifications, setNotifications] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(0);
  const [loadingNotifs, setLoadingNotifs] = useState(true);
  const [signingOut, setSigningOut] = useState(false);
  const notifRef = useRef<HTMLDivElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  const nav = user.isPlatformAdmin ? [...memberNav, ...adminNav] : memberNav;

  // Close mobile drawer on navigation.
  useEffect(() => {
    setDrawerOpen(false);
    setNotifOpen(false);
    setMenuOpen(false);
  }, [pathname]);

  // Notification polling.
  useEffect(() => {
    let cancelled = false;
    const supabase = createBrowserClient();

    async function load() {
      try {
        const { data, error } = await supabase
          .from("notifications")
          .select("id, title, body, type, read, link, created_at")
          .order("created_at", { ascending: false })
          .limit(12);
        if (error || cancelled) return;
        const rows = (data ?? []) as NotificationItem[];
        setNotifications(rows);
        setUnread(rows.filter((n) => !n.read).length);
      } finally {
        if (!cancelled) setLoadingNotifs(false);
      }
    }

    load();
    const interval = window.setInterval(load, 20_000);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, []);

  async function markAllRead() {
    const supabase = createBrowserClient();
    const { error } = await supabase
      .from("notifications")
      .update({ read: true })
      .eq("read", false);
    if (!error) {
      setNotifications((prev) => prev.map((n) => ({ ...n, read: true })));
      setUnread(0);
    }
  }

  async function handleSignOut() {
    setSigningOut(true);
    try {
      const supabase = createBrowserClient();
      await supabase.rpc("log_audit", {
        p_action: "USER_LOGOUT",
        p_target_user_id: null,
        p_team_id: null,
        p_meta: {},
      });
      await supabase.auth.signOut();
      router.replace("/login");
    } finally {
      setSigningOut(false);
    }
  }

  // Click-outside for popovers.
  useEffect(() => {
    function onDoc(e: MouseEvent) {
      if (notifRef.current && !notifRef.current.contains(e.target as Node)) setNotifOpen(false);
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, []);

  const sidebar = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center gap-2.5 border-b border-line px-5">
        <Logo />
        <span className="font-display text-[15px] font-bold tracking-tight">
          Albion <span className="text-brand">Team Sheets</span>
        </span>
      </div>
      <nav className="flex-1 space-y-1 overflow-y-auto p-3" aria-label="App navigation">
        {user.isPlatformAdmin ? (
          <p className="section-title px-2 pb-1 pt-3">Administration</p>
        ) : null}
        {user.isPlatformAdmin
          ? adminNav.map((item) => <NavItem key={item.href} {...item} pathname={pathname} />)
          : null}
        <p className="section-title px-2 pb-1 pt-3">{user.isPlatformAdmin ? "Personal" : "Menu"}</p>
        {memberNav.map((item) => (
          <NavItem key={item.href} {...item} pathname={pathname} />
        ))}
      </nav>
      <div className="border-t border-line p-4">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-elevated font-display text-sm font-bold text-brand">
            {user.ign.slice(0, 2).toUpperCase()}
          </span>
          <div className="min-w-0 flex-1">
            <p className="truncate text-sm font-semibold">{user.ign}</p>
            <p className="truncate text-xs text-faint">{user.email}</p>
          </div>
        </div>
      </div>
    </div>
  );

  return (
    <div className="flex min-h-screen">
      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-line bg-surface lg:block">
        {sidebar}
      </aside>

      {/* Mobile drawer */}
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setDrawerOpen(false)} aria-hidden="true" />
          <aside className="absolute inset-y-0 left-0 w-72 border-r border-line bg-surface shadow-2xl">
            <button
              type="button"
              className="absolute right-3 top-4 rounded p-1.5 text-muted hover:text-ink"
              onClick={() => setDrawerOpen(false)}
              aria-label="Close menu"
            >
              <X size={18} />
            </button>
            {sidebar}
          </aside>
        </div>
      ) : null}

      {/* Main column */}
      <div className="flex min-w-0 flex-1 flex-col lg:pl-64">
        {/* Topbar */}
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between gap-3 border-b border-line bg-bg/85 px-4 backdrop-blur sm:px-6">
          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost btn-sm lg:hidden"
              onClick={() => setDrawerOpen(true)}
              aria-label="Open menu"
            >
              <Menu size={18} />
            </button>
            <span className="font-display text-sm font-semibold text-muted lg:hidden">
              Albion <span className="text-brand">Team Sheets</span>
            </span>
          </div>

          <div className="flex items-center gap-1.5">
            {/* Notifications */}
            <div className="relative" ref={notifRef}>
              <button
                type="button"
                className="btn btn-ghost btn-sm relative"
                onClick={() => setNotifOpen((v) => !v)}
                aria-label={`Notifications${unread ? `, ${unread} unread` : ""}`}
                aria-expanded={notifOpen}
              >
                <Bell size={18} />
                {unread > 0 ? (
                  <span className="absolute -right-0.5 -top-0.5 flex h-4 min-w-4 items-center justify-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                    {unread > 9 ? "9+" : unread}
                  </span>
                ) : null}
              </button>
              {notifOpen ? (
                <div className="menu right-0 w-[340px] max-w-[calc(100vw-2rem)]" role="menu" aria-label="Notifications">
                  <div className="flex items-center justify-between px-2.5 py-1.5">
                    <p className="text-xs font-semibold uppercase tracking-wide text-faint">Notifications</p>
                    {unread > 0 ? (
                      <button type="button" className="inline-flex items-center gap-1 text-xs text-brand hover:underline" onClick={markAllRead}>
                        <CheckCheck size={13} /> Mark all read
                      </button>
                    ) : null}
                  </div>
                  <div className="menu-sep" />
                  <div className="max-h-[320px] overflow-y-auto">
                    {loadingNotifs ? (
                      <div className="flex items-center justify-center gap-2 py-8 text-sm text-muted">
                        <Spinner className="h-4 w-4" /> Loading…
                      </div>
                    ) : notifications.length === 0 ? (
                      <p className="px-3 py-8 text-center text-sm text-muted">No notifications yet.</p>
                    ) : (
                      notifications.map((n) => (
                        <NotificationRow key={n.id} n={n} onNavigate={() => setNotifOpen(false)} />
                      ))
                    )}
                  </div>
                  <div className="menu-sep" />
                  <Link href="/notifications" className="menu-item justify-center text-brand">
                    View all
                  </Link>
                </div>
              ) : null}
            </div>

            {/* User menu */}
            <div className="relative" ref={menuRef}>
              <button
                type="button"
                className="btn btn-ghost btn-sm gap-2"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-haspopup="menu"
              >
                <span className="flex h-6 w-6 items-center justify-center rounded-full bg-elevated font-display text-[10px] font-bold text-brand">
                  {user.ign.slice(0, 2).toUpperCase()}
                </span>
                <span className="hidden sm:inline">{user.ign}</span>
              </button>
              {menuOpen ? (
                <div className="menu right-0" role="menu">
                  <div className="px-2.5 py-2">
                    <p className="truncate text-sm font-semibold">{user.ign}</p>
                    <p className="truncate text-xs text-faint">{user.email}</p>
                    <div className="mt-1.5">
                      <Badge status={user.status} />
                      {user.isPlatformAdmin ? <span className="badge badge-admin ml-1">admin</span> : null}
                    </div>
                  </div>
                  <div className="menu-sep" />
                  <Link href="/profile" className="menu-item" role="menuitem">
                    <UserCircle2 size={15} /> Profile & settings
                  </Link>
                  <button type="button" className="menu-item menu-item-danger" role="menuitem" onClick={handleSignOut} disabled={signingOut}>
                    <LogOut size={15} /> {signingOut ? "Signing out…" : "Sign out"}
                  </button>
                </div>
              ) : null}
            </div>
          </div>
        </header>

        <main className="min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}

function NavItem({
  href,
  label,
  icon: Icon,
  pathname,
}: {
  href: string;
  label: string;
  icon: React.ComponentType<{ size?: number }>;
  pathname: string;
}) {
  const active = pathname === href || (href !== "/dashboard" && href !== "/admin" && pathname.startsWith(href));
  return (
    <Link
      href={href}
      className={cn(
        "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active ? "bg-brand-soft text-brand" : "text-muted hover:bg-elevated hover:text-ink"
      )}
      aria-current={active ? "page" : undefined}
    >
      <Icon size={17} />
      {label}
    </Link>
  );
}

function NotificationRow({ n, onNavigate }: { n: NotificationItem; onNavigate: () => void }) {
  const router = useRouter();
  const tone =
    n.type === "success" ? "text-success" : n.type === "warning" || n.type === "error" ? "text-warn" : "text-info";
  return (
    <button
      type="button"
      className={cn("menu-item items-start gap-2.5", !n.read && "notif-unread")}
      onClick={() => {
        onNavigate();
        if (n.link) router.push(n.link);
      }}
    >
      <span className={cn("mt-1 h-2 w-2 shrink-0 rounded-full", n.read ? "bg-line-strong" : tone.replace("text-", "bg-"))} />
      <span className="min-w-0 flex-1 text-left">
        <span className="block truncate text-[13px] font-semibold text-ink">{n.title}</span>
        {n.body ? <span className="mt-0.5 block text-xs text-muted">{n.body}</span> : null}
        <span className="mt-1 block text-[11px] text-faint">{timeAgo(n.created_at)}</span>
      </span>
    </button>
  );
}
