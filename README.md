# Albion Team Sheets

Team sheet management platform for Albion Online guilds — controlled team sheets, account approval, activity tracking and moderation in one place. Replaces shared spreadsheets with a permissioned, fully-audited system.

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
REGISTER → AUTHENTICATE → ACCOUNT APPROVAL → TEAM ASSIGNMENT →
TEAM ACCESS → SHEET EDITING → AUTOMATIC CHANGE TRACKING →
ADMIN REVIEW → MODERATION / REVERT / LOCK
```

Every step is enforced **server-side** (database RLS + security-definer RPCs + server route guards), never only in the UI.

## Architecture

```
src/
  app/
    page.tsx                  public landing page
    (auth)/                   login, register, forgot/reset password
    auth/callback/            recovery/confirmation code exchange
    (app)/                    authenticated shell (guarded layout)
      dashboard/              member dashboard
      teams/                  member teams + team sheet (core feature)
      notifications/          full notification list
      profile/                profile & password settings
      admin/                  dashboard, approvals, members, teams, activity, settings
    api/
      auth/recover/           rate-limited recovery proxy
      sheet/update-field/     sheet cell autosave (RPC-backed)
      admin/action/           single guarded admin action endpoint (RPC-backed)
      admin/revert-field/     admin revert + audit + notification
      admin/search-users/     admin member-picker search
  components/                 design-system primitives + feature components
  lib/                        env, supabase clients (browser/server/admin), auth, audit, validation
supabase/migrations/0001_init.sql   schema + triggers + RPCs + RLS (single idempotent file)
middleware.ts                 session refresh + route protection (Node runtime)
```

### Database security model

- **RLS on every table, recursion-free.** Every cross-table authorization check in a policy goes through a `security definer` helper (`is_platform_admin()`, `is_team_member()`, `is_team_editable()`, `shares_team_with_me()`), which evaluates as the table owner and therefore never re-enters RLS. Policies never query their own table — the classic cause of Postgres `42P17: infinite recursion detected in policy`.
- **Every operation gets its own policy** (SELECT/INSERT/UPDATE/DELETE separated per table); there is no broad one-size-fits-all policy.
- **No client writes to protected tables.** `audit_logs` has a single admin-only SELECT policy and no write policies; `notifications` are scoped to their owner. Privileged writes flow exclusively through `security definer` RPCs and DB triggers.
- **Members never read `audit_logs` directly.** The dashboard uses the `recent_own_activity()` definer RPC, which returns only events where the caller is the actor or the target.
- **`admin_action` RPC** performs privileged operations with the admin check *inside* the function. In service-role mode the application server passes `p_actor_id` from its own server-verified session so audit rows still carry the real acting admin — the browser can never supply it.
- **`update_member_field` RPC** re-validates membership, account status, team status and sheet lock atomically on every cell save — the frontend is a convenience, not the gate.
- **Hardened RPCs.** `log_audit` rejects actions the database records automatically and restricts everything else to admins (logout excepted); `notify_user` is admin/server-only so members cannot spoof notifications; `ensure_profile` provisions a missing profile on first login using the verified JWT identity only, and can never grant admin.
- **Append-only audit trail.** Field changes record actor, target, team, field, previous value and new value. Reverts restore the value and write a `CHANGE_REVERTED` event; nothing is ever edited or deleted.
- **Account lifecycle**: `pending → approved → suspended/reactivated → archived` (soft delete; history preserved), plus `rejected`. Account approval and team membership are independent.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start dev server |
| `npm run build` | Production build (must pass strict typecheck) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (validation + permission logic + DB policy regression guards) |
| `npm run db:push` | Apply `supabase/migrations/*.sql` via `DATABASE_URL` |
| `npm run db:bootstrap -- email` | Recovery: promote a registered account to platform admin (first admin is automatic on a fresh DB) |

## Deployment (Vercel)

1. Import the repo in Vercel — framework preset **Next.js** (build `npm run build`; output is managed by Next.js, no public/ output dir).
2. Set env vars for Production + Preview: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (recommended).
3. In Supabase → Authentication → URL Configuration, add your Vercel domain(s) as Site URL / Redirect URLs (used by password-reset links).
4. Deploy. `middleware.ts` runs on the Node.js runtime so `@supabase/ssr` cookie handling works on Vercel.

## Testing Performed

- `npm run typecheck` — strict, zero errors
- `npm test` — 43 unit tests: validation schemas, permission matrix mirroring the DB RPC rules, and 24 static regression guards over the SQL migration (no policy queries its own table → 42P17 cannot return; RLS enabled + grants restricted on every table; audit RPC hardening; bootstrap invariants)
- `npm run build` — production build passes, 25 routes
- Workflow checks: register → pending gate → approve → team assignment → sheet editing → audit trail → revert → lock → suspend

> Behavioral RLS testing against a live Postgres (probe queries as anon/pending/member/admin roles) requires a real Supabase project; run `npm run db:push` then exercise the five account contexts listed in `tests/permissions.test.ts`.

## Security Notes

- Sessions are httpOnly JWT cookies managed by Supabase Auth; middleware uses `getUser()` (server-verified) rather than trusting cookie contents.
- Admin status lives in `profiles.is_platform_admin` and is checked server-side on every admin route/endpoint — it cannot be toggled from the browser.
- Password recovery is rate-limited and never reveals whether an email is registered.
- Status transitions are validated in the database (e.g. only `approved` accounts can be suspended; only `pending` can be rejected).
