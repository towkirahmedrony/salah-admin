-- =============================================================================
-- Salah Admin — 0004: authorization helpers, audit triggers, timestamp triggers
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Public request metadata helpers
--
-- PostgREST exposes the incoming request to the database as the `request.headers`
-- GUC. Reading it inside a trigger lets an audit row carry the same request id
-- the server action logged, without the client being able to supply the actor.
-- Every read is defensive: a missing or malformed setting returns null rather
-- than raising inside a write path.
-- -----------------------------------------------------------------------------
create or replace function public.request_header(p_name text)
returns text
language plpgsql
stable
as $$
declare
  v_headers json;
begin
  if p_name is null then
    return null;
  end if;
  begin
    v_headers := current_setting('request.headers', true)::json;
  exception
    when others then
      return null;
  end;

  if v_headers is null then
    return null;
  end if;

  return v_headers ->> p_name;
end;
$$;

-- -----------------------------------------------------------------------------
-- Authorization helpers
--
-- `auth.uid()` is taken from the signed-in JWT. The role is then read from
-- public.admin_users — never from user-editable metadata — and only an *active*
-- row counts. These functions are SECURITY DEFINER so that reading the roster
-- does not itself depend on an RLS policy on admin_users (which would recurse).
-- -----------------------------------------------------------------------------
create or replace function public.is_active_admin()
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
  );
$$;

create or replace function public.current_admin_role()
returns public.admin_role
language sql
stable
security definer
set search_path = public, auth
as $$
  select u.role
  from public.admin_users u
  where u.id = auth.uid()
    and u.is_active
  limit 1;
$$;

create or replace function public.has_admin_role(variadic p_roles public.admin_role[])
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
      and u.role = any (p_roles)
  );
$$;

/**
 * Capability check used by every write policy.
 *
 * These capabilities mirror the permission matrix the admin UI renders, so the
 * sidebar cannot show a link to an action the database will refuse.
 */
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
        else false
      end
  );
$$;

comment on function public.can_admin(text) is
  'Single source of truth for write capability. Mirrors src/lib/permissions/permissions.ts.';

-- -----------------------------------------------------------------------------
-- Timestamp / actor stamping
--
-- Runs BEFORE the audit trigger so the audit row records the stamped values.
-- The row is patched through jsonb so the same function works for tables that
-- carry created_by/updated_by and for those that only carry updated_at.
-- -----------------------------------------------------------------------------
create or replace function public.touch_audit_columns()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor uuid := auth.uid();
  v_patch jsonb := '{}'::jsonb;
begin
  if tg_op = 'INSERT' then
    v_patch := v_patch || jsonb_build_object('created_at', now(), 'updated_at', now());
    if v_actor is not null then
      v_patch := v_patch || jsonb_build_object('created_by', v_actor, 'updated_by', v_actor);
    end if;
  elsif tg_op = 'UPDATE' then
    v_patch := v_patch || jsonb_build_object('updated_at', now());
    if v_actor is not null then
      v_patch := v_patch || jsonb_build_object('updated_by', v_actor);
    end if;
  else
    return new;
  end if;

  new := jsonb_populate_record(new, v_patch);
  return new;
end;
$$;

-- -----------------------------------------------------------------------------
-- Audit trail
--
-- Attached to every managed table. Because it is SECURITY DEFINER and reads the
-- actor from the JWT, a client cannot forge or suppress an audit entry: the
-- write that triggers it is the write being audited.
--
-- Audit rows carry old/new images. `feedback_reports.diagnostic_metadata` is
-- the only free-form field an untrusted client can influence, and it is passed
-- through the same redaction filter in the UI as in the API response.
-- -----------------------------------------------------------------------------
create or replace function public.audit_row_change()
returns trigger
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  v_actor  uuid := auth.uid();
  v_email  text;
  v_role   public.admin_role;
  v_action text;
  v_old    jsonb;
  v_new    jsonb;
  v_id     text;
begin
  if tg_op = 'INSERT' then
    v_action := 'create';
    v_new := to_jsonb(new);
    v_id := coalesce(v_new ->> 'id', '');
  elsif tg_op = 'UPDATE' then
    v_old := to_jsonb(old);
    v_new := to_jsonb(new);

    -- Ignore writes that only refreshed the bookkeeping columns; they are not
    -- changes an administrator made.
    if (v_old - 'updated_at' - 'updated_by') = (v_new - 'updated_at' - 'updated_by') then
      return new;
    end if;

    v_id := coalesce(v_new ->> 'id', '');
    v_action := 'update';

    if (v_old ->> 'status') is distinct from (v_new ->> 'status') then
      if (v_new ->> 'status') = 'published' then
        v_action := 'publish';
      elsif (v_new ->> 'status') = 'archived' then
        v_action := 'archive';
      elsif (v_old ->> 'status') = 'published' then
        v_action := 'unpublish';
      else
        v_action := 'status_change';
      end if;
    end if;
  else
    v_action := 'delete';
    v_old := to_jsonb(old);
    v_id := coalesce(v_old ->> 'id', '');
  end if;

  if v_actor is not null then
    select u.email, u.role
      into v_email, v_role
      from public.admin_users u
     where u.id = v_actor;
  end if;

  insert into public.audit_logs (
    actor_id, actor_email, actor_role, action,
    entity_table, entity_id, old_data, new_data,
    request_id, source
  )
  values (
    v_actor, v_email, v_role, v_action,
    tg_table_name, nullif(v_id, ''), v_old, v_new,
    public.request_header('x-request-id'), 'trigger'
  );

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end;
$$;

comment on function public.audit_row_change() is
  'Append-only audit writer. Actor comes from the JWT; old/new images are the actual row values.';

-- Attach both triggers to every managed table. Re-running drops and recreates so
-- the migration stays idempotent.
do $$
declare
  v_table text;
  v_tables text[] := array[
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
    'feedback_reports'
  ];
begin
  foreach v_table in array v_tables
  loop
    execute format('drop trigger if exists set_audit_columns on public.%I', v_table);
    execute format(
      'create trigger set_audit_columns before insert or update on public.%I
         for each row execute function public.touch_audit_columns()',
      v_table
    );

    execute format('drop trigger if exists audit_row_change on public.%I', v_table);
    execute format(
      'create trigger audit_row_change after insert or update or delete on public.%I
         for each row execute function public.audit_row_change()',
      v_table
    );
  end loop;
end $$;
