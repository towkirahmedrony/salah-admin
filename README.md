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
| Prayer configuration | List, create/edit form, version history, publish/archive/delete lifecycle, validation and precedence preview. Drafts, review, effective dates and the public read contract are enforced in SQL. See `docs/PRAYER_CONFIGURATION.md`. |
| Metal reference prices | Gold and silver reference rates in BDT per gram: current published rates, provider synchronization, candidate review, manual overrides and synchronization history. Fetching stores candidates; only an administrator's explicit approval publishes. See `docs/METAL_PRICES.md`. |
| Audit history | Schema, triggers, RLS and dashboard summary. **The full log page is not built.** |
| Setup / configuration states | `/setup` reports exactly which step is outstanding |

### Schema, validation and permissions exist; interface not built yet

Opening these sections shows an explicit "not implemented yet" page rather than a
404:

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
| `20260101000800_prayer_config_contract.sql` | Prayer configuration contract: method enum, division/district scopes, per-prayer adjustments, derived angles, immutability and draft-only-delete guards |
| `20260101000900_prayer_config_functions_and_policies.sql` | Atomic publish/archive, precedence resolution, the public read contract, and the split insert/update/delete policies |

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
- **Prayer configuration cannot be published by a direct write.** Its policies are
  split by command rather than declared `for all`, and none of them permits
  `status = 'published'` through `WITH CHECK`. The only way to reach the published
  state is `public.publish_prayer_config()`, which re-checks the capability inside
  the function and archives the incumbent configuration in the same transaction, so
  a scope can never hold zero or two live configurations. A published or archived
  configuration is then immutable: editing one is refused by a trigger, and so is
  deleting anything that is not a draft.
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
- **The Android app does not read published configurations yet.** It has no network
  client in its current phase, so publishing changes nothing on any device. The
  panel implements the publish and read contract and does **not** claim the app is
  using a newly published configuration — there is no acknowledgement channel, so
  there is nothing to claim. The remaining app-side work is listed in
  `docs/PRAYER_CONFIGURATION.md` section 7.3.
- **Locality-level overrides are not implemented.** The app's stored locality
  reference carries a name and a district but no stable identifier, so it could never
  be matched to a `localities` row. Supported scopes are global, division, district
  and thana.
- **The migrations in this repository have not been executed against a live
  PostgreSQL instance.** No database was available in the environment this was
  built in. What *has* been done is a syntax check against the real PostgreSQL
  grammar, including the procedural bodies:

  ```bash
  pip install pglast
  python3 scripts/verify-migrations.py
  ```

  That currently reports `10 files, 246 statements, 44 procedural bodies parsed`
  with no failures, plus one body in `20260101000300` that the parser cannot
  resolve without a catalog (a variable typed with a schema-qualified enum in a
  multi-column `SELECT … INTO`) and names rather than silently skipping.

  Syntax is not behaviour. Apply the migrations to a scratch project and confirm
  that `publish_prayer_config()` archives its predecessor, that a direct write
  cannot set `status = 'published'`, and that `anon` reads only published rows,
  before trusting any of it in production.

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

165 unit tests over the rules where a silent bug is expensive:

- Provider parsing for reference prices: a valid gold and silver document, all four
  purity categories, another commodity, another currency, another unit, a missing price
  list, malformed JSON, a price in scientific notation, invalid and future-dated
  timestamps, zero, negative and non-numeric prices, HTTP errors, timeouts, DNS
  failures, an oversized response, and gold succeeding while silver fails
- That reference prices keep their exact digits from the provider's JSON through to the
  form field, with no floating-point conversion anywhere
- That a manual price is refused when it is zero, negative, over-precise, or has no
  recorded reason, and that the freshness policy requires an acknowledgement before a
  stale candidate can be published
- The prayer calculation method set, checked against the Android engine's own enum,
  together with the angles the engine ships for each method and the rule that Isha is
  either an angle or an interval and never both
- Scope validation: locality is refused because the app cannot resolve one, an
  override cannot be saved without its target, and a target cannot disagree with the
  scope
- Per-prayer adjustments clamped to the engine's own ±60-minute limit
- Publishing blocked by a missing method, source, effective-from date, location
  target, unknown engine, unknown engine version or invalid timezone — and warned
  about, but not blocked, by a configuration whose effective period has already
  ended or has not yet started
- Payload schema version: a newer version is rejected rather than partially applied
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
- The panel stores a calculation **method identity**, never a hand-typed Fajr or
  Isha angle. The engine derives its own angles from the method and has no API for
  an arbitrary one, so the stored angles are a derived mirror of the engine's
  constants, written by a trigger so they cannot disagree with what the app will
  actually compute. Offering an editable angle would have produced a configuration
  that looked right and did nothing.
- Reference prices come from Gold Price Bangladesh, which publishes Bangladesh figures
  from its own saved BAJUS-based records. The panel does not describe that feed as an
  official BAJUS API, and it does not call it a live market rate.
- A provider response is validated field by field, and a price that is missing, zero,
  negative or not a plain decimal is refused rather than stored as zero. Nothing is
  published by fetching: a fetched price is a candidate until an administrator
  approves it, and the panel never marks one verified on its own.
- The provider's `lastUpdate` is when its JSON was built, not when a price changed. It
  is stored and displayed as exactly that, and a rate's effective date is only ever
  filled in by a person who could establish it.
- An administrator's manual reference price is labelled as an administrative reference
  price, not a market quote, and it records who set it and why.
- No market price is hardcoded anywhere, and there is no fallback rate: when nothing
  verified is published, the rate is reported as unavailable and the Android app falls
  back to manual price entry.
- A setting is offered only when the engine reads it. Sunrise and sunset options are
  absent because the provider computes those as raw astronomical events, and
  `locality` scope is absent because the app has no stable identifier for a
  neighbourhood. Scopes are global, division, district and thana.

---

## Bulk import

Not implemented. CSV **export** is provided for every location level, with UTF-8
BOM so Excel renders Bangla correctly.

Import is deferred deliberately: an importer that cannot reliably detect
duplicates and bad coordinates would corrupt a dataset the Android app depends
on. Export first, review off-line, then add import against a real requirement.
