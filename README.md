# Salah Admin

Web administration panel for **Salah**, the Bangladesh-focused Islamic companion
Android application ([`towkirahmedrony/prayer`](https://github.com/towkirahmedrony/prayer)).

The panel and the app are separate projects. The panel manages the location
dataset, prayer calculation parameters, verified timetables, Ramadan calendars,
app configuration, announcements, feedback and administrative access.

---

## Status of this version

Read this before assuming a section works. The panel was built against an empty
repository, so the schema, permissions and validation are complete while some
management pages are not.

### Fully implemented, connected to the database

| Area | Notes |
|---|---|
| Administrator sign-in | Supabase Auth, cookie session, active `admin_users` row required |
| Protected routes | Middleware + `requireAdmin()` on every page, capability checks on every action |
| Dashboard | Real counts, real recent activity; a missing table reports as a failure, never as `0` |
| Divisions | List, search, filter, create, edit, activate/deactivate, delete, CSV export |
| Districts | Same, plus parent (division) filtering |
| Thanas / Upazilas | Same, plus coordinates and cascading division → district selects |
| Localities | Same, plus verification status, provenance and explicit parent handling |
| Audit history | Schema, triggers, RLS and dashboard summary. **The full log page is not built.** |
| Setup / configuration states | `/setup` reports exactly which step is outstanding |

### Schema, validation and permissions exist; interface not built yet

Opening these sections shows an explicit "not implemented yet" page rather than a
404:

- Prayer configuration (`prayer_calculation_configs`)
- Verified timetables (`verified_prayer_timings`)
- Ramadan calendar (`ramadan_calendar_versions`, `ramadan_calendar_days`)
- App configuration (`app_configs`)
- Announcements (`announcements`)
- Feedback & bug reports (`feedback_reports`)
- Audit log browser, admin profile, administrator account management

Each one has its table, constraints, RLS policies, Zod validation and
pre-publication review rules in place. What is missing is the list/detail/form
pages and their server actions.

---

## Stack

Chosen because the repository was empty and this is the combination with the
fewest moving parts for a server-authoritative admin panel.

- **Next.js 15** (App Router) with **TypeScript** in strict mode
- **React 19**
- **Tailwind CSS 3.4** with a custom deep-emerald token set
- **Supabase**: PostgreSQL, Auth, and `@supabase/ssr` for cookie sessions
- **Zod** for all input validation
- **Vitest** for unit tests

Deliberately absent: any UI kit, form library, state manager or chart library.
The panel needs very little of what those provide, and each one is another thing
that can disagree with the database.

---

## Configuration

Copy `.env.example` to `.env.local` and fill in two values:

```
NEXT_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=your-publishable-or-anon-key
```

Both are **public** values. They are safe in the browser because security comes
from row level security, not from the key.

There is **no service-role key anywhere in this codebase**, and there must never
be one. Anything prefixed `NEXT_PUBLIC_` is inlined into the browser bundle.
Creating Supabase Auth users therefore stays a manual dashboard step, which is
intentional: it keeps the panel unable to mint administrators on its own.

Missing variables do not crash the app. Each entry point renders a configuration
screen naming exactly which variable is absent.

---

## Database setup

Migrations are timestamped and **idempotent** — every statement is
`if not exists` / `create or replace` / guard-blocked, so re-running brings a
partially applied or hand-edited database back in line without dropping anything.

Apply them in filename order, via the Supabase CLI:

```bash
supabase link --project-ref <your-project-ref>
supabase db push
```

Or by pasting each file in `supabase/migrations/` into the Supabase SQL editor in
order.

| File | Contents |
|---|---|
| `20260101000000_extensions_and_types.sql` | Extensions, enumerated types |
| `20260101000100_core_tables.sql` | `admin_users`, `audit_logs`, geography tables |
| `20260101000200_prayer_content_tables.sql` | Prayer, Ramadan, app config, announcements, feedback |
| `20260101000300_functions_and_triggers.sql` | Authorization helpers, audit triggers, stamping |
| `20260101000400_rls_policies.sql` | Row level security — the authoritative permission matrix |
| `20260101000500_publish_review_guards.sql` | Publish/review constraints, lockout protection |
| `20260101000600_public_endpoints.sql` | Anonymous feedback intake, public read contracts |
| `20260101000700_admin_bootstrap.sql` | First-admin promotion, in-panel provisioning |

### Reference data (optional)

`supabase/seed.sql` holds the official Bangladesh administrative dataset —
**8 divisions, 64 districts, 507 upazilas** — with coordinates and Bangla names
copied verbatim from the source.

```
Source: COD-AB BGD v03 (valid_on 2023-05-21), OCHA / HDX COD-AB,
        licensed CC BY 3.0 IGO.
        Bangla names joined from nuhil/bangladesh-geocode (MIT).
```

Regenerate it, rather than editing it by hand:

```bash
node scripts/generate-reference-locations.mjs <path-to-bd_areas.tsv>
```

Apply it with `psql -f supabase/seed.sql`, or by letting `supabase db reset`
pick it up locally. It is **not** applied to a production project automatically.

### First administrator

There is no registration page. To create the first administrator:

1. Add the user under **Authentication → Users** in the Supabase dashboard.
2. In the SQL editor:

```sql
select public.bootstrap_first_admin('you@example.com', 'Your Name');
```

That function refuses to run once any administrator exists, and it is not
reachable from the browser (`execute` is revoked from `anon` and
`authenticated`). Every later administrator is promoted from the panel, which is
an RLS-checked write.

---

## Security model

The design assumption is that **the browser is hostile**.

- **Two independent layers.** The UI hides what a role cannot do; the server
  re-checks the capability on every action; and RLS decides in PostgreSQL. The
  first two are conveniences — the third is the boundary.
- **Authorization reads `public.admin_users` only.** Never `raw_user_meta_data`
  or any field a signed-in user can edit about themselves. A session proves
  identity; an active roster row grants capability.
- **Audit rows are written by `SECURITY DEFINER` triggers**, which read the actor
  from the JWT. A client cannot forge or suppress an entry, and `authenticated`
  holds `SELECT` but not `INSERT`/`UPDATE`/`DELETE` on `audit_logs`.
- **`anon` holds no table privileges at all.** Anonymous access is possible only
  through validated `SECURITY DEFINER` functions:
  - `submit_feedback(...)` — fixes status, assignment and reply itself; strips
    credential-looking diagnostic keys on the way in; idempotent per
    `client_reference`.
  - `public_app_configs()`, `public_announcements()` — published-and-public only,
    with no `description` or internal columns exposed.
- **Publishing always records who and when.** A `BEFORE UPDATE` trigger stamps
  publisher and reviewer identity, and `CHECK` constraints make a published
  record without a reviewer impossible.
- **`app_configs` cannot hold secrets.** A key matching
  `secret|token|password|credential|api_key|…` is rejected by a `CHECK`
  constraint, not merely discouraged in the UI.
- **Lockout protection.** An administrator cannot deactivate or demote
  themselves, and the last active super admin cannot be removed.

### Known limitations

- **No rate limiting on `submit_feedback`.** Add it at the edge before exposing
  the endpoint publicly. The database validates shape and size, not frequency.
- **Audit `old_data`/`new_data` contain full row images.** RLS restricts
  `audit_logs` to super admins, but a value that should never persist anywhere
  will appear here if it reaches a managed table.
- **`request_id` depends on PostgREST's `request.headers` setting.** Where it is
  unavailable the column is `null`; the audit row is still written.

---

## Development

```bash
npm install
npm run dev          # http://localhost:3000
```

| Script | Purpose |
|---|---|
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit`, strict |
| `npm run test` | Vitest unit tests |
| `npm run build` | Production build |
| `npm run check` | typecheck + lint + test |

The build succeeds **without any database configuration** — no page reaches out
to Supabase at build time, and an unconfigured build is the case that must keep
working.

### What the tests cover

32 unit tests over the rules where a silent bug is expensive:

- Timetable chronology, including that unusual-but-possible sources produce
  warnings rather than false rejections
- Ramadan validation: 29/30-day length, gaps, duplicates, time order, and that
  unverified days warn instead of blocking
- App version comparison (`1.10.0` > `1.9.0`) and range matching
- Known app-configuration shapes, and that an unknown key is reported as
  *unvalidated* rather than valid
- CSV escaping and spreadsheet formula-injection neutralisation
- Diagnostic redaction
- The permission matrix, including that hiding a nav item matches the matrix
- Database error mapping, including that raw SQL never reaches the user

Tests cover pure logic only. **There are no integration tests against a live
database**, because no Supabase project was available. Database behaviour is
enforced by constraints and RLS in SQL and has not been exercised end to end.

---

## Data-source policy

The panel never invents data.

- Coordinates come from the source file verbatim. A location with no coordinate
  stores `null`, and the list says "Not recorded" rather than showing a guess.
- Nothing is marked `verified` automatically. Marking verified requires naming a
  source, enforced by both the form and a `CHECK` constraint.
- Publishing records an **administrative review**, not a religious
  verification, and the interface says so.
- `localities.thana_id` is nullable because the OpenStreetMap neighbourhood
  source resolves only to a district. Inventing a thana for those rows would
  fabricate an administrative claim the source never made.
- Imsak and Sehri-end are separate columns, because published calendars print
  both and collapsing them would change the data.
- The panel does **not** compute prayer times. The Android app has its own
  offline Adhan engine; the panel publishes parameters it already understands,
  and refuses to publish for an engine version the app does not ship.

---

## Bulk import

Not implemented. CSV **export** is provided for every location level, with UTF-8
BOM so Excel renders Bangla correctly.

Import is deferred deliberately: an importer that cannot reliably detect
duplicates and bad coordinates would corrupt a dataset the Android app depends
on. Export first, review off-line, then add import against a real requirement.
