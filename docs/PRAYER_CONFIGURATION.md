# Prayer Calculation Configuration

How the panel manages prayer-calculation parameters, what it may and may not claim,
and exactly what the Android app must implement to consume them.

Read `PRAYER_CALCULATION.md` in the `towkirahmedrony/prayer` repository alongside this
document. That file describes the engine; this one describes the published contract
for it.

---

## 1. Scope of this feature

The panel **does not compute prayer times**, and it never will. The Android app ships
a local, offline engine (Adhan Kotlin, `com.batoulapps.adhan:adhan2`, pinned `0.0.5`)
and that engine remains the single source of truth for the astronomy.

This feature publishes the *parameters* that engine consumes, so a correction can
ship as data instead of as a new APK.

Explicitly **not** part of this feature, and not reachable from its pages:

- Verified daily timetables (`verified_prayer_timings`)
- Ramadan calendars (`ramadan_calendar_versions` / `_days`)
- Announcements (`announcements`)
- App-wide visual preferences (`app_configs`, `timeFormat`)
- Per-user notification settings

Those are separate tables with separate pages and separate capabilities.

---

## 2. What the engine actually supports

Derived by reading
`core/model/PrayerCalculationMethod.kt`, `core/model/PrayerCalculationProfile.kt`,
`core/model/PrayerSettings.kt` and `data/prayer/AdhanPrayerTimesProvider.kt`.
Nothing below is inferred from other prayer-time applications.

| Concept | Engine reality | Consequence for this panel |
|---|---|---|
| Calculation method | A closed enum of 11 methods. The app passes the method **identity**; the engine owns the angles. | The panel stores a method **identity**, never a free-form angle. |
| Fajr / Isha angle | Derived from the method inside the engine. | Stored as a **read-only derived mirror** for auditability (see §4). |
| Isha | Either an angle **or** a fixed interval after Maghrib, per method, never both. | Enforced by a `CHECK` constraint and a form-level either/or. |
| Asr madhhab | `STANDARD` (→ Shafi) or `HANAFI`. | Two options, stored as `asr_madhhab`. |
| High-latitude rule | `AUTOMATIC` \| `MIDDLE_OF_THE_NIGHT` \| `SEVENTH_OF_THE_NIGHT` \| `TWILIGHT_ANGLE`. **There is no "off"/"none":** `AUTOMATIC` maps to `null`, and the engine then applies the rule it recommends for the latitude. | Four options; `automatic` is the default. |
| Manual adjustments | Per-prayer minutes for the five obligatory prayers, clamped to **±60** (`PrayerSettings.MAX_ADJUSTMENT_MINUTES`). Sunrise/sunset are solar events and carry **no** adjustment. | Five nullable-free integer columns, `CHECK (between -60 and 60)`. |
| Sunrise / sunset options | Not configurable. The provider makes a second engine call with every adjustment zeroed, on purpose, so a method offset can never move the reported sunset. | **Not exposed.** There is no setting for this. |
| Maghrib adjustment | Supported, as one of the five per-prayer adjustments. | Exposed as `adjust_maghrib`. |
| Timezone | The location's IANA zone is used for every emitted time. | Validated as a real IANA identifier via `Intl`. |

Anything not in that table is not a setting in this feature. A field that the engine
cannot read would be a lie in a configuration screen.

---

## 3. Location scope and precedence

### 3.1 What the app can resolve

The app stores a `LocationInfo` carrying an optional `area: BangladeshAreaRef`, which
holds `divisionId`, `districtId` and an optional `upazilaId`. Those ids are the
**OCHA p-codes** from the bundled dataset (`bd_areas.tsv`), and the panel's
`divisions.code` / `districts.code` / `thanas.code` columns use the same p-codes.

`code` is therefore the shared join key between the two repositories, which is why the
public read contract ships it as `scope_code` and not only as a panel UUID.

### 3.2 Supported scopes

| Scope | Resolvable by the app? | Why |
|---|---|---|
| `global` | Yes | Always applicable. |
| `division` | Yes | `area.divisionId` is persisted for any area-resolved or GPS-resolved location. |
| `district` | Yes | `area.districtId` is persisted, including for GPS fixes resolved only to district level. |
| `thana` | Yes | `area.upazilaId`, present when the user selected an upazila. |
| `locality` | **No — deliberately not implemented.** | The app's `BangladeshLocalityRef` carries only `name`, `districtId` and `kind` — there is no stable id, because the source is an OpenStreetMap neighbourhood layer (ODbL) with no p-code. The app cannot deterministically map its stored locality to one of this panel's `localities.id` rows. Publishing a locality override would produce a configuration that silently never applies. |

`public.prayer_config_scope` therefore contains exactly
`global`, `division`, `district`, `thana`.

Adding `locality` later requires an Android-side change (a stable locality key in the
bundled dataset), not a panel-side one. Until then the panel refuses to store it.

### 3.3 Precedence

Most specific wins:

```
thana  >  district  >  division  >  global
```

Deterministic rules:

1. A configuration applies only when `status = 'published'` **and** the target date falls
   inside `[effective_from, effective_to]` (`effective_to` inclusive; `null` means open-ended).
2. Within one scope level, at most **one** published row may exist per target — enforced by
   partial unique indexes, not by convention.
3. When no published row matches at any level, there is **no** applicable configuration and
   the app must keep its last known valid configuration (or its built-in default). The panel
   never invents a fallback row.
4. A published row is immutable. Changing a published configuration creates a new draft,
   which on publish archives its predecessor.

An administrator can see the winner for a specific location and date on the configuration
detail page ("Effective configuration"), computed by `public.resolve_prayer_config()`,
which implements exactly the precedence above.

---

## 4. Schema

Table: `public.prayer_calculation_configs` (migration
`20260101000200_prayer_content_tables.sql`, extended by
`20260101000800_prayer_config_contract.sql`).

### Identity

| Column | Type | Notes |
|---|---|---|
| `id` | uuid | Primary key. |
| `name` | text | Not blank. |
| `schema_version` | integer | Default `1`. Payload contract version (§7). |
| `version` | integer | Panel-side revision counter, `>= 1`. |

### Engine

| Column | Type | Notes |
|---|---|---|
| `engine_key` | text | Currently only `adhan_kotlin`. |
| `engine_version` | text | Only versions the app actually ships (`0.0.5`). |
| `calculation_method` | `prayer_calculation_method` | Nullable while drafting; required to publish. |

### Location scope

| Column | Type | Notes |
|---|---|---|
| `scope` | `prayer_config_scope` | `global` \| `division` \| `district` \| `thana`. |
| `division_id` | uuid → `divisions(id)` | Set only when `scope = 'division'`. |
| `district_id` | uuid → `districts(id)` | Set only when `scope = 'district'`. |
| `thana_id` | uuid → `thanas(id)` | Set only when `scope = 'thana'`. |

`pcc_scope_target_agrees` enforces "exactly the matching target column is set".

### Calculation parameters

| Column | Type | Default | Notes |
|---|---|---|---|
| `fajr_angle` | numeric(5,2) | derived | **Derived** from `calculation_method` by trigger. |
| `isha_angle` | numeric(5,2) | derived | Mutually exclusive with `isha_interval_minutes`. |
| `isha_interval_minutes` | integer | derived | |
| `asr_madhhab` | `asr_madhhab` | `hanafi` | `shafi` \| `hanafi`. |
| `high_latitude_rule` | `high_latitude_rule` | `automatic` | |
| `adjust_fajr` … `adjust_isha` | integer | `0` | `CHECK (between -60 and 60)`, one per prayer. |
| `timezone` | text | `Asia/Dhaka` | Validated as a real IANA zone. |

`fajr_angle` and `isha_angle` are **derived, not entered**. A `BEFORE INSERT OR UPDATE`
trigger computes them from the selected method on every write, so the stored angles can
never disagree with what the engine will actually do — not even for a write made directly
in the SQL editor. They exist so the effective angles are auditable without reading Kotlin
source. The panel's form shows them read-only.

### Effective period, provenance, lifecycle

`effective_from` (required to publish), `effective_to` (optional), `source_name`
(required to publish), `source_url`, `notes` (internal — never exposed publicly),
`status` (`draft` \| `published` \| `archived`), `reviewed_by`/`reviewed_at`,
`published_by`/`published_at`, `created_by`/`updated_by`/`created_at`/`updated_at`.

### Invariants enforced in PostgreSQL

- `pcc_published_is_complete` — a published row has a method, a known engine, a source and an
  effective-from date.
- `pcc_published_needs_reviewer` — a published row has a reviewer and a review timestamp.
- `pcc_isha_exclusive` — Isha is an angle **or** an interval, never both.
- `pcc_effective_range` — `effective_to >= effective_from`.
- `pcc_scope_target_agrees` — the target column matches the scope.
- `pcc_adjustments_within_engine_limit` — every adjustment is within ±60.
- `pcc_schema_version_sane` — `1 <= schema_version <= 1000`.
- `pcc_one_published_global` / `_per_division` / `_per_district` / `_per_thana` — at most one
  published row per target.
- `guard_pcc_immutable` (trigger) — a published row's content cannot be edited. Only a
  status transition to `archived` is permitted.
- `guard_pcc_delete` (trigger) — only drafts may be deleted.

---

## 5. Workflow

States are the project-wide `record_status`: **draft → published → archived**.

```
                ┌──────────── publish_prayer_config() ─────────────┐
                │  authorization + completeness + atomic archive    │
                ▼                                                   │
   draft ───────────────────────────────────────────────────────► published
     │                                                               │
     │ edit freely                                                   │ archive
     │ delete allowed                                                ▼
     └──────────────────────────────────────────────────────────► archived
```

### Why there is no separate "In review" or "Approved" state

The panel's role model has a single `prayer_data_reviewer` role that both prepares and
publishes. A distinct approval stage would therefore be enforced by the same role that
could bypass it, which is not a control — it would only make the workflow look stricter
than it is.

What **is** enforced, and is real:

- `pcc_published_needs_reviewer` makes a published row without a reviewer impossible.
- `stamp_publish_metadata()` writes `reviewed_by` / `reviewed_at` / `published_by` /
  `published_at` from the **JWT**, so a client cannot choose who is credited.
- A published configuration is immutable, so history cannot be rewritten.
- Publishing requires the `manage_prayer_config` capability in the UI, in the server action,
  and in RLS — the third is the boundary.

### Publish is atomic

Publishing changes two rows at once (archive the predecessor, publish the successor). A
partial application would leave a scope with either zero or two published configurations,
so it is a single `SECURITY DEFINER` function, `public.publish_prayer_config(uuid)`, which:

1. Re-checks `public.can_admin('prayer_config')` **inside** the function and raises
   `42501` otherwise.
2. Locks the target row `FOR UPDATE` (concurrent publishes cannot interleave).
3. Validates completeness and rejects `archived` rows.
4. Archives the currently published sibling for the same scope target.
5. Flips the target to `published`; the existing `BEFORE UPDATE` triggers stamp the
   reviewer and publisher from the JWT and write the audit row.

`ARCHIVE` has the same shape (`public.archive_prayer_config(uuid)`).

### Direct writes cannot publish

The RLS policies on `prayer_calculation_configs` are split rather than `for all`:

| Policy | Command | Condition |
|---|---|---|
| `pcc_select` | select | `is_active_admin()` |
| `pcc_insert` | insert | `can_admin('prayer_config')` **and** `status = 'draft'` |
| `pcc_update` | update | `can_admin('prayer_config')` and the new row's status is `draft` or `archived` |
| `pcc_delete` | delete | `can_admin('prayer_config')` **and** `status = 'draft'` |

Because `WITH CHECK` rejects `status = 'published'`, no PostgREST write can mint a
published configuration. The publish function runs as the table owner, so the row's RLS is
bypassed for it and only for it.

---

## 6. Audit trail

The table carries the project-wide `set_audit_columns` and `audit_row_change` triggers, so
every create, update, status change, publish and archive already lands in `audit_logs` with
actor id, email, role, old/new row images, timestamp and `x-request-id`.

`publish` / `archive` / `unpublish` are distinguished from a generic `update` by
`audit_row_change()`, which derives the action from the status transition. No separate audit
path was added: a second one would be a second thing that can disagree.

---

## 7. Android integration contract

**Status: the read side is implemented and published. The Android side does not exist yet.**

The Android app has **no network client at all** in its current phase. Its prayer
calculation is fully offline and nothing in it fetches configuration. Therefore:

- The panel does **not** claim the app is using a newly published configuration. There is no
  acknowledgement channel, so there is nothing to claim. The detail page says so explicitly.
- The panel implements the publish + read contract now, so the Android work in §7.3 is the
  only remaining step.
- No location or device identifier is collected by this feature. The public read returns the
  full published set — a handful of rows — and the app filters locally, so publishing needs
  no knowledge of any user.

### 7.1 Public read endpoint

`public_prayer_configs()` — `SECURITY DEFINER`, `STABLE`, granted to `anon` and
`authenticated`, revoked from `public`.

Returns only `status = 'published'` rows whose effective period has not already ended, and
only these columns:

| Field | Type | Meaning |
|---|---|---|
| `id` | uuid | Configuration id. |
| `name` | text | Human label, for diagnostics. |
| `scope` | enum | `global` \| `division` \| `district` \| `thana`. |
| `scope_code` | text | The p-code the app knows (`BD30`, `BD2015`, `BD20153012`). `BD` for global. |
| `schema_version` | integer | Payload contract version — see §7.4. |
| `engine_key` | text | `adhan_kotlin`. |
| `engine_version` | text | `0.0.5`. |
| `calculation_method` | enum | Must map to a method in the app's own enum. |
| `fajr_angle`, `isha_angle`, `isha_interval_minutes` | numeric / integer | Derivable from the method; supplied for verification. |
| `asr_madhhab` | enum | `shafi` \| `hanafi`. |
| `high_latitude_rule` | enum | `automatic` \| `middle_of_the_night` \| `seventh_of_the_night` \| `twilight_angle`. |
| `adjust_fajr` … `adjust_isha` | integer | Minutes, `-60` … `60`. |
| `timezone` | text | IANA identifier. |
| `effective_from`, `effective_to` | date | `effective_to` inclusive; `null` is open-ended. |
| `version`, `published_at` | integer / timestamptz | For staleness handling and diagnostics. |
| `source_name`, `source_url` | text | Provenance, for display. |

**Not exposed:** `notes` (internal review notes), `created_by`, `updated_by`, `created_at`,
`updated_at`, `reviewed_by`, `reviewed_at`, and every draft or archived row.

### 7.2 Precedence the app must implement

Given a stored `LocationInfo` on date `D`:

1. If `area?.upazilaId` is present, look for `scope = 'thana'` and
   `scope_code = area.upazilaId`.
2. Else if `area?.districtId` is present, look for `scope = 'district'` and
   `scope_code = area.districtId`.
3. Else if `area?.divisionId` is present, look for `scope = 'division'` and
   `scope_code = area.divisionId`.
4. Else the `scope = 'global'` row.

Take the first match whose effective period contains `D`. Because the panel guarantees at
most one published row per target, "first match" is unambiguous.

### 7.3 Android work still required

1. A network client and a fetch of `public_prayer_configs()` (anon key; no account).
2. Mapping `calculation_method` → `PrayerCalculationMethod`, rejecting unknown members.
3. `asr_madhhab` → `AsrCalculationMethod`, `high_latitude_rule` → `HighLatitudeRule`
   (with `automatic` → `PrayerSettings` default, i.e. the engine's `null` rule).
4. `adjust_*` → `PrayerSettings.withAdjustment(...)`, already clamped to ±60 on both sides.
5. Precedence per §7.2, keyed on the p-code in `area`.
6. Persisting the last known good configuration in DataStore **as a unit**, so a failed or
   malformed sync cannot half-apply. On any failure the app keeps the previous one.
7. An acknowledgement, if the panel is ever to report "the app is using this". Until such a
   channel exists the panel claims nothing.

### 7.4 Version and compatibility rules the app must apply

The app must **reject** rather than partially apply a payload when:

- `schema_version` is greater than the highest version the app understands.
- `engine_key` is not `adhan_kotlin`, or `engine_version` is not one the app ships.
- `calculation_method`, `asr_madhhab` or `high_latitude_rule` is not a member of its enum.
- An `adjust_*` value is outside ±60, or `effective_from` / `effective_to` are malformed.
- `timezone` is not a real IANA zone.

A rejected payload is never a reason to fall back to a *different* configuration's values; the
app keeps its last known valid configuration. A configuration payload is **never** executable
code and must never be treated as trusted merely because it came from the panel's database.

---

## 8. Preview on the detail page

The detail page shows, for one configuration:

- **Effective parameters** — every value the engine will receive, with units.
- **Applicability** — the scope, its resolved location name and p-code, and the date range.
- **Validation** — errors (block publishing) and warnings (informational), from
  `reviewPrayerConfigForPublish()`.
- **Comparison with the published version** — a field-by-field diff of what changes, so a
  reviewer sees the delta rather than re-reading a form.
- **Engine compatibility** — whether `engine_key`/`engine_version` are ones the app ships.
- **Effective configuration for a location and date** — which row wins under §3.3.

No prayer-time preview is offered. Computing times server-side would be a second
implementation of the astronomy that could silently disagree with the app, and the task
rules are explicit that a disagreeing second engine is worse than none. The panel validates
configuration; it does not predict times.

---

## 9. Known limitations

1. **No Android sync mechanism exists.** See §7. The panel publishes and serves; nothing
   consumes it yet, and the UI says so rather than implying success.
2. **`locality` scope is not implemented.** See §3.2 — the app has no stable locality key.
3. **No religious verification.** Publishing records an *administrative* review. The panel
   does not claim that any method reproduces the timetable of Islamic Foundation Bangladesh
   or any other authority, because no such comparison has been performed. The wording on the
   publish screen says exactly that.
4. **`version` is a panel-side counter, not a content hash.** Two configurations can share a
   number across different scope targets; uniqueness is per target, matching the partial
   unique indexes.
5. **The migrations have not been executed against a live PostgreSQL instance.** No database
   was available in the environment this was built in. They are written to be idempotent and
   were reviewed statement by statement, but "reviewed" is not "ran" — see the README.
