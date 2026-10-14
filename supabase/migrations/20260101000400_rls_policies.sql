-- =============================================================================
-- Salah Admin — 0005: row level security
-- =============================================================================
-- This file is the authoritative copy of the permission matrix. The admin UI
-- renders navigation from the same matrix (src/lib/permissions/permissions.ts),
-- but hiding a link is a courtesy — these policies are what actually decide.
--
-- Guarantees established here:
--   * Every table has RLS enabled; a table with RLS on and no matching policy
--     returns nothing and accepts nothing.
--   * `anon` holds no table privileges at all. The only anonymous entry points
--     are the validated functions in 20260101000600_public_endpoints.sql.
--   * Authorization reads public.admin_users only. Session metadata is never
--     consulted, so a user cannot grant themselves a role.
--   * audit_logs is readable by super admins and writable by nobody through the
--     API — the SECURITY DEFINER trigger is the only writer.
-- =============================================================================

alter table public.admin_users               enable row level security;
alter table public.audit_logs                enable row level security;
alter table public.divisions                 enable row level security;
alter table public.districts                 enable row level security;
alter table public.thanas                    enable row level security;
alter table public.localities                enable row level security;
alter table public.prayer_calculation_configs enable row level security;
alter table public.verified_prayer_timings    enable row level security;
alter table public.ramadan_calendar_versions  enable row level security;
alter table public.ramadan_calendar_days      enable row level security;
alter table public.app_configs                enable row level security;
alter table public.announcements              enable row level security;
alter table public.feedback_reports           enable row level security;

-- -----------------------------------------------------------------------------
-- admin_users
--
-- Every active administrator may read the roster: it is needed to show who
-- assigned a feedback report, who published a calendar, and to populate the
-- assignment picker. Only a super admin may change it.
-- -----------------------------------------------------------------------------
drop policy if exists admin_users_select on public.admin_users;
create policy admin_users_select on public.admin_users
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists admin_users_insert on public.admin_users;
create policy admin_users_insert on public.admin_users
  for insert to authenticated
  with check (public.can_admin('admins'));

drop policy if exists admin_users_update on public.admin_users;
create policy admin_users_update on public.admin_users
  for update to authenticated
  using (public.can_admin('admins'))
  with check (public.can_admin('admins'));

drop policy if exists admin_users_delete on public.admin_users;
create policy admin_users_delete on public.admin_users
  for delete to authenticated
  using (public.can_admin('admins'));

-- -----------------------------------------------------------------------------
-- audit_logs — read-only through the API, for super admins only.
-- No INSERT / UPDATE / DELETE policy is created, on purpose.
-- -----------------------------------------------------------------------------
drop policy if exists audit_logs_select on public.audit_logs;
create policy audit_logs_select on public.audit_logs
  for select to authenticated
  using (public.can_admin('audit'));

-- -----------------------------------------------------------------------------
-- Geography
-- -----------------------------------------------------------------------------
drop policy if exists divisions_select on public.divisions;
create policy divisions_select on public.divisions
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists divisions_write on public.divisions;
create policy divisions_write on public.divisions
  for all to authenticated
  using (public.can_admin('locations'))
  with check (public.can_admin('locations'));

drop policy if exists districts_select on public.districts;
create policy districts_select on public.districts
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists districts_write on public.districts;
create policy districts_write on public.districts
  for all to authenticated
  using (public.can_admin('locations'))
  with check (public.can_admin('locations'));

drop policy if exists thanas_select on public.thanas;
create policy thanas_select on public.thanas
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists thanas_write on public.thanas;
create policy thanas_write on public.thanas
  for all to authenticated
  using (public.can_admin('locations'))
  with check (public.can_admin('locations'));

drop policy if exists localities_select on public.localities;
create policy localities_select on public.localities
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists localities_write on public.localities;
create policy localities_write on public.localities
  for all to authenticated
  using (public.can_admin('locations'))
  with check (public.can_admin('locations'));

-- -----------------------------------------------------------------------------
-- Prayer configuration — prayer data reviewers and super admins only.
-- -----------------------------------------------------------------------------
drop policy if exists pcc_select on public.prayer_calculation_configs;
create policy pcc_select on public.prayer_calculation_configs
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists pcc_write on public.prayer_calculation_configs;
create policy pcc_write on public.prayer_calculation_configs
  for all to authenticated
  using (public.can_admin('prayer_config'))
  with check (public.can_admin('prayer_config'));

-- -----------------------------------------------------------------------------
-- Verified prayer timetables — prayer data reviewers and super admins only.
-- -----------------------------------------------------------------------------
drop policy if exists vpt_select on public.verified_prayer_timings;
create policy vpt_select on public.verified_prayer_timings
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists vpt_write on public.verified_prayer_timings;
create policy vpt_write on public.verified_prayer_timings
  for all to authenticated
  using (public.can_admin('prayer_timings'))
  with check (public.can_admin('prayer_timings'));

-- -----------------------------------------------------------------------------
-- Ramadan calendar — prayer data reviewers and super admins only.
-- -----------------------------------------------------------------------------
drop policy if exists rcv_select on public.ramadan_calendar_versions;
create policy rcv_select on public.ramadan_calendar_versions
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists rcv_write on public.ramadan_calendar_versions;
create policy rcv_write on public.ramadan_calendar_versions
  for all to authenticated
  using (public.can_admin('ramadan'))
  with check (public.can_admin('ramadan'));

drop policy if exists rcd_select on public.ramadan_calendar_days;
create policy rcd_select on public.ramadan_calendar_days
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists rcd_write on public.ramadan_calendar_days;
create policy rcd_write on public.ramadan_calendar_days
  for all to authenticated
  using (public.can_admin('ramadan'))
  with check (public.can_admin('ramadan'));

-- -----------------------------------------------------------------------------
-- App configuration — content editors and super admins only.
-- -----------------------------------------------------------------------------
drop policy if exists app_configs_select on public.app_configs;
create policy app_configs_select on public.app_configs
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists app_configs_write on public.app_configs;
create policy app_configs_write on public.app_configs
  for all to authenticated
  using (public.can_admin('app_config'))
  with check (public.can_admin('app_config'));

-- -----------------------------------------------------------------------------
-- Announcements — content editors and super admins only.
-- -----------------------------------------------------------------------------
drop policy if exists announcements_select on public.announcements;
create policy announcements_select on public.announcements
  for select to authenticated
  using (public.is_active_admin());

drop policy if exists announcements_write on public.announcements;
create policy announcements_write on public.announcements
  for all to authenticated
  using (public.can_admin('announcements'))
  with check (public.can_admin('announcements'));

-- -----------------------------------------------------------------------------
-- Feedback reports — support admins and super admins only.
--
-- There is no DELETE policy: feedback from end users is not disposable by an
-- administrator, and the panel offers "closed" instead of removal.
-- -----------------------------------------------------------------------------
drop policy if exists feedback_select on public.feedback_reports;
create policy feedback_select on public.feedback_reports
  for select to authenticated
  using (public.can_admin('feedback'));

drop policy if exists feedback_update on public.feedback_reports;
create policy feedback_update on public.feedback_reports
  for update to authenticated
  using (public.can_admin('feedback'))
  with check (public.can_admin('feedback'));

-- -----------------------------------------------------------------------------
-- Privileges
-- -----------------------------------------------------------------------------
-- Rebuild the anon/authenticated surface explicitly instead of inheriting
-- whatever default privileges the project happens to have.
do $$
declare
  v_admin_table text;
  v_admin_tables text[] := array[
    'admin_users',
    'divisions',
    'districts',
    'thanas',
    'localities',
    'prayer_calculation_configs',
    'verified_prayer_timings',
    'ramadan_calendar_versions',
    'ramadan_calendar_days',
    'app_configs',
    'announcements',
    'feedback_reports',
    'audit_logs'
  ];
begin
  foreach v_admin_table in array v_admin_tables
  loop
    execute format('revoke all on public.%I from anon', v_admin_table);
    execute format('grant select, insert, update, delete on public.%I to authenticated', v_admin_table);
  end loop;
end $$;

-- Anonymously reachable tables: notification is via functions, not grants.
-- feedback_reports is the one table an anonymous caller can affect, and only
-- through public.submit_feedback().
revoke all on public.feedback_reports from anon;

-- Audit history is readable only. Even a super admin cannot rewrite it.
revoke insert, update, delete, truncate on public.audit_logs from authenticated;
grant select on public.audit_logs to authenticated;
grant usage, select on sequence public.audit_logs_id_seq to authenticated;

-- Sequences used by inserted tables.
do $$
declare
  v_seq_table text;
  v_seq_tables text[] := array[
    'divisions', 'districts', 'thanas', 'localities',
    'prayer_calculation_configs', 'verified_prayer_timings',
    'ramadan_calendar_versions', 'ramadan_calendar_days',
    'app_configs', 'announcements', 'feedback_reports'
  ];
begin
  foreach v_seq_table in array v_seq_tables
  loop
    -- Tables use gen_random_uuid() defaults, so there is normally no sequence.
    -- This guard keeps the migration safe if a deployment added one.
    if exists (
      select 1
      from pg_class c
      join pg_namespace n on n.oid = c.relnamespace
      where n.nspname = 'public'
        and c.relkind = 'S'
        and c.relname = v_seq_table || '_id_seq'
    ) then
      execute format(
        'grant usage, select on sequence public.%I to authenticated',
        v_seq_table || '_id_seq'
      );
    end if;
  end loop;
end $$;
