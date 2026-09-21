/**
 * Application origin used in email links (verification / password recovery).
 *
 * Priority:
 *   1. NEXT_PUBLIC_APP_URL   — explicit override, recommended in production
 *   2. VERCEL_URL            — set automatically on Vercel (preview + prod)
 *   3. http://localhost:3000 — local development
 *
 * The redirect target embedded in outgoing emails must match a URL
 * whitelisted in Supabase → Authentication → URL Configuration (Redirect
 * URLs), otherwise Supabase rewrites the link to the Site URL. Add every
 * deployed origin (production + preview domains + localhost) there.
 */
export function getAppUrl(): string {
  if (process.env.NEXT_PUBLIC_APP_URL) return trimSlash(process.env.NEXT_PUBLIC_APP_URL);
  if (process.env.VERCEL_URL) return `https://${trimSlash(process.env.VERCEL_URL)}`;
  return "http://localhost:3000";
}

/** Absolute URL of the confirmation callback, e.g. https://app.example.com/auth/callback */
export function getAuthCallbackUrl(): string {
  return `${getAppUrl()}/auth/callback`;
}

function trimSlash(value: string): string {
  return value.replace(/\/+$/, "");
}
