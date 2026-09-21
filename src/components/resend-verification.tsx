"use client";

import { useEffect, useRef, useState } from "react";
import { createBrowserClient } from "@/lib/supabase-browser";
import { getAuthCallbackUrl } from "@/lib/app-url";
import { Button } from "@/components/ui";
import { RESEND_COOLDOWN_SECONDS } from "@/lib/auth-state";
import { cn } from "@/lib/utils";

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * "Resend verification email" block with anti-spam cooldown.
 *
 * - Shows a 60s countdown after every successful request (also after
 *   rate-limit errors, so the user naturally backs off Supabase limits).
 * - Loading state prevents double-clicks.
 * - When the address is unknown (e.g. an expired link opened later), a
 *   required email input is rendered instead of guessing.
 * - Feedback never reveals whether the address is registered.
 */
export function ResendVerification({
  email,
  askForEmail = false,
  className,
}: {
  /** Known address to resend to; required unless askForEmail is set. */
  email?: string | null;
  /** Render an email input (used when no known address is available). */
  askForEmail?: boolean;
  className?: string;
}) {
  const [address, setAddress] = useState(email ?? "");
  const [sending, setSending] = useState(false);
  const [cooldown, setCooldown] = useState(0);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearInterval(timerRef.current);
    };
  }, []);

  function startCooldown() {
    setCooldown(RESEND_COOLDOWN_SECONDS);
    if (timerRef.current !== null) window.clearInterval(timerRef.current);
    timerRef.current = window.setInterval(() => {
      setCooldown((c) => {
        if (c <= 1) {
          if (timerRef.current !== null) window.clearInterval(timerRef.current);
          timerRef.current = null;
          return 0;
        }
        return c - 1;
      });
    }, 1000);
  }

  async function handleResend() {
    const target = (askForEmail ? address : (email ?? address)).trim();
    if (!EMAIL_RE.test(target)) {
      setFeedback({ tone: "error", text: "Enter the email address you registered with." });
      return;
    }
    setFeedback(null);
    setSending(true);
    try {
      const supabase = createBrowserClient();
      const { error } = await supabase.auth.resend({
        type: "signup",
        email: target,
        options: {
          // Same env-based callback as the original email; the redirect
          // target is the dedicated verification page (never the reset flow).
          emailRedirectTo: `${getAuthCallbackUrl()}?next=/verify-email`,
        },
      });

      if (error) {
        if (/rate limit|429|too many/i.test(error.message)) {
          setFeedback({
            tone: "error",
            text: "Too many requests. Please wait a minute before trying again.",
          });
          startCooldown();
        } else {
          setFeedback({
            tone: "error",
            text: "Could not send the verification email. Please try again shortly.",
          });
        }
        return;
      }

      setFeedback({ tone: "success", text: `Verification email sent to ${target}.` });
      startCooldown();
    } catch {
      setFeedback({ tone: "error", text: "Network error. Check your connection and try again." });
    } finally {
      setSending(false);
    }
  }

  return (
    <div className={cn("mt-5 rounded-lg border border-line bg-elevated/40 p-4 text-left", className)}>
      <p className="text-xs font-semibold uppercase tracking-wide text-faint">Didn&apos;t receive the email?</p>

      {askForEmail ? (
        <div className="mt-3">
          <label htmlFor="resend-email" className="field-label">Email address</label>
          <input
            id="resend-email"
            type="email"
            className="field"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
            placeholder="you@example.com"
            autoComplete="email"
            disabled={sending}
          />
        </div>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        loading={sending}
        disabled={cooldown > 0}
        onClick={handleResend}
        className="mt-3 w-full"
      >
        Resend verification email
      </Button>

      {cooldown > 0 ? (
        <p className="field-hint mt-2 text-center">
          You can request another email in {cooldown} second{cooldown === 1 ? "" : "s"}.
        </p>
      ) : null}

      {feedback ? (
        <p
          className={cn(
            "mt-2 text-center text-xs",
            feedback.tone === "success" ? "text-success" : "text-danger"
          )}
          role="status"
        >
          {feedback.text}
        </p>
      ) : null}

      <p className="field-hint mt-2 text-center">Tip: check your spam or junk folder too.</p>
    </div>
  );
}
