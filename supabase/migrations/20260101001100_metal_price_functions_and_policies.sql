-- =============================================================================
-- Salah Admin — 0011: reference-price workflow, authorization and public read
-- =============================================================================
-- The shape of the workflow, and why it is this shape:
--
--   fetch (server action, outside PostgreSQL)
--     -> record_metal_price_candidate()      a pending candidate; never live
--          -> administrator reviews the source and the timestamps
--               -> publish_metal_price_rate()   verified + active, atomic swap
--               -> reject_metal_price_candidate()
--     -> finish_metal_price_sync()            the log entry
--
-- Nothing here publishes automatically. A fetched price cannot become the
-- published price without an administrator calling publish_metal_price_rate(),
-- and that function refuses a candidate whose timestamp cannot support the
-- claim, a rejected candidate, and anything that would displace an active
-- manual override.
--
-- Every function is SECURITY DEFINER and re-checks the capability itself, for
-- the same reason `publish_prayer_config()` does: a SECURITY DEFINER function is
-- reachable by anyone holding EXECUTE, so the check cannot live only at the call
-- site.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Capability
-- -----------------------------------------------------------------------------
-- `can_admin()` is the single source of truth for write capability and is
-- mirrored in src/lib/permissions/permissions.ts. This replacement adds one
-- branch and changes nothing else. Reference prices decide what every user's
-- Zakat calculation is based on, so the capability is held by super admins only;
-- widening it is a deliberate change in both places.
create or replace function public.can_admin(p_capability text)
returns boolean
language sql
stable
security definer
set search_path = public, auth
as $$
  select exists (
    select 1
    from public.admin_users u
    where u.id = auth.uid()
      and u.is_active
      and case p_capability
        when 'locations'      then u.role in ('super_admin', 'location_manager')
        when 'prayer_config'  then u.role in ('super_admin', 'prayer_data_reviewer')
        when 'prayer_timings' then u.role in ('super_admin', 'prayer_data_reviewer')
        when 'ramadan'        then u.role in ('super_admin', 'prayer_data_reviewer')
        when 'app_config'     then u.role in ('super_admin', 'content_editor')
        when 'announcements'  then u.role in ('super_admin', 'content_editor')
        when 'feedback'       then u.role in ('super_admin', 'support_admin')
        when 'audit'          then u.role in ('super_admin')
        when 'admins'         then u.role in ('super_admin')
        when 'metal_prices'   then u.role in ('super_admin')
        else false
      end
  );
$$;

-- -----------------------------------------------------------------------------
-- Freshness policy
-- -----------------------------------------------------------------------------
-- Documented in docs/METAL_PRICES.md § Freshness policy. The defaults live here
-- and are overridable per database, so the policy is configuration rather than a
-- literal buried in a function, and a client cannot weaken it by disagreeing:
--
--   alter database postgres set salah.metal_price_max_candidate_age_hours = '48';
--
-- Why the age threshold is not a rejection: the provider's `lastUpdate` is the
-- time its JSON document was built, not the time the price changed. An old build
-- timestamp therefore does not prove the price is old, which is why an aged
-- candidate is *flagged* and needs an explicit acknowledgement rather than being
-- thrown away. The future bound is different: a timestamp that has not happened
-- yet is a broken clock or a broken feed, and cannot be reviewed into validity.
create or replace function public.metal_price_setting_int(p_name text, p_default integer)
returns integer
language plpgsql
stable
as $$
declare
  v_raw text;
begin
  v_raw := nullif(btrim(coalesce(current_setting(p_name, true), '')), '');
  if v_raw is null then
    return p_default;
  end if;

  if v_raw !~ '^[0-9]{1,6}$' then
    raise exception 'The database setting % must be a whole number. It is currently "%".',
      p_name, v_raw
      using errcode = 'check_violation';
  end if;

  return v_raw::integer;
end;
$$;

create or replace function public.metal_price_freshness_policy()
returns table (
  max_candidate_age_hours  integer,
  max_published_age_hours  integer,
  max_future_skew_minutes  integer
)
language sql
stable
security definer
set search_path = public, auth
as $$
  select
    public.metal_price_setting_int('salah.metal_price_max_candidate_age_hours', 72),
    public.metal_price_setting_int('salah.metal_price_max_published_age_hours', 96),
    public.metal_price_setting_int('salah.metal_price_max_future_skew_minutes', 180);
$$;

comment on function public.metal_price_freshness_policy() is
  'The reference-price freshness policy: how old a candidate may be before it needs an explicit acknowledgement, how old a published rate may be before the panel asks for a review, and the clock skew tolerated in a provider timestamp.';

revoke all on function public.metal_price_setting_int(text, integer) from public;
revoke all on function public.metal_price_freshness_policy() from public;
grant execute on function public.metal_price_freshness_policy() to authenticated;

-- -----------------------------------------------------------------------------
-- The live row is immutable while it is live.
--
-- A published rate is the number the Android app is reading right now. If it
-- could be edited in place, the value a user's Zakat was calculated from would
-- be unrecoverable — the row would simply have always said something else. So a
-- change of price is always a new row plus a deactivation of the old one, and an
-- active manual override additionally cannot have its provenance rewritten,
-- because that provenance is an administrator's recorded decision.
-- -----------------------------------------------------------------------------
create or replace function public.guard_metal_price_row()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
begin
  if tg_op = 'DELETE' then
    if old.is_active then
      raise exception
        'A published rate cannot be deleted. Publish a reviewed replacement instead, so the value the app was reading stays recoverable.'
        using errcode = 'check_violation';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.is_active and new.is_active then
    if new.price_per_gram is distinct from old.price_per_gram then
      raise exception
        'A published rate cannot be changed in place. Publish a reviewed replacement instead, so the value that was live stays recoverable.'
        using errcode = 'check_violation';
    end if;

    if new.metal_type is distinct from old.metal_type
       or new.purity is distinct from old.purity
       or new.currency is distinct from old.currency then
      raise exception
        'A published rate''s metal, purity and currency cannot be changed. Publish a reviewed replacement instead.'
        using errcode = 'check_violation';
    end if;

    if old.override_active and (
         new.effective_at is distinct from old.effective_at
         or new.source is distinct from old.source
         or new.source_url is distinct from old.source_url
         or new.review_note is distinct from old.review_note
       ) then
      raise exception
        'An active manual override cannot be edited in place. Deactivate it and record a new override, so both decisions stay in the history.'
        using errcode = 'check_violation';
    end if;
  end if;

  return new;
end;
$$;

drop trigger if exists guard_metal_price_row on public.metal_prices;
create trigger guard_metal_price_row
  before update or delete on public.metal_prices
  for each row execute function public.guard_metal_price_row();

comment on function public.guard_metal_price_row() is
  'Keeps a live rate immutable: a price change is a new row plus a deactivation, never an in-place edit, and an active override''s provenance cannot be rewritten.';

-- -----------------------------------------------------------------------------
-- Synchronization: start -> record candidates -> finish
-- -----------------------------------------------------------------------------

/**
 * Opens a synchronization attempt.
 *
 * Also closes any run that was left `running`, which is what an abandoned
 * request leaves behind: the server action died between start and finish, and a
 * row stuck at `running` for ever would read as a sync that never returns.
 */
create or replace function public.start_metal_price_sync(p_provider text default 'gold-price-bd')
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_provider text := coalesce(nullif(btrim(coalesce(p_provider, '')), ''), 'gold-price-bd');
  v_id uuid;
  v_abandoned integer;
begin
  if not public.can_admin('metal_prices') then
    raise exception 'Your role does not include managing gold and silver reference prices.'
      using errcode = '42501';
  end if;

  if length(v_provider) > 64 then
    raise exception 'The provider name is limited to 64 characters.' using errcode = 'check_violation';
  end if;

  update public.metal_price_sync_logs
     set status = 'failed',
         completed_at = now(),
         error_message = coalesce(
           nullif(btrim(coalesce(error_message, '')), ''),
           'The synchronization did not finish and was abandoned. It was marked failed when the next run started.'
         )
   where status = 'running'
     and started_at < now() - interval '15 minutes';

  get diagnostics v_abandoned = row_count;

  insert into public.metal_price_sync_logs (provider, status, started_at, created_by)
  values (v_provider, 'running', now(), auth.uid())
  returning id into v_id;

  return v_id;
end;
$$;

comment on function public.start_metal_price_sync(text) is
  'Opens a synchronization log entry and closes any run abandoned by a dead request. Authorization is re-checked inside.';

revoke all on function public.start_metal_price_sync(text) from public;
grant execute on function public.start_metal_price_sync(text) to authenticated;

/**
 * Records one fetched price as a candidate awaiting review.
 *
 * The candidate is never the live rate and never carries an effective time: the
 * provider publishes a build timestamp, which cannot establish when the price
 * changed, so `effective_at` is left NULL for an administrator to fill in if they
 * can establish it.
 *
 * A repeat synchronization replaces the unpublished candidate for the same rate
 * rather than adding a second one, so the review queue holds at most one
 * candidate per metal/purity/currency. A rejected candidate is left alone: it is
 * a decision, and the next fetch creates a new candidate instead of reopening it.
 */
create or replace function public.record_metal_price_candidate(
  p_sync_id             uuid,
  p_metal_type          text,
  p_purity              text,
  p_price_per_gram      numeric,
  p_currency            text default 'BDT',
  p_source              text default null,
  p_source_url          text default null,
  p_provider_last_update timestamptz default null,
  p_fetched_at          timestamptz default null
)
returns public.metal_prices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_metal    text := lower(btrim(coalesce(p_metal_type, '')));
  v_purity   text := upper(btrim(coalesce(p_purity, '')));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_source   text := nullif(btrim(coalesce(p_source, '')), '');
  v_url      text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_fetched  timestamptz := coalesce(p_fetched_at, now());
  v_policy   record;
  v_existing public.metal_prices;
  v_row      public.metal_prices;
begin
  if not public.can_admin('metal_prices') then
    raise exception 'Your role does not include managing gold and silver reference prices.'
      using errcode = '42501';
  end if;

  if v_metal not in ('gold', 'silver') then
    raise exception 'A reference price must be for gold or silver; "%" is neither.', p_metal_type
      using errcode = 'check_violation';
  end if;

  if v_purity not in ('K22', 'K21', 'K18', 'TRADITIONAL') then
    raise exception 'Unsupported purity category "%".', p_purity
      using errcode = 'check_violation';
  end if;

  if v_currency <> 'BDT' then
    raise exception 'Reference prices are published in BDT. % is not supported, and no conversion policy exists.', p_currency
      using errcode = 'check_violation';
  end if;

  if p_price_per_gram is null then
    raise exception 'A reference price is required.' using errcode = 'check_violation';
  end if;

  if p_price_per_gram <= 0 then
    raise exception 'A reference price must be greater than zero. % was supplied, which would publish a free metal.', p_price_per_gram
      using errcode = 'check_violation';
  end if;

  if v_url is not null and v_url !~* '^https?://' then
    raise exception 'The source reference must be a full http:// or https:// address.' using errcode = 'check_violation';
  end if;

  if p_provider_last_update is not null then
    select * into v_policy from public.metal_price_freshness_policy();

    if p_provider_last_update > now() + make_interval(mins => v_policy.max_future_skew_minutes) then
      raise exception
        'The provider timestamp for this rate is in the future by more than the allowed clock skew, so it cannot be trusted.'
        using errcode = 'check_violation';
    end if;
  end if;

  if p_sync_id is not null and not exists (
    select 1 from public.metal_price_sync_logs where id = p_sync_id
  ) then
    raise exception 'That synchronization no longer exists.' using errcode = 'check_violation';
  end if;

  select * into v_existing
    from public.metal_prices
   where metal_type = v_metal
     and purity = v_purity
     and currency = v_currency
     and not is_active
     and verification_status = 'pending'
     for update;

  if found then
    update public.metal_prices
       set price_per_gram = p_price_per_gram,
           source = v_source,
           source_url = v_url,
           provider_last_update = p_provider_last_update,
           fetched_at = v_fetched,
           sync_log_id = p_sync_id,
           review_note = null,
           reviewed_by = null,
           reviewed_at = null
     where id = v_existing.id
    returning * into v_row;

    return v_row;
  end if;

  insert into public.metal_prices (
    metal_type, purity, price_per_gram, currency, source, source_url,
    override_active, is_active, verification_status,
    effective_at, provider_last_update, fetched_at, sync_log_id
  )
  values (
    v_metal, v_purity, p_price_per_gram, v_currency, v_source, v_url,
    false, false, 'pending',
    null, p_provider_last_update, v_fetched, p_sync_id
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.record_metal_price_candidate(uuid, text, text, numeric, text, text, text, timestamptz, timestamptz) is
  'Stores a fetched price as a pending candidate. Never live, never given an effective time, and it replaces only an unpublished candidate for the same rate. Authorization is re-checked inside.';

revoke all on function public.record_metal_price_candidate(uuid, text, text, numeric, text, text, text, timestamptz, timestamptz) from public;
grant execute on function public.record_metal_price_candidate(uuid, text, text, numeric, text, text, text, timestamptz, timestamptz) to authenticated;

/** Completes a synchronization attempt with its real outcome. */
create or replace function public.finish_metal_price_sync(
  p_sync_id             uuid,
  p_status              text,
  p_gold_status         text default null,
  p_silver_status       text default null,
  p_gold_candidates     integer default 0,
  p_silver_candidates   integer default 0,
  p_pending_candidates  integer default 0,
  p_rejected_candidates integer default 0,
  p_overrides_preserved integer default 0,
  p_error_message       text default null
)
returns public.metal_price_sync_logs
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.metal_price_sync_logs;
begin
  if not public.can_admin('metal_prices') then
    raise exception 'Your role does not include managing gold and silver reference prices.'
      using errcode = '42501';
  end if;

  if p_status not in ('succeeded', 'partial', 'failed') then
    raise exception 'A finished synchronization must be succeeded, partial or failed; "%" is none of them.', p_status
      using errcode = 'check_violation';
  end if;

  -- A failure without a reason is not actionable, and the log is the only place
  -- an operator can find out what went wrong later.
  if p_status = 'failed' and nullif(btrim(coalesce(p_error_message, '')), '') is null then
    raise exception 'A failed synchronization must record why it failed.' using errcode = 'check_violation';
  end if;

  select * into v_row from public.metal_price_sync_logs where id = p_sync_id for update;

  if not found then
    raise exception 'That synchronization no longer exists.' using errcode = 'check_violation';
  end if;

  if v_row.status <> 'running' then
    raise exception 'That synchronization has already finished.' using errcode = 'check_violation';
  end if;

  update public.metal_price_sync_logs
     set status = p_status,
         completed_at = now(),
         gold_status = p_gold_status,
         silver_status = p_silver_status,
         gold_updated = (p_gold_status = 'succeeded'),
         silver_updated = (p_silver_status = 'succeeded'),
         gold_candidates = greatest(coalesce(p_gold_candidates, 0), 0),
         silver_candidates = greatest(coalesce(p_silver_candidates, 0), 0),
         pending_candidates = greatest(coalesce(p_pending_candidates, 0), 0),
         rejected_candidates = greatest(coalesce(p_rejected_candidates, 0), 0),
         overrides_preserved = greatest(coalesce(p_overrides_preserved, 0), 0),
         error_message = nullif(btrim(coalesce(p_error_message, '')), '')
   where id = p_sync_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.finish_metal_price_sync(uuid, text, text, text, integer, integer, integer, integer, integer, text) is
  'Closes a synchronization log entry. Refuses to close a run twice, and a failed run must carry a message. Authorization is re-checked inside.';

revoke all on function public.finish_metal_price_sync(uuid, text, text, text, integer, integer, integer, integer, integer, text) from public;
grant execute on function public.finish_metal_price_sync(uuid, text, text, text, integer, integer, integer, integer, integer, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Review: publish and reject
-- -----------------------------------------------------------------------------

/**
 * Publishes a candidate as the reference price for its metal, purity and currency.
 *
 * One transaction, so the app never sees two live rates and never sees none:
 * the incumbent is deactivated and the replacement activated together, guarded
 * by the partial unique index and by `for update` on the row being published.
 *
 * Refusals a caller cannot talk their way out of:
 *   * a rejected candidate,
 *   * a non-positive price,
 *   * a provider timestamp beyond the tolerated clock skew (a broken feed, not a
 *     late one),
 *   * an aged or missing provider timestamp without `p_acknowledge_stale`,
 *   * and an active manual override for the same rate, which only an explicit
 *     deactivation may displace.
 */
create or replace function public.publish_metal_price_rate(
  p_id                uuid,
  p_effective_at      timestamptz default null,
  p_acknowledge_stale boolean default false
)
returns public.metal_prices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row    public.metal_prices;
  v_policy record;
  v_stale  boolean;
  v_incumbent public.metal_prices;
begin
  if not public.can_admin('metal_prices') then
    raise exception 'Your role does not include managing gold and silver reference prices.'
      using errcode = '42501';
  end if;

  select * into v_policy from public.metal_price_freshness_policy();

  select * into v_row from public.metal_prices where id = p_id for update;

  if not found then
    raise exception 'That price no longer exists.' using errcode = 'check_violation';
  end if;

  if v_row.is_active then
    raise exception 'That rate is already the published price for % %.', v_row.metal_type, v_row.purity
      using errcode = 'check_violation';
  end if;

  if v_row.verification_status = 'rejected' then
    raise exception
      'A rejected candidate cannot be published. Fetch the price again and review the candidate that produces.'
      using errcode = 'check_violation';
  end if;

  if v_row.price_per_gram is null or v_row.price_per_gram <= 0 then
    raise exception 'A rate needs a positive price before it can be published.'
      using errcode = 'check_violation';
  end if;

  if v_row.provider_last_update is not null
     and v_row.provider_last_update > now() + make_interval(mins => v_policy.max_future_skew_minutes) then
    raise exception
      'The provider timestamp for this candidate is in the future by more than the allowed clock skew, so it cannot be trusted. Fetch the price again.'
      using errcode = 'check_violation';
  end if;

  v_stale := v_row.provider_last_update is null
    or v_row.provider_last_update < now() - make_interval(hours => v_policy.max_candidate_age_hours);

  if v_stale and not p_acknowledge_stale then
    raise exception
      'This candidate has no provider timestamp, or one older than the freshness policy allows, so when the price changed cannot be established from it. Review the source and acknowledge that before publishing.'
      using errcode = 'check_violation';
  end if;

  -- An active override is a human decision about this specific rate. Publishing
  -- must not displace it silently; the administrator has to deactivate it.
  select * into v_incumbent
    from public.metal_prices
   where metal_type = v_row.metal_type
     and purity = v_row.purity
     and currency = v_row.currency
     and is_active
     and id <> v_row.id
     and override_active
     for update;

  if found then
    raise exception
      'An active manual override is published for % %. Deactivate it explicitly before publishing another rate.', v_row.metal_type, v_row.purity
      using errcode = 'check_violation';
  end if;

  -- The incumbent goes first so the "one published rate" index holds at every
  -- statement boundary.
  update public.metal_prices
     set is_active = false
   where metal_type = v_row.metal_type
     and purity = v_row.purity
     and currency = v_row.currency
     and is_active
     and id <> v_row.id;

  update public.metal_prices
     set verification_status = 'verified',
         is_active = true,
         effective_at = coalesce(p_effective_at, v_row.effective_at),
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.publish_metal_price_rate(uuid, timestamptz, boolean) is
  'Atomically deactivates the incumbent rate for the same metal/purity/currency and publishes this one as verified. Refuses a rejected candidate, an implausible timestamp, an unacknowledged stale one, and an active manual override. Authorization is re-checked inside.';

revoke all on function public.publish_metal_price_rate(uuid, timestamptz, boolean) from public;
grant execute on function public.publish_metal_price_rate(uuid, timestamptz, boolean) to authenticated;

/** Rejects a candidate, optionally recording why. Rejection is terminal for that candidate. */
create or replace function public.reject_metal_price_candidate(
  p_id     uuid,
  p_reason text default null
)
returns public.metal_prices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.metal_prices;
  v_reason text := nullif(btrim(coalesce(p_reason, '')), '');
begin
  if not public.can_admin('metal_prices') then
    raise exception 'Your role does not include managing gold and silver reference prices.'
      using errcode = '42501';
  end if;

  if v_reason is not null and length(v_reason) > 500 then
    raise exception 'The rejection reason is limited to 500 characters.' using errcode = 'check_violation';
  end if;

  select * into v_row from public.metal_prices where id = p_id for update;

  if not found then
    raise exception 'That price no longer exists.' using errcode = 'check_violation';
  end if;

  if v_row.is_active then
    raise exception
      'That rate is published, so there is nothing to reject. Publish a reviewed replacement instead.'
      using errcode = 'check_violation';
  end if;

  if v_row.verification_status <> 'pending' then
    raise exception 'That candidate has already been reviewed.' using errcode = 'check_violation';
  end if;

  update public.metal_prices
     set verification_status = 'rejected',
         review_note = v_reason,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_id
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.reject_metal_price_candidate(uuid, text) is
  'Marks a pending candidate rejected and records why. A rejected candidate can never be published; a later fetch creates a fresh candidate instead. Authorization is re-checked inside.';

revoke all on function public.reject_metal_price_candidate(uuid, text) from public;
grant execute on function public.reject_metal_price_candidate(uuid, text) to authenticated;

-- -----------------------------------------------------------------------------
-- Manual overrides
-- -----------------------------------------------------------------------------

/**
 * Records an administrator's own reference price and activates it as an override.
 *
 * The entered value is an administrative reference price, not a market quote: it
 * is verified by the administrator entering it, which is why the row is stored
 * as verified with their identity and a required reason. Activating an override
 * deactivates the incumbent in the same transaction, because an override takes
 * precedence over synchronization. Synchronization afterwards will record a
 * candidate for comparison and leave this row alone.
 */
create or replace function public.create_metal_price_override(
  p_metal_type     text,
  p_purity         text,
  p_price_per_gram numeric,
  p_currency       text default 'BDT',
  p_source         text default null,
  p_source_url     text default null,
  p_effective_at   timestamptz default null,
  p_reason         text default null
)
returns public.metal_prices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_metal    text := lower(btrim(coalesce(p_metal_type, '')));
  v_purity   text := upper(btrim(coalesce(p_purity, '')));
  v_currency text := upper(btrim(coalesce(p_currency, '')));
  v_source   text := nullif(btrim(coalesce(p_source, '')), '');
  v_url      text := nullif(btrim(coalesce(p_source_url, '')), '');
  v_reason   text := nullif(btrim(coalesce(p_reason, '')), '');
  v_live     public.metal_prices;
  v_row      public.metal_prices;
begin
  if not public.can_admin('metal_prices') then
    raise exception 'Your role does not include managing gold and silver reference prices.'
      using errcode = '42501';
  end if;

  if v_metal not in ('gold', 'silver') then
    raise exception 'A reference price must be for gold or silver; "%" is neither.', p_metal_type
      using errcode = 'check_violation';
  end if;

  if v_purity not in ('K22', 'K21', 'K18', 'TRADITIONAL') then
    raise exception 'Unsupported purity category "%".', p_purity
      using errcode = 'check_violation';
  end if;

  if v_currency <> 'BDT' then
    raise exception 'Reference prices are published in BDT. % is not supported, and no conversion policy exists.', p_currency
      using errcode = 'check_violation';
  end if;

  if p_price_per_gram is null or p_price_per_gram <= 0 then
    raise exception 'A manual reference price must be greater than zero.' using errcode = 'check_violation';
  end if;

  if v_url is not null and v_url !~* '^https?://' then
    raise exception 'The source reference must be a full http:// or https:// address.' using errcode = 'check_violation';
  end if;

  if v_reason is null then
    raise exception
      'Record why this manual price is being set. Without a reason, nobody reviewing the history later can tell what it was based on.'
      using errcode = 'check_violation';
  end if;

  if length(v_reason) > 500 then
    raise exception 'The reason is limited to 500 characters.' using errcode = 'check_violation';
  end if;

  -- Serializes two administrators overriding the same rate at the same moment.
  perform pg_advisory_xact_lock(hashtextextended(v_metal || ':' || v_purity || ':' || v_currency, 0));

  select * into v_live
    from public.metal_prices
   where metal_type = v_metal
     and purity = v_purity
     and currency = v_currency
     and is_active
     and override_active
     for update;

  if found then
    raise exception
      'A manual override is already published for % %. Deactivate it first and record the new price as a fresh override, so both decisions stay in the history.', v_metal, v_purity
      using errcode = 'check_violation';
  end if;

  update public.metal_prices
     set is_active = false
   where metal_type = v_metal
     and purity = v_purity
     and currency = v_currency
     and is_active
     and not override_active;

  insert into public.metal_prices (
    metal_type, purity, price_per_gram, currency, source, source_url,
    override_active, is_active, verification_status,
    effective_at, review_note, reviewed_by, reviewed_at
  )
  values (
    v_metal, v_purity, p_price_per_gram, v_currency, v_source, v_url,
    true, true, 'verified',
    p_effective_at, v_reason, auth.uid(), now()
  )
  returning * into v_row;

  return v_row;
end;
$$;

comment on function public.create_metal_price_override(text, text, numeric, text, text, text, timestamptz, text) is
  'Records and activates an administrator''s manual reference price for exactly one metal/purity/currency, deactivating the incumbent. Requires a reason. Authorization is re-checked inside.';

revoke all on function public.create_metal_price_override(text, text, numeric, text, text, text, timestamptz, text) from public;
grant execute on function public.create_metal_price_override(text, text, numeric, text, text, text, timestamptz, text) to authenticated;

/**
 * Deactivates an override. Nothing is promoted automatically.
 *
 * When an override is disabled the rate becomes unavailable until an
 * administrator resolves it: a pending or rejected candidate is never activated
 * on the way past, and a verified alternative is only restored when the caller
 * names it explicitly. A verified alternative that has itself aged past the
 * freshness policy needs the same explicit acknowledgement publishing does.
 */
create or replace function public.deactivate_metal_price_override(
  p_id                uuid,
  p_restore_id        uuid default null,
  p_acknowledge_stale boolean default false
)
returns public.metal_prices
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row     public.metal_prices;
  v_restore public.metal_prices;
  v_policy  record;
begin
  if not public.can_admin('metal_prices') then
    raise exception 'Your role does not include managing gold and silver reference prices.'
      using errcode = '42501';
  end if;

  select * into v_row from public.metal_prices where id = p_id for update;

  if not found then
    raise exception 'That price no longer exists.' using errcode = 'check_violation';
  end if;

  if not (v_row.is_active and v_row.override_active) then
    raise exception 'That rate is not an active manual override.' using errcode = 'check_violation';
  end if;

  update public.metal_prices
     set is_active = false,
         override_active = false,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_id
  returning * into v_row;

  if p_restore_id is null or p_restore_id = p_id then
    return v_row;
  end if;

  select * into v_restore from public.metal_prices where id = p_restore_id for update;

  if not found then
    raise exception 'The rate you asked to restore no longer exists.' using errcode = 'check_violation';
  end if;

  if v_restore.metal_type <> v_row.metal_type
     or v_restore.purity <> v_row.purity
     or v_restore.currency <> v_row.currency then
    raise exception 'The rate you asked to restore is for a different metal, purity or currency.'
      using errcode = 'check_violation';
  end if;

  if v_restore.is_active then
    raise exception 'The rate you asked to restore is already the published price.' using errcode = 'check_violation';
  end if;

  if v_restore.verification_status <> 'verified' then
    raise exception
      'That rate has not been verified, so it cannot replace the override. Approve a reviewed candidate instead, or leave the rate unavailable.'
      using errcode = 'check_violation';
  end if;

  select * into v_policy from public.metal_price_freshness_policy();

  if v_restore.provider_last_update is not null
     and v_restore.provider_last_update > now() + make_interval(mins => v_policy.max_future_skew_minutes) then
    raise exception
      'The provider timestamp on that rate is in the future by more than the allowed clock skew, so it cannot be trusted.'
      using errcode = 'check_violation';
  end if;

  if (
       v_restore.provider_last_update is null
       or v_restore.provider_last_update < now() - make_interval(hours => v_policy.max_candidate_age_hours)
     )
     and not p_acknowledge_stale then
    raise exception
      'That rate is older than the freshness policy allows, so restoring it would republish a rate that needs reviewing. Acknowledge that explicitly, or fetch and approve a current price.'
      using errcode = 'check_violation';
  end if;

  update public.metal_prices
     set is_active = true,
         reviewed_by = auth.uid(),
         reviewed_at = now()
   where id = p_restore_id
  returning * into v_restore;

  return v_restore;
end;
$$;

comment on function public.deactivate_metal_price_override(uuid, uuid, boolean) is
  'Deactivates an active manual override and leaves the rate unavailable unless the caller names a verified replacement. Never promotes a pending or rejected candidate. Authorization is re-checked inside.';

revoke all on function public.deactivate_metal_price_override(uuid, uuid, boolean) from public;
grant execute on function public.deactivate_metal_price_override(uuid, uuid, boolean) to authenticated;

-- -----------------------------------------------------------------------------
-- Row level security
-- -----------------------------------------------------------------------------
alter table public.metal_prices enable row level security;
alter table public.metal_price_sync_logs enable row level security;

-- Administrators, and the public read contract.
--
-- The published rate is public: the Android Zakat calculator reads it with the
-- publishable (anon) key. Everything else in this table is management data — a
-- candidate under review, a rejection, a reviewer's identity — and is not.
--
-- Two independent mechanisms, on purpose, because either one alone is a single
-- point of failure:
--   * this policy limits which ROWS an anonymous caller can see, and
--   * the column grants below limit which COLUMNS of those rows exist for them.
-- Row level security and privileges are both needed by PostgreSQL; a policy
-- without a grant reaches nothing, and a grant without a policy reaches
-- everything that PostgREST can name.
-- Read is scoped to the same capability as write, not to `is_active_admin()`.
--
-- `is_active_admin()` is true for every active administrator, which is right for
-- the geography tables — a location manager should be able to see the place
-- names the panel is built on. It is wrong here: this table is mostly
-- unpublished material, and its rows carry rejection reasons, reviewer
-- identities and a sync correlation. A content editor has no reason to read a
-- candidate that nobody has verified, so the capability that governs writing
-- governs reading too. This mirrors audit_logs, the project's other
-- capability-scoped read.
drop policy if exists metal_prices_admin_select on public.metal_prices;
create policy metal_prices_admin_select on public.metal_prices
  for select to authenticated
  using (public.can_admin('metal_prices'));

drop policy if exists metal_prices_public_select on public.metal_prices;
create policy metal_prices_public_select on public.metal_prices
  for select to anon, authenticated
  using (is_active and verification_status = 'verified');

drop policy if exists metal_prices_insert on public.metal_prices;
create policy metal_prices_insert on public.metal_prices
  for insert to authenticated
  with check (public.can_admin('metal_prices'));

-- No delete policy: a price is retired by publishing a replacement, and the
-- guard trigger refuses to delete a live row even if a policy were added later.
drop policy if exists metal_prices_update on public.metal_prices;
create policy metal_prices_update on public.metal_prices
  for update to authenticated
  using (public.can_admin('metal_prices'))
  with check (public.can_admin('metal_prices'));

-- Synchronization logs are administrator-only, read-only and written solely by
-- the SECURITY DEFINER functions above — the same shape as audit_logs. They are
-- never part of the public contract.
drop policy if exists metal_price_sync_logs_select on public.metal_price_sync_logs;
create policy metal_price_sync_logs_select on public.metal_price_sync_logs
  for select to authenticated
  using (public.can_admin('metal_prices'));

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
revoke all on public.metal_prices from anon;
revoke all on public.metal_price_sync_logs from anon;

grant select, insert, update on public.metal_prices to authenticated;
revoke delete on public.metal_prices from authenticated;
grant select on public.metal_price_sync_logs to authenticated;

-- The Android read contract, granted column by column.
--
-- This project's rule is that `anon` holds no privilege on a table in `public`,
-- and anonymous access goes through a validated SECURITY DEFINER function. That
-- rule cannot apply here: the Android client already ships a PostgREST read of
-- `/rest/v1/metal_prices?is_active=eq.true&select=<13 named columns>`, and
-- changing it is out of scope for this repository. A column grant is the
-- narrowest thing that satisfies it. It is deliberately narrower than the table:
-- `updated_by`, `created_by`, `reviewed_by`, `review_note`, `sync_log_id`,
-- `created_at` and `id`-adjacent management fields are excluded, so the review
-- trail is unreachable from the public endpoint.
--
-- Consequence worth knowing before changing the Android query: a role with only
-- column privileges cannot use `select *`. The client must keep naming its
-- columns, which is exactly what it does.
grant select (
  id,
  metal_type,
  purity,
  price_per_gram,
  currency,
  source,
  source_url,
  override_active,
  is_active,
  verification_status,
  effective_at,
  provider_last_update,
  fetched_at,
  updated_at
) on public.metal_prices to anon;
