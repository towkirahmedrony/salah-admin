-- =============================================================================
-- Salah Admin — 0008: prayer calculation configuration contract
-- =============================================================================
-- Purpose
--
-- `prayer_calculation_configs` was created in 20260101000200 with a shape that the
-- Android app's engine cannot actually read. Specifically:
--
--   * `calculation_method` was free text, and `fajr_angle` / `isha_angle` were
--     free-form numerics the operator typed. The Android engine
--     (Adhan Kotlin 0.0.5, vendored as `com.batoulapps.adhan:adhan2`) accepts a
--     method *identity* only and derives its own angles — it has no API for an
--     arbitrary angle. Publishing a typed angle therefore defined a contract the
--     app could never honour, which is worse than publishing nothing.
--   * `pcc_published_is_complete` *required* `fajr_angle is not null`, which
--     forced exactly that wrong shape on every published row.
--   * `high_latitude_rule` had a `none` member described as "undefined at extreme
--     latitudes". The engine has no "off": its `AUTOMATIC` maps to a `null` rule,
--     and the engine then applies the rule it recommends for the latitude. The old
--     label described behaviour the engine does not have.
--   * Only `thana` scope existed. Reading the Android location model
--     (`core/model/LocationInfo.kt`, `BangladeshAreaRef`) shows the app persists
--     `divisionId`, `districtId` and an optional `upazilaId` as OCHA p-codes — the
--     same p-codes this schema stores in `divisions.code`, `districts.code` and
--     `thanas.code`. Division and district overrides are therefore resolvable and
--     were missing; `locality` genuinely is not resolvable and stays out (the app's
--     locality reference carries no stable id — it comes from an OpenStreetMap
--     neighbourhood layer). See docs/PRAYER_CONFIGURATION.md section 3.
--   * There was no per-prayer adjustment, although the engine supports one per
--     obligatory prayer clamped to +/-60 minutes.
--
-- This migration corrects the contract. It is written to be re-runnable: every
-- statement is guarded on an existence check, and the enum swap is skipped entirely
-- once it has happened. Nothing is dropped that may hold data, and no existing
-- value is silently coerced.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. prayer_calculation_method — the engine's method set, verbatim
-- -----------------------------------------------------------------------------
-- Labels are snake_case so they map one-to-one onto the Android enum members and
-- onto the panel's TypeScript union without a translation table in either place.
-- The angle values live in the Android enum, not here; this type carries identity.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'prayer_calculation_method') then
    create type public.prayer_calculation_method as enum (
      'karachi',
      'muslim_world_league',
      'egyptian',
      'umm_al_qura',
      'dubai',
      'moon_sighting_committee',
      'north_america',
      'kuwait',
      'qatar',
      'singapore',
      'turkey'
    );
  end if;
end $$;

comment on type public.prayer_calculation_method is
  'The calculation methods the Android engine ships. Mirrors PrayerCalculationMethod in the prayer repository; the engine owns the angles.';

-- -----------------------------------------------------------------------------
-- 2. calculation_method: text -> enum
-- -----------------------------------------------------------------------------
-- A value that is not one of the engine's methods is set to NULL, and a NOTICE is
-- raised naming how many rows were affected. NULL is not a default: the
-- completeness constraint then refuses to publish that row until an administrator
-- selects a real method, so the problem surfaces instead of being papered over.
do $$
declare
  v_unmapped integer := 0;
  v_column_type text;
begin
  select data_type
    into v_column_type
    from information_schema.columns
   where table_schema = 'public'
     and table_name = 'prayer_calculation_configs'
     and column_name = 'calculation_method';

  if v_column_type = 'text' then
    select count(*)
      into v_unmapped
      from public.prayer_calculation_configs
     where calculation_method is not null
       and calculation_method not in (
         'karachi', 'muslim_world_league', 'egyptian', 'umm_al_qura', 'dubai',
         'moon_sighting_committee', 'north_america', 'kuwait', 'qatar',
         'singapore', 'turkey'
       );

    if v_unmapped > 0 then
      raise notice
        'prayer_calculation_configs: % row(s) had a calculation_method the engine does not implement. They were set to NULL and cannot be published until a method is chosen.',
        v_unmapped;
    end if;

    alter table public.prayer_calculation_configs
      alter column calculation_method type public.prayer_calculation_method
      using (
        case
          when calculation_method in (
            'karachi', 'muslim_world_league', 'egyptian', 'umm_al_qura', 'dubai',
            'moon_sighting_committee', 'north_america', 'kuwait', 'qatar',
            'singapore', 'turkey'
          )
          then calculation_method::public.prayer_calculation_method
          else null
        end
      );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 3. high_latitude_rule: 'none' -> 'automatic'
-- -----------------------------------------------------------------------------
-- RENAME VALUE rather than a type swap, because the change is purely a
-- correction of a misleading label: a row that stored `none` meant "let the engine
-- choose", which is exactly what `automatic` now says. Existing rows keep their
-- meaning and no data is rewritten.
do $$
begin
  if exists (
    select 1
      from pg_enum e
      join pg_type t on t.oid = e.enumtypid
     where t.typname = 'high_latitude_rule'
       and e.enumlabel = 'none'
  ) then
    execute 'alter type public.high_latitude_rule rename value ''none'' to ''automatic''';
  end if;
end $$;

alter table public.prayer_calculation_configs
  alter column high_latitude_rule set default 'automatic';

comment on type public.high_latitude_rule is
  'High-latitude twilight bound. Mirrors HighLatitudeRule in the prayer repository. `automatic` is the engine''s null rule: it applies the rule recommended for the latitude. There is no "off".';

-- -----------------------------------------------------------------------------
-- 4. prayer_config_scope: add division and district
-- -----------------------------------------------------------------------------
-- A type swap rather than `add value`, because PostgreSQL forbids using a value
-- added to an existing enum inside the same transaction — and this migration must
-- be able to create the dependent indexes immediately.
--
-- The indexes and constraints below reference literals of this type, so they hold a
-- dependency on it and must be dropped first. All are recreated at the end.
do $$
declare
  v_has_division boolean := false;
begin
  if exists (select 1 from pg_type where typname = 'prayer_config_scope') then
    v_has_division := exists (
      select 1
        from pg_enum e
        join pg_type t on t.oid = e.enumtypid
       where t.typname = 'prayer_config_scope'
         and e.enumlabel = 'division'
    );
  end if;

  -- Already migrated: nothing to do, and re-running must not touch the data.
  if v_has_division then
    return;
  end if;

  if not exists (select 1 from pg_type where typname = 'prayer_config_scope') then
    return;
  end if;

  -- The existing public RPC returns prayer_config_scope, so it depends on the
  -- old enum and must be recreated after the enum swap by migration 0009.
  execute 'drop function if exists public.public_prayer_configs()';

  -- 1. Remove every object that holds a dependency on the old type. Index
  --    predicates and CHECK expressions use literals of it, so they genuinely
  --    block the drop; all are recreated later in this migration.
  execute 'drop index if exists public.pcc_one_published_global';
  execute 'drop index if exists public.pcc_one_published_per_thana';
  execute 'drop index if exists public.pcc_scope_idx';

  execute 'alter table public.prayer_calculation_configs
             drop constraint if exists pcc_scope_target_agrees';

  execute 'alter table public.prayer_calculation_configs
             alter column scope drop default';

  -- 2. Create the replacement fully formed. A new type can be used in the same
  --    transaction; only a value *added* to an existing enum cannot.
  execute 'create type public.prayer_config_scope_v2 as enum (
             ''global'', ''division'', ''district'', ''thana''
           )';

  -- 3. Move the column across. 'global' and 'thana' exist in both types, so the
  --    cast is total and no existing row changes meaning.
  execute 'alter table public.prayer_calculation_configs
             alter column scope type public.prayer_config_scope_v2
             using scope::text::public.prayer_config_scope_v2';

  -- 4. The old type now has no dependents.
  execute 'drop type public.prayer_config_scope';
  execute 'alter type public.prayer_config_scope_v2 rename to prayer_config_scope';

  execute 'alter table public.prayer_calculation_configs
             alter column scope set default ''global''';
end $$;

alter table public.prayer_calculation_configs
  alter column scope set default 'global';

comment on type public.prayer_config_scope is
  'Scope of a prayer configuration: global, one division, one district, or one thana/upazila. `locality` is deliberately absent — the Android app has no stable locality key.';

-- -----------------------------------------------------------------------------
-- 5. Scope target columns
-- -----------------------------------------------------------------------------
-- Separate, real foreign keys per level rather than one polymorphic `scope_id`.
-- A polymorphic column cannot be a foreign key, so integrity would move into
-- application code — the one place this project refuses to rely on.
alter table public.prayer_calculation_configs
  add column if not exists division_id uuid references public.divisions (id) on delete restrict;
alter table public.prayer_calculation_configs
  add column if not exists district_id uuid references public.districts (id) on delete restrict;

-- -----------------------------------------------------------------------------
-- 6. Per-prayer adjustments
-- -----------------------------------------------------------------------------
-- The engine takes one correction per obligatory prayer, clamped to +/-60 minutes
-- (PrayerSettings.MAX_ADJUSTMENT_MINUTES). 0 means "no correction", which is what
-- the engine's own lookup returns for an absent entry — so 0 and absent are the same
-- thing and there is no third state to model.
do $$
declare
  v_prayer text;
  v_prayers text[] := array['fajr', 'dhuhr', 'asr', 'maghrib', 'isha'];
begin
  foreach v_prayer in array v_prayers
  loop
    execute format(
      'alter table public.prayer_calculation_configs add column if not exists adjust_%s integer not null default 0',
      v_prayer
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- 7. Payload schema version
-- -----------------------------------------------------------------------------
alter table public.prayer_calculation_configs
  add column if not exists schema_version integer not null default 1;

-- -----------------------------------------------------------------------------
-- 8. Invariants
-- -----------------------------------------------------------------------------
do $$
begin
  -- The old constraint required a typed Fajr angle, which is exactly the contract
  -- the engine cannot read. Replaced by one that requires the things the engine
  -- actually consumes.
  alter table public.prayer_calculation_configs
    drop constraint if exists pcc_published_is_complete;

  if not exists (
    select 1 from pg_constraint where conname = 'pcc_published_is_complete'
  ) then
    alter table public.prayer_calculation_configs
      add constraint pcc_published_is_complete check (
        status <> 'published'
        or (
          calculation_method is not null
          and engine_key is not null
          and length(btrim(engine_key)) > 0
          and engine_version is not null
          and length(btrim(engine_version)) > 0
          and timezone is not null
          and length(btrim(timezone)) > 0
          and source_name is not null
          and length(btrim(source_name)) > 0
          and effective_from is not null
          and (isha_angle is not null or isha_interval_minutes is not null)
        )
      );
  end if;

  -- Exactly the target column matching the scope is set. Replaces the two-way
  -- version from 000200 now that there are four scopes.
  alter table public.prayer_calculation_configs
    drop constraint if exists pcc_scope_target_agrees;

  if not exists (
    select 1 from pg_constraint where conname = 'pcc_scope_target_agrees'
  ) then
    alter table public.prayer_calculation_configs
      add constraint pcc_scope_target_agrees check (
        (scope = 'global'
          and division_id is null and district_id is null and thana_id is null)
        or (scope = 'division'
          and division_id is not null and district_id is null and thana_id is null)
        or (scope = 'district'
          and district_id is not null and division_id is null and thana_id is null)
        or (scope = 'thana'
          and thana_id is not null and division_id is null and district_id is null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'pcc_adjustments_within_engine_limit'
  ) then
    alter table public.prayer_calculation_configs
      add constraint pcc_adjustments_within_engine_limit check (
        adjust_fajr between -60 and 60
        and adjust_dhuhr between -60 and 60
        and adjust_asr between -60 and 60
        and adjust_maghrib between -60 and 60
        and adjust_isha between -60 and 60
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'pcc_schema_version_sane'
  ) then
    alter table public.prayer_calculation_configs
      add constraint pcc_schema_version_sane check (
        schema_version >= 1 and schema_version <= 1000
      );
  end if;
end $$;

-- -----------------------------------------------------------------------------
-- 9. Derived angles
-- -----------------------------------------------------------------------------
-- `fajr_angle` and `isha_angle` are a mirror of the constants the engine ships for
-- the selected method. They are computed here, on every write, so they cannot
-- disagree with what the app will actually do — including for a write made directly
-- in the SQL editor. They are kept rather than dropped so the effective angles stay
-- auditable without reading Kotlin source; the panel's form shows them read-only.
--
-- `isha_angle` and `isha_interval_minutes` are mutually exclusive on purpose: for
-- Umm al-Qura and Qatar the engine defines Isha as an interval, for every other
-- method as an angle.
create or replace function public.derive_prayer_config_angles()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_fajr_angle numeric(5,2);
  v_isha_angle numeric(5,2);
  v_isha_interval integer;
begin
  case new.calculation_method
    when 'karachi'                then v_fajr_angle := 18.0; v_isha_angle := 18.0;
    when 'muslim_world_league'    then v_fajr_angle := 18.0; v_isha_angle := 17.0;
    when 'egyptian'               then v_fajr_angle := 19.5; v_isha_angle := 17.5;
    when 'umm_al_qura'            then v_fajr_angle := 18.5; v_isha_interval := 90;
    when 'dubai'                  then v_fajr_angle := 18.2; v_isha_angle := 18.2;
    when 'moon_sighting_committee' then v_fajr_angle := 18.0; v_isha_angle := 18.0;
    when 'north_america'          then v_fajr_angle := 15.0; v_isha_angle := 15.0;
    when 'kuwait'                 then v_fajr_angle := 18.0; v_isha_angle := 17.5;
    when 'qatar'                  then v_fajr_angle := 18.0; v_isha_interval := 90;
    when 'singapore'              then v_fajr_angle := 20.0; v_isha_angle := 18.0;
    when 'turkey'                 then v_fajr_angle := 18.0; v_isha_angle := 17.0;
    else v_fajr_angle := null; v_isha_angle := null; v_isha_interval := null;
  end case;

  new.fajr_angle := v_fajr_angle;
  new.isha_angle := v_isha_angle;
  new.isha_interval_minutes := v_isha_interval;

  return new;
end;
$$;

comment on function public.derive_prayer_config_angles() is
  'Derives fajr_angle / isha_angle / isha_interval_minutes from calculation_method. The engine owns these constants; the table only mirrors them.';

drop trigger if exists derive_prayer_config_angles on public.prayer_calculation_configs;
create trigger derive_prayer_config_angles
  before insert or update on public.prayer_calculation_configs
  for each row execute function public.derive_prayer_config_angles();

-- -----------------------------------------------------------------------------
-- 10. Immutability of published rows, and draft-only deletion
-- -----------------------------------------------------------------------------
-- "Updating a published configuration must create a new version; it must not
-- silently rewrite historical published data." A trigger is the only place that can
-- hold for every writer, including a raw SQL editor session.
create or replace function public.guard_pcc_immutable()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_before jsonb;
  v_after jsonb;
begin
  -- A draft is the working copy: it is editable by definition.
  if old.status = 'draft' then
    return new;
  end if;

  -- A status transition is the workflow (draft -> published, published ->
  -- archived), not an edit. Publishing and archiving each go through their own
  -- SECURITY DEFINER function so the transition and what it implies happen together.
  if old.status is distinct from new.status then
    return new;
  end if;

  -- Anything else is a content edit of a row that is no longer a draft: published
  -- (what the app is using) or archived (the record of what it used). Both are
  -- frozen, so history cannot be rewritten in place.

  v_before := to_jsonb(old) - 'updated_at' - 'updated_by'
                           - 'published_at' - 'published_by'
                           - 'reviewed_at' - 'reviewed_by';
  v_after := to_jsonb(new) - 'updated_at' - 'updated_by'
                          - 'published_at' - 'published_by'
                          - 'reviewed_at' - 'reviewed_by';

  if v_before is distinct from v_after then
    raise exception
      'A configuration that has been published or archived is immutable. Create a new draft version instead of editing it.'
      using errcode = 'check_violation';
  end if;

  return new;
end;
$$;

comment on function public.guard_pcc_immutable() is
  'Freezes the content of every prayer configuration that is no longer a draft, so a published row and its archived history cannot be rewritten in place.';

drop trigger if exists guard_pcc_immutable on public.prayer_calculation_configs;
create trigger guard_pcc_immutable
  before update on public.prayer_calculation_configs
  for each row execute function public.guard_pcc_immutable();

-- Only a draft is disposable. A published row is history; an archived row is the
-- record of what was live and when.
create or replace function public.guard_pcc_delete()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.status <> 'draft' then
    raise exception
      'Only a draft prayer configuration can be deleted. Archive a published configuration instead.'
      using errcode = 'check_violation';
  end if;
  return old;
end;
$$;

drop trigger if exists guard_pcc_delete on public.prayer_calculation_configs;
create trigger guard_pcc_delete
  before delete on public.prayer_calculation_configs
  for each row execute function public.guard_pcc_delete();

-- -----------------------------------------------------------------------------
-- 11. Indexes
-- -----------------------------------------------------------------------------
-- Recreated after the enum swap. Scope-target indexes support the FKs and the
-- "is there a published override here?" lookup; the effective-period index supports
-- the resolution query; `updated_at` supports the default list ordering.
create index if not exists pcc_scope_idx
  on public.prayer_calculation_configs (scope);
create index if not exists pcc_division_idx
  on public.prayer_calculation_configs (division_id);
create index if not exists pcc_district_idx
  on public.prayer_calculation_configs (district_id);
create index if not exists pcc_updated_at_idx
  on public.prayer_calculation_configs (updated_at desc);
create index if not exists pcc_effective_idx
  on public.prayer_calculation_configs (effective_from, effective_to);

-- At most one published configuration per scope target. This is what makes
-- "which configuration applies?" deterministic: resolution never has to break a tie.
create unique index if not exists pcc_one_published_global
  on public.prayer_calculation_configs (scope)
  where status = 'published' and scope = 'global';
create unique index if not exists pcc_one_published_per_division
  on public.prayer_calculation_configs (division_id)
  where status = 'published' and scope = 'division';
create unique index if not exists pcc_one_published_per_district
  on public.prayer_calculation_configs (district_id)
  where status = 'published' and scope = 'district';
create unique index if not exists pcc_one_published_per_thana
  on public.prayer_calculation_configs (thana_id)
  where status = 'published' and scope = 'thana';
