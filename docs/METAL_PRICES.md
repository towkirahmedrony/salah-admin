# Gold and silver reference prices

Bangladesh gold and silver reference prices, in **BDT per gram**, as the Salah
Android app's Zakat calculator reads them.

This document covers where the prices come from, what the panel does with them
before anyone sees a number, the database objects involved, and how to deploy and
troubleshoot the feature. It deliberately does not claim anything about the market
that the data cannot support — see [What these prices are not](#what-these-prices-are-not).

---

## 1. The three states of a price

The whole design turns on keeping these apart. Collapsing any two of them is how a
price nobody checked ends up in front of a user.

| State | What it means | Where it lives |
|---|---|---|
| **Fetched candidate** | A figure the provider published, validated, and stored. Nobody has approved it. | `metal_prices` row with `verification_status = 'pending'`, `is_active = false` |
| **Verified** | An administrator has reviewed the source and the timestamps and approved it. | `verification_status = 'verified'` |
| **Published** | The rate the Android app reads right now. | additionally `is_active = true` |

A fetched price is never published by fetching. `publish_metal_price_rate()` is the
only path from candidate to live, it is called only from an authenticated
administrator's action, and it refuses a rejected candidate, a non-positive price,
a timestamp that cannot be trusted, and anything that would displace a manual
override.

Two further states are computed rather than stored: **stale** (the record is older
than the freshness policy) and **rejected** (an administrator refused it). Staleness
is computed from the timestamp and the policy, because a rate can move in and out of
it without anyone touching the row.

---

## 2. The provider

| | |
|---|---|
| Gold | `https://gold-price.bd/api/gold/latest.json` |
| Silver | `https://gold-price.bd/api/silver/latest.json` |
| Documentation | <https://gold-price.bd/api> |
| Prices attributed to | <https://www.bajus.org/gold-price> |

The endpoints are public JSON documents. They need no account and no key, which is
why this feature adds **no secret** to the deployment.

### Response format

```json
{
  "commodity": "gold",
  "currency": "BDT",
  "unit": "gram",
  "bhoriInGrams": 11.664,
  "source": "https://www.bajus.org/gold-price",
  "lastUpdate": "2026-10-12T17:26:22+06:00",
  "latest": { "k18": 16265, "k21": 18940, "k22": 19830, "traditional": 13285 }
}
```

The silver document has the same shape with `"commodity": "silver"`. The figures
shown above are illustrative of the structure only.

**`bhoriInGrams` is ignored.** The panel and the app work in grams, and the provider's
bhori figure is not used to derive a per-gram price — a derived price would be a
number this panel invented.

### What is validated, and what is refused

Per document:

- `commodity` must name the metal that was asked for. A response for silver is never
  stored as gold.
- `currency` must be `BDT`. There is no conversion policy, so another currency is
  refused rather than relabelled.
- `unit` must be `gram`.
- `latest` must be an object.
- `lastUpdate`, when present, must be readable and not further into the future than
  the tolerated clock skew.

Per price (each of `k18`, `k21`, `k22`, `traditional` independently):

- missing, `null`, non-numeric, zero, negative, or not a plain decimal ⇒ **refused**,
  and the refusal is reported with the category name. A refused price is never
  stored as zero, and never replaces anything.
- If every category is refused, the document is treated as unusable and the metal's
  fetch fails.

Operational limits: **8 s** timeout, **64 kB** response ceiling, `GET` only, and a
redirect is refused rather than followed.

### Timestamp semantics

Four timestamps are stored for one rate, and they mean different things:

| Column | Meaning | Who sets it |
|---|---|---|
| `provider_last_update` | When the provider's **JSON document was built**. Not when a price changed. | the provider |
| `fetched_at` | When this panel received the document. | the sync |
| `effective_at` | When the rate **became effective**. | an administrator, only when they can establish it |
| `updated_at` | The last write to the record. | the database |

The provider's own documentation says its data is generated on deploy and that
prices may be unchanged between builds. So `provider_last_update` is stored and
displayed as a build time, and it is **never** used as an effective date. A recorded
candidate therefore leaves `effective_at` NULL and waits for a person.

---

## 3. Freshness policy

| Threshold | Default | Meaning |
|---|---|---|
| `max_candidate_age_hours` | 72 | A candidate whose build time is older than this needs an explicit acknowledgement before it can be published. |
| `max_published_age_hours` | 96 | A published rate older than this is flagged for review. It stays published. |
| `max_future_skew_minutes` | 180 | A timestamp this far into the future is treated as broken, and publication is refused. |

The policy lives in the **database** (`public.metal_price_freshness_policy()`), not in
the app, so the panel cannot disagree with the guard that enforces it. Change it per
database:

```sql
alter database postgres set salah.metal_price_max_candidate_age_hours = '48';
```

or edit the defaults in `20260101001100_metal_price_functions_and_policies.sql`. A
malformed setting raises a clear error rather than being ignored.

**What staleness does and does not mean.** Because the provider's timestamp is a build
time, an old one does not prove the price is out of date — so a stale candidate is
*flagged and requires an acknowledgement*, not discarded. A timestamp in the future is
different in kind: it means a broken clock or a broken feed, and no amount of review
can make it trustworthy, so it is refused outright.

---

## 4. Workflow

```
fetch (server action, admin only)
  │  validate the document and every category
  ▼
record_metal_price_candidate()      → pending candidate, no effective date
  │
  │  administrator opens the source, reads the timestamps
  ├──────────────► reject_metal_price_candidate()   rejected, reason recorded
  │
  ▼
publish_metal_price_rate()          → verified + active, incumbent deactivated in
  │                                   the same transaction
  ▼
Android reads it via /rest/v1/metal_prices?is_active=eq.true
```

A repeat fetch **replaces** the unpublished candidate for the same metal/purity/currency
rather than adding a second one, so the review queue holds at most one candidate per
rate. A **rejected** candidate is left alone: rejection is a decision, and the next
fetch produces a fresh candidate instead of reopening it.

Publishing is a swap, not a gap: the incumbent is deactivated and the replacement
activated inside one transaction.

### Manual overrides

An override is an administrator's own reference price, entered when the provider's
figures cannot be used. It is:

- stored as verified, because an administrator entering it **is** the verification,
  with their identity, the reason (required) and an optional effective date recorded;
- activated for **exactly one** metal and purity, deactivating whatever was live for
  that one rate and touching nothing else;
- never replaced by synchronization, which records candidates for comparison and
  leaves the override alone;
- displayed as live wherever the rate appears.

Deactivating an override is an explicit action, and **nothing is promoted on the way
past**. Without a replacement the administrator explicitly chooses, the rate becomes
unpublished — the app falls back to manual entry for it. A pending or rejected
candidate is never activated by deactivation. A previously verified rate can be
restored, but only by naming it, and restoring one that has aged past the policy needs
the same acknowledgement publishing does.

An active override's price, source, reason and effective date cannot be edited in
place, by design: the guard trigger refuses it. Correcting an override means
deactivating it and recording a new one, so both decisions stay in the history.

---

## 5. Database

### Migrations

| File | Creates |
|---|---|
| `20260101001000_metal_price_tables.sql` | `metal_prices`, `metal_price_sync_logs`, constraints, indexes, history triggers |
| `20260101001100_metal_price_functions_and_policies.sql` | the `metal_prices` capability, the freshness policy function, the row guard, the five workflow functions, RLS policies and grants |

Apply them with the project's usual workflow (`supabase db push`, or the SQL editor in
order). Both are idempotent and statement-safe to re-run.

### `metal_prices`

Rate records, holding both the published rate and the candidates. `metal_type`,
`purity`, `currency` and `verification_status` are `text` with `CHECK` constraints
rather than enums: the Android client parses these as literal strings, and adding a
purity category later must not need an enum alteration that cannot run inside the
migration transaction.

Money is `numeric(12,2)`. The constraints that matter:

- `price_per_gram > 0` — a missing price is not a zero price.
- `metal_type in ('gold','silver')`, `purity in ('K22','K21','K18','TRADITIONAL')`,
  `currency = 'BDT'`.
- `verification_status in ('pending','verified','rejected')`.
- `not is_active or verification_status = 'verified'` — only a verified rate may be live.
- `not override_active or (is_active and verification_status = 'verified')` — an
  override is a live, verified rate.
- **Partial unique index** on `(metal_type, purity, currency) where is_active` — at
  most one published rate per rate, enforced by the database whatever the application
  does or two administrators do at the same moment.
- **Partial unique index** on the same columns `where not is_active and
  verification_status = 'pending'` — at most one candidate waiting per rate.

### `metal_price_sync_logs`

One row per attempt: `provider`, `status`, `started_at`, `completed_at`,
`gold_updated`/`silver_updated`, per-metal status, counts of candidates, pending and
refused, how many overrides were preserved, and a concise error message. Constraints
require a completion time exactly when a run is finished, and a reason when a run
failed.

Logs contain no user financial inputs, no credentials, no request headers and no raw
provider payloads. A run abandoned by a dead request is marked failed when the next
run starts, rather than showing as running for ever.

### Audit

Both tables have the project's append/post-update audit trigger, so every write is in
`audit_logs` with its old and new row image and the administrator who made it.
Superseded rates are additionally never removed — publishing deactivates the previous
row rather than overwriting it — and a live row cannot be deleted or have its price
rewritten in place.

---

## 6. Public read contract, RLS and grants

The Android client reads a relation, not a function:

```
GET {url}/rest/v1/metal_prices?is_active=eq.true
    &select=metal_type,purity,price_per_gram,currency,source,source_url,
            override_active,is_active,verification_status,effective_at,
            provider_last_update,fetched_at,updated_at
```

Three independent mechanisms restrict that, because one alone is a single point of
failure:

1. **Row level security** on `metal_prices`. The `anon` policy is
   `using (is_active and verification_status = 'verified')`. Unpublished candidates,
   rejected rows and their review notes are invisible, not merely unlisted.
2. **Column grants.** `anon` is granted `select` on exactly the columns above.
   `updated_by`, `created_by`, `reviewed_by`, `review_note`, `sync_log_id` and
   `created_at` are **not** granted, so the review trail is unreachable from the public
   endpoint. A role with only column privileges cannot use `select *` — the client must
   keep naming its columns, which it does.
3. **No `anon` access at all** to `metal_price_sync_logs`.

Administrators read `metal_prices` only if they hold the `metal_prices` capability —
deliberately **not** `is_active_admin()`, which would let any active administrator read
unpublished material. `metal_price_sync_logs` is administrator-only and read-only
through the API; it is written solely by the SECURITY DEFINER functions.

This is the one place the project's "no table privileges for `anon`" rule is bent. The
rule's purpose is that anonymous access goes through something validated; here the
Android client already ships a PostgREST read of this relation and cannot be changed
from this repository, so the narrowest safe alternative is a column-scoped grant
behind a row-scoped policy. A `SECURITY DEFINER` function would have been preferable
had the client been free to change.

### Authorization

| Operation | Required |
|---|---|
| Open the page, read rates, read logs | capability `metal_prices` |
| Sync, publish, reject, create/deactivate an override | capability `metal_prices` |

`manage_metal_prices` maps to **`super_admin` only** in
`src/lib/permissions/permissions.ts`, mirrored in the `metal_prices` branch of
`public.can_admin()`. Reference prices decide what every user's Zakat calculation is
based on, so the capability is deliberately narrow. Widening it is a two-line change in
those two places.

Every server action calls `guardAction("manage_metal_prices")` **and** every database
function re-checks the same capability, because a `SECURITY DEFINER` function is
reachable by anyone holding `EXECUTE`.

---

## 7. Configuration and deployment

**No new environment variables and no new secrets.** The feature uses the project's
existing `NEXT_PUBLIC_SUPABASE_URL` and `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`, and the
provider needs no key. No `service_role` key exists anywhere in this project, and none
should be introduced: the design depends on row level security, which a service-role key
bypasses.

Deploying:

1. Apply the two migrations (order matters only in that the tables come first).
2. Confirm the `anon` grants on `metal_prices` survived — see the check below.
3. Open **Zakat → Metal Reference Prices** as a super admin.
4. Fetch current prices, review the candidates, publish what you have verified.
5. Leave a rate unpublished if you have nothing verified for it. The app falls back to
   manual entry, which is the correct outcome.

Because the app reads through RLS rather than the panel, verify the public side
directly rather than assuming:

```sql
-- as the anon role: exactly the published, verified rows, and only the granted columns
set role anon;
select metal_type, purity, price_per_gram, currency, verification_status
from public.metal_prices where is_active = true;
```

---

## 8. Troubleshooting

**Nothing appears in the panel.** Check whether the migrations have been applied:
`select to_regclass('public.metal_prices')`. A missing function is reported in the
panel as a read failure, and the page says so rather than showing an empty list.

**The page says reference prices could not be read.** The table exists but the query
failed. This is a panel problem, not a price problem — published rates are unaffected.

**Fetching fails.**

| Message | Cause |
|---|---|
| "did not answer within 8 seconds" | provider slow or unreachable; retry |
| "host name could not be resolved" | DNS or network problem on the server |
| "answered with HTTP 500" | provider error; retry later |
| "redirected the request" | the endpoint moved; review `PROVIDER.endpoints` |
| "could not be read as JSON" | provider returned something that is not JSON |
| "is not a positive price" | the feed published a zero, negative or non-numeric price |
| "in the future" | provider clock or feed is broken; nothing was stored |

A failure for one metal never discards the other, and a failure never changes an
existing published rate. A successful fetch does **not** publish anything.

**A price cannot be published.**

| Message | Cause |
|---|---|
| "has no provider timestamp, or one older than the freshness policy" | tick the acknowledgement after checking the source |
| "cannot be published. Fetch the price again" | the candidate was rejected; rejection is terminal for it |
| "An active manual override is published for…" | deactivate the override explicitly first |
| "in the future by more than the allowed clock skew" | broken feed; fetch again |

**Manual price entry still works when the provider is down**, which is the intended
behaviour: the panel never blocks a calculation on an external service.

**`metal_prices` is missing from the API** (the Android app reports the table is
unavailable). Confirm the table is in the exposed schema and that `anon` holds the
column grants. Row level security being *enabled* is not the same as the table being
*readable* — a policy without a grant reaches nothing.

---

## What these prices are not

- **Not an official BAJUS API.** Gold Price Bangladesh publishes these figures from its
  own saved BAJUS-based records and attributes them to BAJUS. This panel does not
  describe the feed as a market or as an authority.
- **Not proof that a price is current.** The provider's timestamp records when its data
  file was built, and it says prices may be unchanged between builds. Neither the
  provider nor this panel can promise a rate is live.
- **Not the resale value of an item.** Purity, condition, jewellery construction,
  making charges, VAT and a shop's own deductions all change what someone is actually
  offered.
- **Not a Nisab rule.** These are reference rates for one input in the Zakat
  calculator. They do not change the app's Nisab weights, thresholds, or any other
  calculation choice, and the panel does not touch them.
