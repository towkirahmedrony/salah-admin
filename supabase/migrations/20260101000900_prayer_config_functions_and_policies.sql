-- =============================================================================
-- Salah Admin — 0009: prayer configuration functions, policies and read contract
-- =============================================================================
-- Companion to 20260101000800. That migration corrected the table; this one adds
-- the operations that must not be expressible as a bare table write.
--
-- Three guarantees established here:
--
--   1. Publishing is atomic. It archives the predecessor and publishes the
--      successor, and a partial application of those two steps would leave a scope
--      with either zero or two live configurations — so it is one function.
--   2. Publishing cannot be reached by a direct table write. The RLS policies below
--      never permit `status = 'published'` through `WITH CHECK`, whatever a client
--      sends. The function runs as the table owner, so the row policies apply only
--      to the paths that are supposed to be constrained.
--   3. The public read exposes published rows only, and never the internal review
--      notes or the actor columns.
--
-- Every statement is re-runnable.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- publish_prayer_config
-- -----------------------------------------------------------------------------
-- Authorization is re-checked inside the function rather than trusted from the
-- caller, because a SECURITY DEFINER function is reachable by anyone holding
-- EXECUTE. The capability test is the same `can_admin('prayer_config')` the RLS
-- policies use, so there is one definition of "may manage prayer configuration".
create or replace function public.publish_prayer_config(p_id uuid)
returns public.prayer_calculation_configs
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.prayer_calculation_configs;
  v_published public.prayer_calculation_configs;
  v_archived integer := 0;
begin
  if not public.can_admin('prayer_config') then
    raise exception 'Your role does not include managing prayer configuration.'
      using errcode = '42501';
  end if;

  -- FOR UPDATE serializes two administrators publishing into the same scope at
  -- once, which is the only way the archive-then-publish pair can interleave.
  select * into v_row
    from public.prayer_calculation_configs
   where id = p_id
     for update;

  if not found then
    raise exception 'That prayer configuration no longer exists.'
      using errcode = 'check_violation';
  end if;

  if v_row.status = 'published' then
    raise exception 'That configuration is already published.'
      using errcode = 'check_violation';
  end if;

  if v_row.status = 'archived' then
    raise exception
      'An archived configuration cannot be published again. Create a new draft from it instead.'
      using errcode = 'check_violation';
  end if;

  -- --- completeness, with a message that says what to fix --------------------
  if v_row.calculation_method is null then
    raise exception 'Select a calculation method before publishing.'
      using errcode = 'check_violation';
  end if;

  -- The engines the Android app actually ships. This list and
  -- SUPPORTED_ENGINES in src/lib/validation/prayer-config.ts must be updated
  -- together; publishing for an engine the app does not carry would have no effect.
  if not (v_row.engine_key = 'adhan_kotlin' and v_row.engine_version in ('0.0.5')) then
    raise exception
      'Engine "%" version "%" is not one the Android app ships, so publishing would have no effect.',
      v_row.engine_key, v_row.engine_version
      using errcode = 'check_violation';
  end if;

  if v_row.source_name is null or length(btrim(v_row.source_name)) = 0 then
    raise exception
      'Record the source these parameters came from. A published configuration without a source cannot be reviewed later.'
      using errcode = 'check_violation';
  end if;

  if v_row.effective_from is null then
    raise exception
      'Set the date this configuration takes effect. Without one, an administrator cannot tell which of two configurations applies on a given day.'
      using errcode = 'check_violation';
  end if;

  if not exists (
    select 1 from pg_timezone_names where name = v_row.timezone
  ) then
    raise exception '"%" is not a valid IANA timezone. Bangladesh uses Asia/Dhaka.', v_row.timezone
      using errcode = 'check_violation';
  end if;

  -- --- archive the incumbent, then publish ----------------------------------
  -- `is not distinct from` so a global row (all three target columns NULL) is
  -- matched by the same predicate as a thana row.
  update public.prayer_calculation_configs
     set status = 'archived'
   where status = 'published'
     and id <> p_id
     and scope = v_row.scope
     and division_id is not distinct from v_row.division_id
     and district_id is not distinct from v_row.district_id
     and thana_id is not distinct from v_row.thana_id;

  get diagnostics v_archived = row_count;

  -- The BEFORE UPDATE triggers do the rest: stamp_publish_metadata writes
  -- published_by / published_at / reviewed_by / reviewed_at from the JWT, and
  -- audit_row_change records a 'publish' action with the real actor.
  update public.prayer_calculation_configs
     set status = 'published'
   where id = p_id
  returning * into v_published;

  return v_published;
end;
$$;

comment on function public.publish_prayer_config(uuid) is
  'Atomically archives the live configuration for the same scope target and publishes this one. Authorization is re-checked inside; reviewer and publisher identities come from the JWT.';

revoke all on function public.publish_prayer_config(uuid) from public;
grant execute on function public.publish_prayer_config(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- archive_prayer_config
-- -----------------------------------------------------------------------------
-- Archiving is the supported alternative to editing or deleting a live
-- configuration: the values stay recoverable and the audit trail keeps them.
create or replace function public.archive_prayer_config(p_id uuid)
returns public.prayer_calculation_configs
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_row public.prayer_calculation_configs;
  v_archived public.prayer_calculation_configs;
begin
  if not public.can_admin('prayer_config') then
    raise exception 'Your role does not include managing prayer configuration.'
      using errcode = '42501';
  end if;

  select * into v_row
    from public.prayer_calculation_configs
   where id = p_id
     for update;

  if not found then
    raise exception 'That prayer configuration no longer exists.'
      using errcode = 'check_violation';
  end if;

  if v_row.status = 'archived' then
    raise exception 'That configuration is already archived.'
      using errcode = 'check_violation';
  end if;

  update public.prayer_calculation_configs
     set status = 'archived'
   where id = p_id
  returning * into v_archived;

  return v_archived;
end;
$$;

comment on function public.archive_prayer_config(uuid) is
  'Retires a configuration without deleting it. Archived rows are never applied as active configuration.';

revoke all on function public.archive_prayer_config(uuid) from public;
grant execute on function public.archive_prayer_config(uuid) to authenticated;

-- -----------------------------------------------------------------------------
-- resolve_prayer_config
-- -----------------------------------------------------------------------------
-- The precedence rule, in one place, so the admin panel's "which configuration
-- applies here?" preview cannot drift from what the contract document says.
--
--   1. thana     2. district     3. division     4. global      else: nothing
--
-- Authenticated only. The Android app does not need this: it holds the whole
-- published set from public_prayer_configs() and applies the same four steps
-- locally, so exposing a resolution RPC anonymously would widen the public surface
-- for no benefit.
create or replace function public.resolve_prayer_config(
  p_division_id uuid default null,
  p_district_id uuid default null,
  p_thana_id    uuid default null,
  p_on_date     date default current_date
)
returns table (
  id                  uuid,
  name                text,
  scope               public.prayer_config_scope,
  matched_by          text,
  calculation_method  public.prayer_calculation_method,
  engine_key          text,
  engine_version      text,
  version             integer,
  effective_from      date,
  effective_to        date,
  published_at        timestamptz
)
language sql
stable
security definer
set search_path = public, auth
as $$
  with candidates as (
    select c.*, 1 as priority, 'thana'::text as matched_by
      from public.prayer_calculation_configs c
     where p_thana_id is not null
       and c.status = 'published' and c.scope = 'thana' and c.thana_id = p_thana_id
       and (c.effective_from is null or c.effective_from <= p_on_date)
       and (c.effective_to is null or c.effective_to >= p_on_date)

    union all

    select c.*, 2, 'district'::text
      from public.prayer_calculation_configs c
     where p_district_id is not null
       and c.status = 'published' and c.scope = 'district' and c.district_id = p_district_id
       and (c.effective_from is null or c.effective_from <= p_on_date)
       and (c.effective_to is null or c.effective_to >= p_on_date)

    union all

    select c.*, 3, 'division'::text
      from public.prayer_calculation_configs c
     where p_division_id is not null
       and c.status = 'published' and c.scope = 'division' and c.division_id = p_division_id
       and (c.effective_from is null or c.effective_from <= p_on_date)
       and (c.effective_to is null or c.effective_to >= p_on_date)

    union all

    select c.*, 4, 'global'::text
      from public.prayer_calculation_configs c
     where c.status = 'published' and c.scope = 'global'
       and (c.effective_from is null or c.effective_from <= p_on_date)
       and (c.effective_to is null or c.effective_to >= p_on_date)
  )
  select k.id, k.name, k.scope, k.matched_by,
         k.calculation_method, k.engine_key, k.engine_version, k.version,
         k.effective_from, k.effective_to, k.published_at
    from candidates k
   order by k.priority
   limit 1;
$$;

comment on function public.resolve_prayer_config(uuid, uuid, uuid, date) is
  'Returns the published configuration that applies to a location on a date, by thana > district > division > global precedence. Admin preview only.';

revoke all on function public.resolve_prayer_config(uuid, uuid, uuid, date) from public;
grant execute on function public.resolve_prayer_config(uuid, uuid, uuid, date) to authenticated;

-- -----------------------------------------------------------------------------
-- public_prayer_configs — the read contract for the Android app
-- -----------------------------------------------------------------------------
-- Published rows only, currently applicable only, and an explicit column list.
-- `notes` (internal review notes) and every actor column are not in it, so a draft
-- or its review commentary is unreachable from here even if an id is guessed.
--
-- `scope_code` is the OCHA p-code the app already stores in
-- `LocationInfo.area` (`BD30`, `BD2015`, `BD20153012`), because that is the shared
-- join key: the panel's code columns and the app's bundled dataset use the same
-- p-codes. The app never needs to know a panel UUID.
create or replace function public.public_prayer_configs()
returns table (
  id                    uuid,
  name                  text,
  scope                 public.prayer_config_scope,
  scope_code            text,
  schema_version        integer,
  engine_key            text,
  engine_version        text,
  calculation_method    public.prayer_calculation_method,
  fajr_angle            numeric,
  isha_angle            numeric,
  isha_interval_minutes integer,
  asr_madhhab           public.asr_madhhab,
  high_latitude_rule    public.high_latitude_rule,
  adjust_fajr           integer,
  adjust_dhuhr          integer,
  adjust_asr            integer,
  adjust_maghrib        integer,
  adjust_isha           integer,
  timezone              text,
  effective_from        date,
  effective_to          date,
  version               integer,
  published_at          timestamptz,
  source_name           text,
  source_url            text
)
language sql
stable
security definer
set search_path = public
as $$
  select c.id,
         c.name,
         c.scope,
         case c.scope
           when 'division' then d.code
           when 'district' then di.code
           when 'thana'    then t.code
           else 'BD'
         end as scope_code,
         c.schema_version,
         c.engine_key,
         c.engine_version,
         c.calculation_method,
         c.fajr_angle,
         c.isha_angle,
         c.isha_interval_minutes,
         c.asr_madhhab,
         c.high_latitude_rule,
         c.adjust_fajr,
         c.adjust_dhuhr,
         c.adjust_asr,
         c.adjust_maghrib,
         c.adjust_isha,
         c.timezone,
         c.effective_from,
         c.effective_to,
         c.version,
         c.published_at,
         c.source_name,
         c.source_url
    from public.prayer_calculation_configs c
    left join public.divisions d  on d.id  = c.division_id
    left join public.districts di on di.id = c.district_id
    left join public.thanas t     on t.id  = c.thana_id
   where c.status = 'published'
     -- An expired configuration is not part of the contract: the app would have to
     -- filter it out again, and serving it invites a stale override.
     and (c.effective_to is null or c.effective_to >= current_date)
   order by case c.scope
              when 'thana'    then 1
              when 'district' then 2
              when 'division' then 3
              else 4
            end,
            c.published_at desc nulls last;
$$;

comment on function public.public_prayer_configs() is
  'Published, currently-applicable prayer configurations with the app-facing p-code. Excludes drafts, archived rows, internal notes and every actor column.';

revoke all on function public.public_prayer_configs() from public;
grant execute on function public.public_prayer_configs() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- Row level security — split by command
-- -----------------------------------------------------------------------------
-- `pcc_write` was a single `for all` policy. It is replaced by three, because a
-- `for all` policy cannot stop a client from posting `status = 'published'` — and
-- reaching the published state through a direct write would bypass the archive
-- step, the reviewer stamp and the workflow. With `WITH CHECK` refusing
-- 'published', the only way to publish is public.publish_prayer_config().
--
-- pcc_select is unchanged: any *active* administrator may read the list, including
-- drafts. A signed-in user with no active admin_users row still reads nothing.
drop policy if exists pcc_write on public.prayer_calculation_configs;

drop policy if exists pcc_insert on public.prayer_calculation_configs;
create policy pcc_insert on public.prayer_calculation_configs
  for insert to authenticated
  with check (
    public.can_admin('prayer_config')
    and status = 'draft'
  );

drop policy if exists pcc_update on public.prayer_calculation_configs;
create policy pcc_update on public.prayer_calculation_configs
  for update to authenticated
  using (public.can_admin('prayer_config'))
  with check (
    public.can_admin('prayer_config')
    -- Archiving a live row is a legitimate direct write: it removes a
    -- configuration rather than putting one live. Publishing is not.
    and status in ('draft', 'archived')
  );

drop policy if exists pcc_delete on public.prayer_calculation_configs;
create policy pcc_delete on public.prayer_calculation_configs
  for delete to authenticated
  using (
    public.can_admin('prayer_config')
    and status = 'draft'
  );
