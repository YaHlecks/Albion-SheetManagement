"use client";

import {
  useEffect,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type ReactNode,
} from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, Search, X } from "lucide-react";
import { cn } from "@/lib/utils";

/* ============================ Logo ============================ */

export function Logo({ size = 34 }: { size?: number }) {
  return (
    <span style={{ width: size, height: size }} className="inline-flex shrink-0 items-center justify-center rounded-lg bg-brand-soft text-brand">
      <svg width={size * 0.62} height={size * 0.62} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M13 2 4.5 13.5H11L9.5 22 19 9.5h-6.5L13 2z" />
      </svg>
    </span>
  );
}

/* ============================ Badge ============================ */

const badgeStyles: Record<string, string> = {
  pending: "badge badge-pending",
  approved: "badge badge-approved",
  rejected: "badge badge-rejected",
  suspended: "badge badge-suspended",
  open: "badge badge-open",
  locked: "badge badge-locked",
  draft: "badge badge-draft",
  archived: "badge badge-archived",
  neutral: "badge badge-neutral",
  admin: "badge badge-admin",
  role: "badge badge-role",
};

export function Badge({ status, kind }: { status?: string; kind?: "admin" | "role" | "neutral" }) {
  const cls = kind ? badgeStyles[kind] : badgeStyles[status ?? "neutral"] ?? badgeStyles.neutral;
  return <span className={cls}>{status ?? kind}</span>;
}

/* ============================ Card / StatCard ============================ */

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn("panel", className)}>{children}</div>;
}

export function StatCard({
  label,
  value,
  hint,
  href,
  tone = "default",
}: {
  label: string;
  value: number | string;
  hint?: string;
  href?: string;
  tone?: "default" | "warn" | "success" | "danger";
}) {
  const toneClass =
    tone === "warn"
      ? "text-warn"
      : tone === "success"
        ? "text-success"
        : tone === "danger"
          ? "text-danger"
          : "text-ink";
  const inner = (
    <div className="stat-card panel-hover h-full transition-colors">
      <p className="section-title">{label}</p>
      <p className={cn("stat-value mt-2", toneClass)}>{value}</p>
      {hint ? <p className="mt-1 text-xs text-faint">{hint}</p> : null}
    </div>
  );
  return href ? (
    <Link href={href} className="block focus-visible:outline-none">
      {inner}
    </Link>
  ) : (
    inner
  );
}

/* ============================ Spinner ============================ */

export function Spinner({ className }: { className?: string }) {
  return (
    <svg className={cn("animate-spin", className)} width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" className="opacity-25" />
      <path d="M22 12a10 10 0 0 1-10 10" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
    </svg>
  );
}

export function LoadingBlock({ label }: { label: string }) {
  return (
    <div className="flex items-center justify-center gap-3 py-14 text-sm text-muted" role="status">
      <Spinner className="text-brand" />
      {label}
    </div>
  );
}

/* ============================ EmptyState ============================ */

export function EmptyState({
  icon,
  title,
  description,
  action,
}: {
  icon?: ReactNode;
  title: string;
  description?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line-strong bg-card/40 px-6 py-14 text-center">
      {icon ? <div className="mb-1 text-faint">{icon}</div> : null}
      <p className="font-semibold text-ink">{title}</p>
      {description ? <p className="max-w-sm text-sm text-muted">{description}</p> : null}
      {action ? <div className="mt-3">{action}</div> : null}
    </div>
  );
}

/* ============================ Button ============================ */

export function Button({
  variant = "primary",
  size = "md",
  loading = false,
  className,
  children,
  disabled,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger" | "ghost" | "outline-danger";
  size?: "md" | "sm";
  loading?: boolean;
}) {
  const variantClass =
    variant === "primary"
      ? "btn-primary"
      : variant === "secondary"
        ? "btn-secondary"
        : variant === "danger"
          ? "btn-danger"
          : variant === "ghost"
            ? "btn-ghost"
            : "btn-outline-danger";
  return (
    <button
      className={cn("btn", variantClass, size === "sm" && "btn-sm", className)}
      disabled={disabled || loading}
      {...props}
    >
      {loading ? <Spinner /> : null}
      {children}
    </button>
  );
}

/* ============================ Confirm dialog ============================ */

export function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = "Confirm",
  cancelLabel = "Cancel",
  danger = false,
  busy = false,
  onConfirm,
  onCancel,
}: {
  open: boolean;
  title: string;
  body: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => { if (e.key === "Escape" && !busy) onCancel(); }}>
      <div className="modal">
        <div className="flex items-start gap-3 p-5">
          {danger ? (
            <span className="mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-danger-soft text-danger">
              <AlertTriangle size={18} />
            </span>
          ) : null}
          <div className="min-w-0">
            <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
            <p className="mt-1 text-sm text-muted">{body}</p>
          </div>
        </div>
        <div className="flex justify-end gap-2 border-t border-line px-5 py-4">
          <button type="button" className="btn btn-secondary" onClick={onCancel} disabled={busy}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={cn("btn", danger ? "btn-danger" : "btn-primary")}
            onClick={onConfirm}
            disabled={busy}
          >
            {busy ? <Spinner /> : null}
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ============================ Modal ============================ */

export function Modal({
  open,
  title,
  onClose,
  children,
  wide = false,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
}) {
  if (!open) return null;
  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-label={title} onKeyDown={(e) => { if (e.key === "Escape") onClose(); }}>
      <div className={cn("modal", wide && "modal-lg")}>
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h3 className="font-display text-base font-semibold">{title}</h3>
          <button type="button" className="btn-ghost btn-sm" aria-label="Close dialog" onClick={onClose}>
            <X size={16} />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

/* ============================ Dropdown ============================ */

export function Dropdown({
  trigger,
  children,
  align = "right",
  buttonClass,
  title,
}: {
  trigger: ReactNode;
  children: ReactNode | ((close: () => void) => ReactNode);
  align?: "left" | "right";
  buttonClass?: string;
  title?: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onDocClick(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDocClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative inline-block" ref={ref}>
      <button type="button" title={title} className={buttonClass ?? "btn btn-secondary btn-sm"} onClick={() => setOpen((v) => !v)} aria-expanded={open} aria-haspopup="menu">
        {trigger}
      </button>
      {open ? (
        <div className={cn("menu", align === "right" ? "right-0" : "left-0")} role="menu">
          {typeof children === "function" ? children(() => setOpen(false)) : children}
        </div>
      ) : null}
    </div>
  );
}

/* ============================ SearchInput ============================ */

export function SearchInput({
  value,
  onChange,
  placeholder,
  className,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  className?: string;
}) {
  return (
    <div className={cn("relative", className)}>
      <Search size={15} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-faint" aria-hidden="true" />
      <input
        type="search"
        className="field pl-9"
        style={{ paddingRight: value ? 34 : 12 }}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
      />
      {value ? (
        <button
          type="button"
          aria-label="Clear search"
          className="absolute right-2 top-1/2 -translate-y-1/2 rounded p-1 text-faint hover:text-ink"
          onClick={() => onChange("")}
        >
          <X size={14} />
        </button>
      ) : null}
    </div>
  );
}

/* ============================ Pagination ============================ */

export function Pagination({
  page,
  pageCount,
  onPage,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className="mt-4 flex items-center justify-between">
      <p className="text-xs text-faint">
        Page {page + 1} of {pageCount}
      </p>
      <div className="flex gap-2">
        <button type="button" className="btn btn-secondary btn-sm" disabled={page <= 0} onClick={() => onPage(page - 1)}>
          <ChevronLeft size={14} /> Prev
        </button>
        <button type="button" className="btn btn-secondary btn-sm" disabled={page >= pageCount - 1} onClick={() => onPage(page + 1)}>
          Next <ChevronRight size={14} />
        </button>
      </div>
    </div>
  );
}

/* ============================ Save state ============================ */

export function SaveStateIndicator({ state }: { state: "idle" | "saving" | "saved" | "error" }) {
  if (state === "saving") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-muted">
        <Spinner className="h-3 w-3" /> Saving…
      </span>
    );
  }
  if (state === "saved") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-success">
        <Check size={13} /> Saved
      </span>
    );
  }
  if (state === "error") {
    return (
      <span className="inline-flex items-center gap-1.5 text-xs text-danger">
        <AlertTriangle size={13} /> Save failed
      </span>
    );
  }
  return null;
}
