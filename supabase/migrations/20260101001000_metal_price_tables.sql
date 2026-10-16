-- =============================================================================
-- Salah Admin — 0010: gold and silver reference prices
-- =============================================================================
-- Design notes
--
--   * These are the Bangladesh reference prices the Android app's Zakat
--     calculator uses for gold and silver. They are administrative reference
--     values in BDT per gram, not a claim about what any individual item is
--     worth, and not a guaranteed real-time market quote.
--
--   * One table holds both states of a rate: the published one (`is_active`)
--     and the candidates waiting for review. A candidate is a row; it is never
--     an edit of the live row. That is what makes "a failed fetch cannot damage
--     the published price" true by construction rather than by care.
--
--   * `verification_status`, `metal_type`, `purity` and `currency` are `text`
--     with a CHECK rather than an enum. The Android client parses these as the
--     literal strings `gold`/`silver`, `K22`/`K21`/`K18`/`TRADITIONAL`,
--     `BDT` and `pending`/`verified`/`rejected`, and adding a purity category
--     later must not require an enum alteration, which cannot run inside the
--     migration transaction. A CHECK makes an invalid value impossible to
--     insert just as an enum does.
--
--   * Timestamps are kept apart on purpose:
--       provider_last_update  when the provider's JSON was built. NOT when the
--                             price changed.
--       fetched_at            when this panel received the response.
--       effective_at          when the rate became effective, and only when an
--                             administrator has independently established it.
--       updated_at            last write to the row.
--     The provider does not publish a trustworthy price-effective time, so a
--     fetched candidate leaves `effective_at` NULL and waits for review.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- metal_price_sync_logs — one row per synchronization attempt.
--
-- Created before `metal_prices` because a candidate points at the run that
-- fetched it. A log is operational history: it records what was attempted and
-- what happened, never a user's financial inputs, and never a credential, a
-- request header or a raw provider payload.
-- -----------------------------------------------------------------------------
create table if not exists public.metal_price_sync_logs (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null default 'gold-price-bd',
  status              text not null default 'running',
  started_at          timestamptz not null default now(),
  completed_at        timestamptz,
  gold_updated        boolean,
  silver_updated      boolean,
  gold_status         text,
  silver_status       text,
  gold_candidates     integer not null default 0,
  silver_candidates   integer not null default 0,
  pending_candidates  integer not null default 0,
  rejected_candidates integer not null default 0,
  overrides_preserved integer not null default 0,
  error_message       text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  constraint metal_price_sync_logs_status_known
    check (status in ('running', 'succeeded', 'partial', 'failed')),
  constraint metal_price_sync_logs_provider_not_blank
    check (length(btrim(provider)) between 1 and 64),
  -- A run is finished exactly when it has a completion time. Without this a
  -- half-finished sync could read as `succeeded` with no evidence.
  constraint metal_price_sync_logs_completion_matches_status
    check ((status = 'running') = (completed_at is null)),
  -- `failed` must say why. An operator cannot act on an unexplained failure.
  constraint metal_price_sync_logs_failure_has_message
    check (status <> 'failed' or (error_message is not null and length(btrim(error_message)) > 0)),
  constraint metal_price_sync_logs_metal_status_known
    check (
      (gold_status is null or gold_status in ('succeeded', 'failed', 'skipped'))
      and (silver_status is null or silver_status in ('succeeded', 'failed', 'skipped'))
    ),
  -- A metal counts as updated exactly when its own fetch succeeded.
  constraint metal_price_sync_logs_updated_matches_status
    check (
      (gold_updated is null or gold_updated = (gold_status = 'succeeded'))
      and (silver_updated is null or silver_updated = (silver_status = 'succeeded'))
    ),
  constraint metal_price_sync_logs_counts_not_negative
    check (
      gold_candidates >= 0
      and silver_candidates >= 0
      and pending_candidates >= 0
      and rejected_candidates >= 0
      and overrides_preserved >= 0
    ),
  constraint metal_price_sync_logs_error_length
    check (error_message is null or length(error_message) <= 1000)
);

create index if not exists metal_price_sync_logs_started_at_idx
  on public.metal_price_sync_logs (started_at desc);
create index if not exists metal_price_sync_logs_status_idx
  on public.metal_price_sync_logs (status);

comment on table public.metal_price_sync_logs is
  'One row per gold/silver reference-price synchronization attempt. Operational history only: no user financial inputs, no credentials, no raw provider payloads.';

-- -----------------------------------------------------------------------------
-- metal_prices — reference prices in BDT per gram.
-- -----------------------------------------------------------------------------
create table if not exists public.metal_prices (
  id                   uuid primary key default gen_random_uuid(),
  metal_type           text not null,
  purity               text not null,
  price_per_gram       numeric(12, 2) not null,
  currency             text not null default 'BDT',
  source               text,
  source_url           text,
  -- An administrator has explicitly activated this row as a manual override.
  override_active      boolean not null default false,
  -- This row is the record the Android app reads as the current published rate.
  is_active            boolean not null default false,
  verification_status  text not null default 'pending',
  -- Only ever set by an administrator who has established the effective time.
  effective_at         timestamptz,
  provider_last_update timestamptz,
  fetched_at           timestamptz,
  -- Why a candidate was rejected, or why an override was entered. Ungranted to
  -- anonymous callers; internal review information is not part of the published
  -- contract.
  review_note          text,
  reviewed_by          uuid references auth.users (id) on delete set null,
  reviewed_at          timestamptz,
  sync_log_id          uuid references public.metal_price_sync_logs (id) on delete set null,
  created_at           timestamptz not null default now(),
  created_by           uuid references auth.users (id) on delete set null,
  updated_at           timestamptz not null default now(),
  updated_by           uuid references auth.users (id) on delete set null,
  constraint metal_prices_metal_type_known
    check (metal_type in ('gold', 'silver')),
  constraint metal_prices_purity_known
    check (purity in ('K22', 'K21', 'K18', 'TRADITIONAL')),
  -- Bangladesh-only feature. A second currency would need a conversion policy
  -- that does not exist, so it is refused rather than silently mislabelled.
  constraint metal_prices_currency_is_bdt
    check (currency = 'BDT'),
  -- The single most important rule in this table. A missing price is not a
  -- zero price, and a zero price would publish a free metal.
  constraint metal_prices_price_positive
    check (price_per_gram > 0),
  constraint metal_prices_verification_status_known
    check (verification_status in ('pending', 'verified', 'rejected')),
  -- Only a verified rate may be exposed as the published rate.
  constraint metal_prices_active_requires_verified
    check (not is_active or verification_status = 'verified'),
  -- An override is the live rate, so it must also be verified and active.
  -- (A manual entry is verified by the administrator's own recorded review.)
  constraint metal_prices_override_is_live_verified
    check (not override_active or (is_active and verification_status = 'verified')),
  constraint metal_prices_source_url_scheme
    check (source_url is null or source_url ~* '^https?://'),
  constraint metal_prices_review_note_length
    check (review_note is null or length(review_note) <= 500)
);

-- -----------------------------------------------------------------------------
-- Concurrency and publication integrity.
--
-- The partial unique indexes are the real guarantees. They hold even if two
-- administrators synchronize at the same moment, and even if a future code path
-- forgets to check first.
-- -----------------------------------------------------------------------------

-- At most one published rate per metal, purity and currency. This is what makes
-- "publication cannot leave two active rates" true.
create unique index if not exists metal_prices_one_published_rate_key
  on public.metal_prices (metal_type, purity, currency)
  where is_active;

-- At most one candidate waiting for review per metal, purity and currency, so
-- the review queue cannot fill with duplicates of the same rate and a repeated
-- sync cannot create an ambiguous pair of candidates.
create unique index if not exists metal_prices_one_pending_candidate_key
  on public.metal_prices (metal_type, purity, currency)
  where (not is_active and verification_status = 'pending');

create index if not exists metal_prices_metal_purity_idx
  on public.metal_prices (metal_type, purity);
create index if not exists metal_prices_verification_idx
  on public.metal_prices (verification_status, metal_type)
  where not is_active;
create index if not exists metal_prices_updated_at_idx
  on public.metal_prices (updated_at desc);
create index if not exists metal_prices_sync_log_idx
  on public.metal_prices (sync_log_id);

comment on table public.metal_prices is
  'Bangladesh gold and silver reference prices in BDT per gram. Holds both the published rate (is_active) and candidates awaiting review; a candidate is a new row, never an edit of the live one.';

comment on column public.metal_prices.is_active is
  'The record the Android Zakat calculator reads as the current published rate. Exactly one per metal/purity/currency (partial unique index), and only while verification_status = verified.';

comment on column public.metal_prices.override_active is
  'An administrator explicitly activated this row as a manual override. Synchronization never rewrites or deactivates such a row.';

comment on column public.metal_prices.effective_at is
  'When the rate became effective, and only when an administrator has independently established it. Never derived from provider_last_update or fetched_at: the provider publishes a build time, not a price-change time.';

comment on column public.metal_prices.provider_last_update is
  'The timestamp the price provider put in its JSON. It records when that document was built and does not establish when the price changed.';

comment on column public.metal_prices.review_note is
  'Rejection reason or override justification. Internal review information, deliberately not granted to anonymous callers.';

-- -----------------------------------------------------------------------------
-- History.
--
-- audit_logs is this project's append-only history, and every write to these
-- tables is recorded there with its old and new row image. Superseded rates are
-- additionally never removed: publishing a replacement deactivates the previous
-- row rather than overwriting it, so the previous price is still readable, and
-- a mismatched row can be audited back to the value it held.
-- -----------------------------------------------------------------------------
drop trigger if exists set_audit_columns on public.metal_prices;
create trigger set_audit_columns
  before insert or update on public.metal_prices
  for each row execute function public.touch_audit_columns();

drop trigger if exists audit_row_change on public.metal_prices;
create trigger audit_row_change
  after insert or update or delete on public.metal_prices
  for each row execute function public.audit_row_change();

-- A log row has no updated_at/updated_by: it is written when a run starts and
-- amended once when it finishes. Only the audit trigger is attached.
drop trigger if exists audit_row_change on public.metal_price_sync_logs;
create trigger audit_row_change
  after insert or update or delete on public.metal_price_sync_logs
  for each row execute function public.audit_row_change();
