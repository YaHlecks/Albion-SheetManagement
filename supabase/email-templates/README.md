# Supabase Authentication & Email Configuration

> **Required one-time setup.** The application code is ready, but Supabase
> must be told where to send email links and which URLs are allowed. Without
> this, verification/recovery links land on the wrong host and sign-in can
> still fail with `400: Email not confirmed` for unverified users.

---

## 1. URL Configuration

Supabase Dashboard → **Authentication → URL Configuration**

| Setting | Value |
| --- | --- |
| **Site URL** | Your production origin, e.g. `https://albion-team-sheets.vercel.app` (no trailing slash) |
| **Redirect URLs** | Add **every** origin the app runs on: |

```text
https://your-production-domain.com
https://*-your-team.vercel.app        (Vercel preview deployments)
https://your-project-ref.supabase.co  (rarely needed)
http://localhost:3000                 (local development)
```

`redirect_to` / `emailRedirectTo` values that are **not** in this list are
silently rewritten to the Site URL — the #1 cause of broken confirmation
links on deployed domains.

## 2. Email confirmation (must stay ON)

Supabase Dashboard → **Authentication → Sign In / Providers → Email**

- **Confirm email: ON.** Do not disable this to "fix" login — the app now
  handles unverified users with a clear message and a resend option.
- ** OTP / magic-link expiry** can stay at the default (email tokens are
  single-use; the app's callback handles `otp_expired` gracefully).

## 3. Email templates

Supabase → **Authentication → Emails → Templates** — paste the matching HTML
from this folder and set the subjects:

| Template | Subject | File |
| --- | --- | --- |
| Confirm signup | `Verify your email — Albion Team Sheets` | `confirm-signup.html` |
| Reset password | `Reset your password — Albion Team Sheets` | `reset-password.html` |

Both templates keep `{{ .ConfirmationURL }}`; the flows are separated by the
link's `type` parameter (`recovery` vs absent), which the app's callback at
`/auth/callback` reads — verification → `/verify-email`, recovery →
`/reset-password`.

## 4. SMTP (production)

Supabase's built-in email sender is heavily rate-limited (a few messages per
hour) and is meant for testing only. For production:

1. Supabase → **Authentication → Emails → SMTP Settings** → enable custom SMTP.
2. Configure any provider (Resend, Postmark, SES, …) and paste its
   credentials **into Supabase only**. SMTP secrets never belong in this
   repository or in Vercel environment variables.

## 5. Application environment variables

`.env.local` (development) and Vercel → Project → Settings → Environment
Variables (Production + Preview):

| Variable | Where | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | browser-safe | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | browser-safe | anon key (RLS enforced) |
| `SUPABASE_SERVICE_ROLE_KEY` | server-only | privileged writes; never with `NEXT_PUBLIC_` |
| `DATABASE_URL` | server-only (scripts) | `npm run db:push` / `db:bootstrap` |
| `NEXT_PUBLIC_APP_URL` | browser-safe | **Canonical origin embedded in email links.** Set it to the production URL in Vercel Production and the preview URL in Preview. Falls back to `VERCEL_URL`, then `http://localhost:3000`. |

## 6. How the flows stay separate (architecture summary)

```text
REGISTER → signUp(emailRedirectTo: {APP}/auth/callback?next=/verify-email)
         → "Check your email" screen (resend + cooldown)
         → user clicks "Verify My Account" (type=signup link)
         → /auth/callback exchanges code → /verify-email?fresh=1
         → "Email verified!" + truthful account state
             (first account: Admin/Active · others: approval pending)

FORGOT PASSWORD → /api/auth/recover (redirect_to: {APP}/auth/callback?next=/reset-password&type=recovery)
                → user clicks "Reset Password" (type=recovery link)
                → /auth/callback exchanges code → /reset-password
                → password updated → signed out → back to login
```

The callback distinguishes the flows **by the link's `type` parameter**, so a
verification link can never open the reset form and vice versa. Expired or
already-used links land on flow-specific error states (both with resend).
