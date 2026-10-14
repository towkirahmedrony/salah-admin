-- =============================================================================
-- Salah Admin — 0006: publication review guards and account lockout protection
-- =============================================================================
-- A database CHECK constraint is the only place a rule cannot be forgotten. The
-- guards below make the following statements true no matter which client, which
-- API path, or which human wrote the row:
--
--   1. A published record always records who published it and when.
--   2. A published prayer configuration, timetable or Ramadan version always
--      records who reviewed it. Publishing without a reviewer is impossible.
--   3. An administrator cannot deactivate or demote their own account, so a
--      single mis-click cannot lock the panel out of its last super admin.
--   4. Demoting or deactivating the *last* active super admin is refused.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Reviewed/published stamping
--
-- Patched through jsonb rather than through typed field access so one function
-- can serve tables that have `reviewed_by` and tables that do not.
-- -----------------------------------------------------------------------------
create or replace function public.stamp_publish_metadata()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
begin
  if new.status is distinct from old.status then
    if new.status = 'published' then
      new := jsonb_populate_record(
        new,
        jsonb_build_object('published_at', now(), 'published_by', v_actor)
      );

      -- Tables that carry an explicit review step.
      if tg_table_name in (
        'prayer_calculation_configs',
        'verified_prayer_timings',
        'ramadan_calendar_versions'
      ) then
        if (to_jsonb(new) ->> 'reviewed_by') is null then
          new := jsonb_populate_record(
            new,
            jsonb_build_object('reviewed_by', v_actor, 'reviewed_at', now())
          );
        end if;
      end if;

      -- The timetable additionally records a separate verification stamp.
      if tg_table_name = 'verified_prayer_timings' then
        if (to_jsonb(new) ->> 'verified_by') is null then
          new := jsonb_populate_record(
            new,
            jsonb_build_object('verified_by', v_actor, 'verified_at', now())
          );
        end if;
      end if;

    elsif old.status = 'published' then
      -- Leaving the published state clears the live publication stamps so a
      -- draft never claims to be live. The full history remains in audit_logs.
      new := jsonb_populate_record(
        new,
        jsonb_build_object('published_at', null, 'published_by', null)
      );
    end if;
  end if;

  return new;
end;
$$;

comment on function public.stamp_publish_metadata() is
  'Stamps publisher/reviewer identity on the published transition. Identity comes from the JWT, never from the request body.';

do $$
declare
  v_table text;
  v_tables text[] := array[
    'prayer_calculation_configs',
    'verified_prayer_timings',
    'ramadan_calendar_versions',
    'app_configs',
    'announcements'
  ];
begin
  foreach v_table in array v_tables
  loop
    execute format('drop trigger if exists stamp_publish_metadata on public.%I', v_table);
    execute format(
      'create trigger stamp_publish_metadata before update on public.%I
         for each row execute function public.stamp_publish_metadata()',
      v_table
    );
  end loop;
end $$;

-- -----------------------------------------------------------------------------
-- "Published implies reviewed and stamped" as hard constraints.
-- -----------------------------------------------------------------------------

-- `day_count` is derived from the detail rows, so it is maintained by a trigger
-- rather than trusted from a form. Created before the constraint that reads it.
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_schema = 'public'
      and table_name = 'ramadan_calendar_versions'
      and column_name = 'day_count'
  ) then
    alter table public.ramadan_calendar_versions add column day_count integer;
  end if;
end $$;

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'pcc_published_needs_reviewer'
  ) then
    alter table public.prayer_calculation_configs
      add constraint pcc_published_needs_reviewer check (
        status <> 'published'
        or (reviewed_by is not null and reviewed_at is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'vpt_published_needs_reviewer'
  ) then
    alter table public.verified_prayer_timings
      add constraint vpt_published_needs_reviewer check (
        status <> 'published'
        or (reviewed_by is not null and reviewed_at is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'rcv_published_needs_reviewer'
  ) then
    alter table public.ramadan_calendar_versions
      add constraint rcv_published_needs_reviewer check (
        status <> 'published'
        or (reviewed_by is not null and reviewed_at is not null)
      );
  end if;

  if not exists (
    select 1 from pg_constraint where conname = 'rcv_published_day_count_sane'
  ) then
    -- A published Ramadan calendar is either 29 or 30 days. Nothing else is a
    -- Ramadan month, and this catches an empty template being published by
    -- accident.
    alter table public.ramadan_calendar_versions
      add constraint rcv_published_day_count_sane check (
        status <> 'published' or day_count in (29, 30)
      );
  end if;
end $$;

-- `day_count` is derived, so it is maintained rather than trusted from a form.
create or replace function public.sync_ramadan_version_day_count()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_version_id uuid := coalesce(new.version_id, old.version_id);
  v_days integer;
begin
  select count(*) into v_days
  from public.ramadan_calendar_days
  where version_id = v_version_id;

  -- The version update is a normal UPDATE, so stamp_publish_metadata and the
  -- audit trigger see a real change and record it.
  update public.ramadan_calendar_versions
     set day_count = v_days
   where id = v_version_id
     and day_count is distinct from v_days;

  return null;
end;
$$;

drop trigger if exists sync_ramadan_day_count on public.ramadan_calendar_days;
create trigger sync_ramadan_day_count
  after insert or update or delete on public.ramadan_calendar_days
  for each row execute function public.sync_ramadan_version_day_count();

-- -----------------------------------------------------------------------------
-- Administrator lockout protection
-- -----------------------------------------------------------------------------
create or replace function public.guard_admin_account_safety()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_other_supers integer;
begin
  -- `auth.uid()` is null for migrations, the SQL editor and service-role
  -- maintenance, which are trusted, out-of-band operations.
  if v_actor is null then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'UPDATE' and old.id = v_actor then
    if new.is_active = false and old.is_active = true then
      raise exception 'You cannot deactivate your own administrator account.'
        using errcode = 'check_violation';
    end if;
    if new.role is distinct from old.role then
      raise exception 'You cannot change your own administrator role.'
        using errcode = 'check_violation';
    end if;
  end if;

  -- Refuse any change that would remove the last active super admin.
  if (tg_op = 'DELETE')
     or (old.role = 'super_admin' and old.is_active)
  then
    if (tg_op = 'DELETE' and old.role = 'super_admin' and old.is_active)
       or (tg_op = 'UPDATE' and old.role = 'super_admin' and old.is_active)
    then
      select count(*) into v_other_supers
      from public.admin_users
      where role = 'super_admin'
        and is_active
        and id <> old.id;

      if v_other_supers = 0 then
        raise exception 'The last active super administrator cannot be removed or demoted.'
          using errcode = 'check_violation';
      end if;
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end;
$$;

drop trigger if exists guard_admin_account_safety on public.admin_users;
create trigger guard_admin_account_safety
  before update or delete on public.admin_users
  for each row execute function public.guard_admin_account_safety();
