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

The **first account to register becomes the platform administrator automatically** (the signup trigger does this). To promote an existing user instead:

```sql
update public.profiles set is_platform_admin = true where id = '<auth user uuid>';
```

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

- **RLS on every table.** Members read only their teams; pending/suspended/rejected accounts read only their own profile row.
- **No client writes to protected tables.** `audit_logs` and `notifications` have no insert/update/delete policies — writes happen exclusively via triggers and `security definer` RPCs.
- **`admin_action` RPC** performs privileged operations with the admin check *inside* the function (works in both service-role and fallback modes).
- **`update_member_field` RPC** re-validates membership, account status, team status and sheet lock atomically on every cell save — the frontend is a convenience, not the gate.
- **Append-only audit trail.** Field changes record actor, target, team, field, previous value and new value. Reverts restore the value and write a `CHANGE_REVERTED` event; nothing is ever edited or deleted.
- **Account lifecycle**: `pending → approved → suspended/reactivated → archived` (soft delete; history preserved), plus `rejected`. Account approval and team membership are independent.

## Scripts

| Script | Purpose |
| --- | --- |
| `npm run dev` | Start dev server |
| `npm run build` | Production build (must pass strict typecheck) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Vitest unit tests (validation + permission logic) |
| `npm run db:push` | Apply `supabase/migrations/*.sql` via `DATABASE_URL` |

## Deployment (Vercel)

1. Import the repo in Vercel — framework preset **Next.js** (build `npm run build`; output is managed by Next.js, no public/ output dir).
2. Set env vars for Production + Preview: `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY` (recommended).
3. In Supabase → Authentication → URL Configuration, add your Vercel domain(s) as Site URL / Redirect URLs (used by password-reset links).
4. Deploy. `middleware.ts` runs on the Node.js runtime so `@supabase/ssr` cookie handling works on Vercel.

## Testing Performed

- `npm run typecheck` — strict, zero errors
- `npm test` — 19 unit tests (validation schemas, permission matrix mirroring the DB RPC rules)
- `npm run build` — production build passes, 25 routes
- Workflow checks: register → pending gate → approve → team assignment → sheet editing → audit trail → revert → lock → suspend

## Security Notes

- Sessions are httpOnly JWT cookies managed by Supabase Auth; middleware uses `getUser()` (server-verified) rather than trusting cookie contents.
- Admin status lives in `profiles.is_platform_admin` and is checked server-side on every admin route/endpoint — it cannot be toggled from the browser.
- Password recovery is rate-limited and never reveals whether an email is registered.
- Status transitions are validated in the database (e.g. only `approved` accounts can be suspended; only `pending` can be rejected).
