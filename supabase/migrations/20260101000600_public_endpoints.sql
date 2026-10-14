-- =============================================================================
-- Salah Admin — 0007: anonymous entry points
-- =============================================================================
-- Anonymous callers — a feedback form and, later, the Salah Android app — need
-- a narrow, validated way in. They do not get table privileges. Instead:
--
--   * `anon` holds no privilege on any table in public.
--   * The only reachable objects are the SECURITY DEFINER functions below,
--     which fix every privileged column themselves (status, assignment,
--     publication stamps) and validate everything a caller can influence.
--
-- That is a deliberately smaller surface than an RLS INSERT policy, because RLS
-- cannot restrict which *columns* a caller sets, while a function can.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- submit_feedback — the public feedback endpoint.
--
-- Called by the admin panel's own POST /api/feedback route, and by any future
-- in-app feedback form. Returns the created id plus a duplicate flag so a
-- retried submission does not create a second report.
-- -----------------------------------------------------------------------------
create or replace function public.submit_feedback(
  p_message           text,
  p_category          text default 'general',
  p_subject           text default null,
  p_contact_email     text default null,
  p_app_version       text default null,
  p_android_version   text default null,
  p_device_model      text default null,
  p_app_language      text default null,
  p_diagnostics       jsonb default null,
  p_client_reference  text default null
)
returns table (feedback_id uuid, was_duplicate boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_message   text := btrim(coalesce(p_message, ''));
  v_category  text := lower(btrim(coalesce(p_category, 'general')));
  v_subject   text := nullif(btrim(coalesce(p_subject, '')), '');
  v_email     text := nullif(lower(btrim(coalesce(p_contact_email, ''))), '');
  v_ref       text := nullif(btrim(coalesce(p_client_reference, '')), '');
  v_diag      jsonb := '{}'::jsonb;
  v_existing  uuid;
  v_new_id    uuid;
begin
  -- --- validation -----------------------------------------------------------
  if length(v_message) < 10 then
    raise exception 'Please describe the issue in at least 10 characters.'
      using errcode = 'check_violation';
  end if;

  if length(v_message) > 4000 then
    raise exception 'Feedback messages are limited to 4000 characters.'
      using errcode = 'check_violation';
  end if;

  if length(v_category) = 0 or length(v_category) > 40 then
    raise exception 'Invalid feedback category.' using errcode = 'check_violation';
  end if;

  if v_subject is not null and length(v_subject) > 200 then
    raise exception 'Feedback subjects are limited to 200 characters.'
      using errcode = 'check_violation';
  end if;

  if v_email is not null and (length(v_email) > 200 or v_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$') then
    raise exception 'Please provide a valid contact email address, or leave it blank.'
      using errcode = 'check_violation';
  end if;

  if v_ref is not null and v_ref !~ '^[A-Za-z0-9_-]{8,80}$' then
    raise exception 'Invalid client reference.' using errcode = 'check_violation';
  end if;

  -- --- diagnostics ----------------------------------------------------------
  -- A caller can influence this field, so it is filtered on the way in as well
  -- as on the way out: credential-looking keys never reach the table at all.
  if p_diagnostics is not null and jsonb_typeof(p_diagnostics) = 'object' then
    if octet_length(p_diagnostics::text) > 4096 then
      raise exception 'Diagnostic payload is too large.' using errcode = 'check_violation';
    end if;

    select coalesce(jsonb_object_agg(e.key, e.value), '{}'::jsonb)
      into v_diag
      from jsonb_each(p_diagnostics) as e(key, value)
     where e.key !~* '(secret|token|password|passwd|credential|api[_-]?key|private[_-]?key|authorization|bearer|cookie|session)'
       and length(e.key) <= 64;
  end if;

  -- --- idempotency ----------------------------------------------------------
  if v_ref is not null then
    select fr.id into v_existing
      from public.feedback_reports fr
     where fr.client_reference = v_ref
     limit 1;

    if v_existing is not null then
      return query select v_existing, true;
      return;
    end if;
  end if;

  -- --- insert ---------------------------------------------------------------
  -- Everything privileged is set here and cannot be supplied by the caller:
  -- status, assignment and the administrative reply are all forced.
  insert into public.feedback_reports (
    category, status, subject, message, contact_email,
    app_version, android_version, device_model, app_language,
    diagnostic_metadata, client_reference,
    assigned_to, admin_reply, replied_at, replied_by
  )
  values (
    v_category, 'open', v_subject, v_message, v_email,
    nullif(btrim(coalesce(p_app_version, '')), ''),
    nullif(btrim(coalesce(p_android_version, '')), ''),
    nullif(btrim(coalesce(p_device_model, '')), ''),
    nullif(btrim(coalesce(p_app_language, '')), ''),
    v_diag, v_ref,
    null, null, null, null
  )
  returning id into v_new_id;

  return query select v_new_id, false;
end;
$$;

comment on function public.submit_feedback(text, text, text, text, text, text, text, text, jsonb, text) is
  'Validated anonymous feedback intake. Cannot set status, assignment or reply; credential-looking diagnostic keys are stripped on the way in.';

revoke all on function public.submit_feedback(text, text, text, text, text, text, text, text, jsonb, text) from public;
grant execute on function public.submit_feedback(text, text, text, text, text, text, text, text, jsonb, text) to anon, authenticated;

-- -----------------------------------------------------------------------------
-- public_app_configs — the read contract for published, public configuration.
--
-- Only rows explicitly marked `is_public` *and* published are visible. A row
-- that is private, draft or archived is unreachable from here even if its key
-- is guessed, and `description` is not exposed because it is internal notes.
-- -----------------------------------------------------------------------------
create or replace function public.public_app_configs()
returns table (
  key          text,
  category     text,
  value        jsonb,
  version      integer,
  published_at timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select c.key, c.category, c.value, c.version, c.published_at
    from public.app_configs c
   where c.is_public
     and c.status = 'published'
   order by c.key;
$$;

revoke all on function public.public_app_configs() from public;
grant execute on function public.public_app_configs() to anon, authenticated;

-- -----------------------------------------------------------------------------
-- public_announcements — announcements currently scheduled to be visible.
--
-- Expiry is enforced by the query, not by a client remembering to filter.
-- -----------------------------------------------------------------------------
create or replace function public.public_announcements()
returns table (
  id              uuid,
  title_en        text,
  body_en         text,
  title_bn        text,
  body_bn         text,
  type            public.announcement_type,
  target_platform public.target_platform,
  min_app_version text,
  max_app_version text,
  publish_at      timestamptz,
  expires_at      timestamptz
)
language sql
stable
security definer
set search_path = public
as $$
  select a.id, a.title_en, a.body_en, a.title_bn, a.body_bn,
         a.type, a.target_platform, a.min_app_version, a.max_app_version,
         a.publish_at, a.expires_at
    from public.announcements a
   where a.status = 'published'
     and (a.publish_at is null or a.publish_at <= now())
     and (a.expires_at is null or a.expires_at > now())
   order by a.publish_at desc nulls last;
$$;

revoke all on function public.public_announcements() from public;
grant execute on function public.public_announcements() to anon, authenticated;
