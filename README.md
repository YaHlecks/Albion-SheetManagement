# Albion Event Sheets

Event / mass scheduling and sign-up system for Albion Online guilds — the admin (caller) prepares a mass spreadsheet (parties, roles, required builds), publishes it, and approved members sign themselves into slots. Replaces shared spreadsheets with a live, permissioned, fully-audited system.

## Tech Stack

- **Next.js 15** (App Router) + React 19 + TypeScript (strict)
- **Tailwind CSS 4** with a custom dark-first design system
- **Supabase** (PostgreSQL + Auth + Row Level Security)
- **Vitest** for unit tests

## Quick Start

```bash
npm install
cp .env.example .env.local   # fill in the values (see below)
npm run db:push              # create schema, triggers, policies (needs DATABASE_URL)
npm run dev                  # http://localhost:3000
```

> If `npm run db:push` complains about the missing `pg` package, run
> `npm install --no-save pg` once, or simply paste
> `supabase/migrations/0001_init.sql` into the Supabase SQL Editor.

### Environment variables

| Variable | Browser-safe | Purpose |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | yes | Supabase anon key — safe because RLS is enforced on every table |
| `NEXT_PUBLIC_APP_URL` | yes | Canonical origin embedded in email links. Falls back to `VERCEL_URL`, then `http://localhost:3000`. Must be allowlisted in Supabase → URL Configuration |
| `SUPABASE_SERVICE_ROLE_KEY` | **no** | Server-only admin operations (fast path). If unset, the app runs in *fallback mode* and performs privileged writes through `security definer` RPCs that re-verify admin rights in the database |
| `DATABASE_URL` | no | Postgres connection string used by `npm run db:push` only |

Secrets are never committed (`.env*` is git-ignored) and the service-role key is only read in server modules guarded against browser use.

### First administrator

**Zero-config on a fresh database:** the first account to register automatically becomes the platform administrator (`is_platform_admin = true`, status `approved`). The decision is made **inside the `handle_new_user` trigger** on `auth.users` — a `security definer` function the client cannot influence — and is serialized with `pg_advisory_xact_lock`, so two simultaneous registrations cannot both claim the "first" slot (no check-then-insert race). Both the `USER_REGISTERED` and the `PERMISSION_CHANGED` bootstrap events are written to the audit log. Every subsequent registration is an ordinary pending member awaiting approval.

**Existing databases whose earliest account predates this rule** (it would be stuck at `pending`): the app self-heals — `claim_first_admin()` is a security-definer RPC that promotes the caller **only if** it is the earliest profile in the database **and** no administrator exists; otherwise it is a no-op. It runs automatically at session resolution (idempotent, audited as `PERMISSION_CHANGED`).

If you ever need a different owner (or all admins were lost), use the recovery script:

```bash
npm run db:bootstrap -- you@example.com
```

(Or paste `supabase/bootstrap-admin.sql` into the Supabase SQL Editor after editing the email at the top.) Use it when the database predates the first-admin rule, the intended admin registered second, or all admins were removed. The script verifies the account exists in `auth.users`, provisions the profile if needed, promotes it to `is_platform_admin`, approves it, and writes an auditable `PERMISSION_CHANGED` event. It never creates credentials and is idempotent. Additional admins are then promoted from the UI (Admin → Members → Grant admin), enforced inside the `admin_action` RPC.

## The Complete Chain

```
REGISTER → VERIFY EMAIL → AUTHENTICATE → ACCOUNT APPROVAL →
EVENT PUBLISHED (notification) → MEMBER SIGNS INTO A SLOT →
REALTIME ROSTER UPDATES → ADMIN LOCKS ROSTER → MASS HAPPENS →
COMPLETED / ARCHIVED (full audit trail)
```

### Email verification vs password recovery vs account approval

Three strictly separated concepts:

1. **Email verification** — proves the address is owned. Decided **only** by
   Supabase (`auth.users.email_confirmed_at`). Flow: register → *Check your
   email* screen (resend with 60s cooldown) → click **Verify My Account** in
   the branded email → `/auth/callback` exchanges the code (PKCE) →
   `/verify-email` shows **Email verified!** plus the truthful account state
   (first account: *admin + active*; others: *approval pending*). Expired or
   already-used links get a dedicated *link invalid or expired* state with
   resend — never a crash and never the reset form.
2. **Password recovery** — separate flow: *Forgot password?* → rate-limited
   `/api/auth/recover` (explicit, env-based `redirect_to`) → **Reset
   Password** email (blue, visually distinct) → `/auth/callback?…type=recovery`
   → `/reset-password`. The callback separates the flows by the link's `type`
   parameter, so a verification link can never open the reset form and vice
   versa.
3. **Account approval** — `profiles.status` (`pending → approved`, plus
   `rejected/suspended/archived`), managed by admins. A verified email is
   never reported as an approved account. A profile/database failure is a
   distinct PROFILE_ERROR state, never "pending".

Unverified users who try to sign in get *"Email not verified — please verify
your email address before signing in"* with an inline resend block (the
sign-in error mapper inspects the message because Supabase returns `Email not
confirmed` as HTTP 400, the same status as bad credentials). They are never
routed to `/pending-approval` for verification problems.

Professional HTML email templates for Supabase (Auth → Emails → Templates)
and the full Supabase configuration checklist live in
[`supabase/email-templates/`](supabase/email-templates/README.md).

Every step is enforced **server-side** (database RLS + security-definer RPCs + server route guards), never only in the UI.

## Events (mass scheduling & sign-ups)

The core model (`supabase/migrations/0001_init.sql`):

```
profiles → events (title, location, portal, set, event_date, massing_time,
           timezone, caller, instructions,
           status: draft | published | locked | completed | cancelled | archived,
           is_template)
              → event_parties (name, fill_note, sort_order)
                   → event_slots (role, equipment, tier_requirement, priority,
                                  required, notes, sort_order)
                        → event_signups (UNIQUE slot_id, UNIQUE (event_id, user_id),
                                         ign, note, signed_up_at)
albion_equipment (catalog) · notifications · audit_logs
```

**Admin** — `/admin/events`: status tabs, event cards with live fill counters;
4-step builder (`/admin/events/new`) covering information → parties (add /
rename / duplicate / delete, fill notes) → slots (roles + equipment with the
Albion browser, tier requirements, priorities, reorder) → preview. Lifecycle:
publish (notifies all approved members), lock, unlock, complete, cancel,
archive, duplicate (structure only, never signups). Signup management: assign
an approved member to any slot, move, or remove — all audited.

**Member** — dashboard and `/events` show upcoming masses with fill progress;
the event page is a spreadsheet-style sheet (MASS LOCATION / SET / MASSING
TIME / CALLER header, instructions, party tables, mobile party cards). Members
claim an open slot (IGN comes from their profile), leave it, or filter by
role / party / status — with realtime updates via one Supabase Realtime
channel per event.

**Enforcement** — all in the database, verified by `npm run db:doctor`:

| Table | anon | authenticated | writes |
|---|---|---|---|
| `events` / parties / slots | none | SELECT (published/locked/completed; drafts & templates admin-only) | RPC only |
| `event_signups` | none | SELECT + own-row-only on published events | RPCs (`claim_event_slot`, `leave_event_slot`, `admin_set_signup`) |
| `albion_equipment` | none | SELECT | admin RPC / seed |
| `notifications` | none | own rows, mark-read | insert via publish RPC |
| `audit_logs` | none | admin read | RPC/trigger inserts only |

Concurrent claims of the same slot are decided by `UNIQUE(slot_id)`; the loser
gets a friendly "slot was just taken" message. One signup per member per event
is a second unique constraint. Pending / suspended / rejected accounts are
rejected inside the RPCs, never just in the UI.

## Architecture

```
src/
  app/
    page.tsx                  public landing page
    (auth)/                   login, register, forgot/reset password
    verify-email/             dedicated email-verification experience (per-state)
    auth/callback/            confirmation/recovery code exchange (flow-aware)
    (app)/                    authenticated shell (guarded layout)
      dashboard/              member dashboard (upcoming events + my signups)
      events/                 event browse + spreadsheet-style event page
      notifications/          full notification list
      profile/                profile & password settings
      admin/                  dashboard, events (builder + lifecycle), approvals,
                              members, activity, settings
    api/
      auth/recover/           rate-limited recovery proxy
      admin/action/           guarded member-management endpoint (RPC-backed)
  components/                 design-system primitives + feature components
  lib/                        env, supabase clients (browser/server/admin), auth, audit, validation
supabase/migrations/0001_init.sql   event schema + RPCs + RLS (authoritative, idempotent)
supabase/migrations/0002_auth_profile_layer.sql   auth/profile contract: ensure_profile,
                                  touch_login, check_ign_available, claim_first_admin,
                                  login/status timestamps, USER_LOGIN audit, notifications realtime
supabase/reset.sql                 destructive DEVELOPMENT reset (never touches auth.users)
middleware.ts                 session refresh + route protection (Node runtime)
```

### Database security model

- **RLS on every table, recursion-free.** Cross-table visibility goes through `security definer` helpers (`is_event_admin()`, `is_event_visible()`, `is_event_party_visible()`, `is_event_slot_visible()`), which evaluate as the table owner and never re-enter RLS. No policy queries its own table — the classic cause of `42P17: infinite recursion detected in policy`.
- **Two user levels (§5)**: admin (`is_platform_admin` + `approved`, resolved inside the database) and approved member. Drafts and templates are admin-only; published/locked/completed events are visible to approved members.
- **No client writes to protected tables.** At grant level `authenticated` has SELECT only; every write flows through a `security definer` RPC that re-verifies identity, approval and event status inside the database. Members can only ever write their own signup row.
- **Signup integrity** is enforced by two unique constraints (`slot_id` — one member per slot; `(event_id, user_id)` — one signup per event) plus in-RPC checks: approved account, published event, no duplicate signup. Races surface as friendly `SLOT_TAKEN` / `ALREADY_SIGNED_UP` codes.
- **Append-only audit trail.** Publish/lock/cancel/complete/archive, structure saves, duplications, signups, moves and member-management actions all write `audit_logs`; members cannot read or write them.
- **Account lifecycle**: `pending → approved → suspended/reactivated → archived` (soft delete), plus `rejected`. The first account on a fresh database is bootstrapped admin+approved inside the `handle_new_user` trigger.
## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start dev server |
| `npm run build` | Production build (must pass strict typecheck) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (validation + permission logic + DB policy regression guards) |
| `npm run db:push` | Apply `supabase/migrations/*.sql` via `DATABASE_URL` |
| `npm run db:reset` | ⚠️ Destructive DEVELOPMENT reset: drops the app schema (never `auth.users`), typed confirmation required |
| `npm run db:doctor` | Live verification: tables, grants, RLS, RPCs, role simulation, claim-race proof, legacy-object check |

## Deployment (Vercel)

1. Import the repo in Vercel — framework preset **Next.js** (build `npm run build`; output is managed by Next.js, no public/ output dir).
2. Set env vars for Production + Preview: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (recommended).
3. In Supabase → Authentication → URL Configuration, add your Vercel domain(s) as Site URL / Redirect URLs — **including preview domains and `http://localhost:3000`**. Set `NEXT_PUBLIC_APP_URL` to the production URL (and the preview URL for Preview). See [`supabase/email-templates/README.md`](supabase/email-templates/README.md) for the full checklist (templates, confirmation ON, SMTP).
4. Deploy. `middleware.ts` runs on the Node.js runtime so `@supabase/ssr` cookie handling works on Vercel.

## Testing Performed

- `npm run typecheck` — strict, zero errors
- `npm test` — 75 unit tests: validation schemas, permission matrix mirroring the DB RPC rules, and static regression guards over both SQL migrations (no policy queries its own table → 42P17 cannot return; RLS enabled + grants restricted on every table; auth/profile contract — `ensure_profile`, `touch_login`, `check_ign_available`, `claim_first_admin` — pinned; audit RPC hardening; bootstrap invariants)
- `npm run build` — production build passes
- Workflow checks: register → IGN availability → verify email → login self-heal → pending gate → approve → event signup → audit trail → lock → suspend

> Behavioral RLS testing against a live Postgres (probe queries as anon/pending/member/admin roles) requires a real Supabase project; run `npm run db:push` then exercise the five account contexts listed in `tests/permissions.test.ts`.

## Security Notes

- Sessions are httpOnly JWT cookies managed by Supabase Auth; middleware uses `getUser()` (server-verified) rather than trusting cookie contents.
- Admin status lives in `profiles.is_platform_admin` and is checked server-side on every admin route/endpoint — it cannot be toggled from the browser.
- Password recovery is rate-limited and never reveals whether an email is registered.
- Email verification stays enabled; the verification link only confirms the address — it never resets passwords, and its callback is separate from the recovery callback.
- Status transitions are validated in the database (e.g. only `approved` accounts can be suspended; only `pending` can be rejected).
