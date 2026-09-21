import { NextResponse } from "next/server";
import { getAppUrl } from "@/lib/app-url";

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || "";
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || "";

// Simple in-memory rate limiter (per instance). For production at scale,
// put a CDN/WAF rule or Upstash rate limiter in front — this guards the
// common abuse case out of the box.
const hits = new Map<string, { count: number; resetAt: number }>();
const WINDOW_MS = 10 * 60 * 1000; // 10 minutes
const MAX_REQUESTS = 5;

function rateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt < now) {
    hits.set(ip, { count: 1, resetAt: now + WINDOW_MS });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_REQUESTS;
}

export async function POST(req: Request) {
  const ip =
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown";

  if (rateLimited(ip)) {
    return NextResponse.json(
      { message: "Too many requests. Please try again later." },
      { status: 429 }
    );
  }

  const { email } = await req.json().catch(() => ({ email: "" }));
  const emailStr = typeof email === "string" ? email.trim().toLowerCase() : "";
  if (!emailStr || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(emailStr)) {
    return NextResponse.json({ message: "Invalid email address." }, { status: 400 });
  }
  if (!SUPABASE_URL || !ANON_KEY) {
    return NextResponse.json({ message: "Password reset is not configured." }, { status: 500 });
  }

  try {
    // redirect_to MUST be an allowlisted URL in Supabase → Authentication →
    // URL Configuration, otherwise Supabase rewrites the link to the Site URL
    // and the reset flow breaks on deployed domains.
    const redirectTo = `${getAppUrl()}/auth/callback?next=/reset-password&type=recovery`;
    const resp = await fetch(`${SUPABASE_URL}/auth/v1/recover`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: ANON_KEY,
      },
      body: JSON.stringify({ email: emailStr, redirect_to: redirectTo }),
    });

    if (!resp.ok && resp.status !== 422) {
      // 422 ("user not found") is intentionally swallowed: the response must
      // not reveal whether an email is registered. Other failures surface.
      console.error("[auth] recover request failed:", resp.status, await safeText(resp));
      return NextResponse.json(
        { message: "Could not send the reset email. Please try again later." },
        { status: 502 }
      );
    }

    // Deliberately do not reveal whether the address exists.
    return NextResponse.json({ message: "OK" });
  } catch {
    return NextResponse.json(
      { message: "Could not send the reset email. Please try again later." },
      { status: 502 }
    );
  }
}

async function safeText(resp: Response): Promise<string> {
  try {
    return (await resp.text()).slice(0, 300);
  } catch {
    return "";
  }
}
