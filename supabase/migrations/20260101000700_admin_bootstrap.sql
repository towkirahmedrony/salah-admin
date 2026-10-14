-- =============================================================================
-- Salah Admin — 0008: controlled administrator provisioning
-- =============================================================================
-- There is no public administrator registration, and there is no path by which a
-- signed-in user can make themselves an administrator.
--
-- Provisioning works like this:
--
--   1. A human with dashboard access creates the account in Supabase Auth.
--   2. The first administrator is promoted by running `bootstrap_first_admin`
--      from the Supabase SQL editor (which executes as the project owner).
--      It refuses to run once any administrator exists.
--   3. Every later administrator is promoted from the Salah Admin panel by an
--      existing super admin, which is an RLS-checked write to admin_users.
--
-- Creating Auth users needs the service-role key, so it deliberately stays out
-- of the web application: no privileged key exists anywhere in this codebase.
-- =============================================================================

create or replace function public.bootstrap_first_admin(
  p_email     text,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id    uuid;
  v_count integer;
begin
  if length(v_email) = 0 then
    raise exception 'An email address is required.' using errcode = 'check_violation';
  end if;

  select count(*) into v_count from public.admin_users;

  if v_count > 0 then
    raise exception
      'An administrator already exists. Promote further administrators from the Salah Admin panel.'
      using errcode = 'check_violation';
  end if;

  select u.id into v_id
    from auth.users u
   where lower(u.email) = v_email
   limit 1;

  if v_id is null then
    raise exception
      'No Supabase Auth user exists with email %. Create the user in Authentication > Users first.',
      v_email
      using errcode = 'check_violation';
  end if;

  insert into public.admin_users (id, email, full_name, role, is_active)
  values (v_id, v_email, nullif(btrim(coalesce(p_full_name, '')), ''), 'super_admin', true)
  on conflict (id) do update
    set role = 'super_admin',
        is_active = true,
        updated_at = now();

  insert into public.audit_logs (action, entity_table, entity_id, new_data, source)
  values (
    'bootstrap_admin',
    'admin_users',
    v_id::text,
    jsonb_build_object('email', v_email, 'role', 'super_admin', 'provisioned_by', 'sql_editor'),
    'bootstrap'
  );

  return v_id;
end;
$$;

comment on function public.bootstrap_first_admin(text, text) is
  'One-shot promotion of the very first super administrator. Owner/service-role only; refuses to run once an administrator exists.';

-- Deliberately not reachable by `anon` or `authenticated`. If it were callable by
-- a signed-in user, an empty admin_users table would be a privilege-escalation
-- window. It is executed from the SQL editor or by the service role only.
revoke all on function public.bootstrap_first_admin(text, text) from public, anon, authenticated;
grant execute on function public.bootstrap_first_admin(text, text) to service_role;

-- -----------------------------------------------------------------------------
-- Roster visibility helper
--
-- The panel needs to know whether *any* administrator exists so it can show the
-- setup state instead of a sign-in form. That check must not require a session,
-- so it is exposed as a boolean-only function: it reveals nothing about who the
-- administrators are.
-- -----------------------------------------------------------------------------
create or replace function public.administrator_roster_is_provisioned()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.admin_users where is_active);
$$;

revoke all on function public.administrator_roster_is_provisioned() from public;
grant execute on function public.administrator_roster_is_provisioned() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- provision_admin — the in-panel promotion path for later administrators.
--
-- A super admin enters the email of an existing Supabase Auth user and this
-- function creates the roster row. `auth.users` is not readable through the API,
-- so the lookup has to happen here; that is exactly why the function checks its
-- own authorization rather than relying on the caller.
-- -----------------------------------------------------------------------------
create or replace function public.provision_admin(
  p_email     text,
  p_role      public.admin_role,
  p_full_name text default null
)
returns uuid
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_email text := lower(btrim(coalesce(p_email, '')));
  v_id    uuid;
begin
  -- Authorization is checked inside the function as well as in the RLS policy,
  -- so the function is safe even if it is ever exposed more widely.
  if not public.can_admin('admins') then
    raise exception 'You are not allowed to manage administrator accounts.'
      using errcode = '42501';
  end if;

  if length(v_email) = 0 then
    raise exception 'An email address is required.' using errcode = 'check_violation';
  end if;

  select u.id into v_id
    from auth.users u
   where lower(u.email) = v_email
   limit 1;

  if v_id is null then
    raise exception
      'No Supabase Auth user exists with email %. Create the user under Authentication > Users first, then promote it here.',
      v_email
      using errcode = 'check_violation';
  end if;

  insert into public.admin_users (id, email, full_name, role, is_active)
  values (v_id, v_email, nullif(btrim(coalesce(p_full_name, '')), ''), p_role, true)
  on conflict (id) do update
    set role = excluded.role,
        is_active = true,
        full_name = coalesce(excluded.full_name, public.admin_users.full_name),
        updated_at = now();

  return v_id;
end;
$$;

comment on function public.provision_admin(text, public.admin_role, text) is
  'Promotes an existing Supabase Auth user to administrator. Requires the admins capability, checked inside the function.';

revoke all on function public.provision_admin(text, public.admin_role, text) from public, anon;
grant execute on function public.provision_admin(text, public.admin_role, text) to authenticated;
