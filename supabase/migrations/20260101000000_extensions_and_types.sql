-- =============================================================================
-- Salah Admin — 0001: extensions and enumerated types
-- =============================================================================
-- Design notes
--   * Every statement in this migration set is written to be re-runnable
--     (`if not exists` / `create or replace` / guard blocks). The repository had
--     no schema when this was written, so re-running is how a partially applied
--     or hand-edited database is brought back in line — without ever dropping a
--     table that may already hold data.
--   * Enumerated types are used for closed vocabularies (roles, statuses). They
--     make an invalid value impossible to insert rather than merely discouraged.
-- =============================================================================

create extension if not exists "pgcrypto";

-- Roles recognised by the admin panel. Kept in step with
-- src/lib/permissions/roles.ts and the app's permission matrix.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'admin_role') then
    create type public.admin_role as enum (
      'super_admin',
      'location_manager',
      'content_editor',
      'prayer_data_reviewer',
      'support_admin'
    );
  end if;
end $$;

-- Publication lifecycle shared by every publishable record.
--   draft      -> editable working copy
--   published  -> live for the consumers of that record
--   archived   -> retained for history, never overwritten by a new draft
do $$
begin
  if not exists (select 1 from pg_type where typname = 'record_status') then
    create type public.record_status as enum ('draft', 'published', 'archived');
  end if;
end $$;

-- Whether a location / calendar day has been checked against a named source.
-- "unverified" is the honest default: nothing is marked verified by default.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'verification_status') then
    create type public.verification_status as enum ('unverified', 'verified', 'rejected');
  end if;
end $$;

-- A prayer calculation configuration is either the global default or an
-- override for exactly one thana/upazila.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'prayer_config_scope') then
    create type public.prayer_config_scope as enum ('global', 'thana');
  end if;
end $$;

-- Asr madhhab. Mirrors the Adhan engine's `Madhab` (SHAFI / HANAFI).
do $$
begin
  if not exists (select 1 from pg_type where typname = 'asr_madhhab') then
    create type public.asr_madhhab as enum ('shafi', 'hanafi');
  end if;
end $$;

-- High-latitude rule. Mirrors Adhan's `HighLatitudeRule`. Bangladesh does not
-- need one in practice, but the app supports it and the admin panel must be
-- able to express the app's real option set instead of inventing its own.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'high_latitude_rule') then
    create type public.high_latitude_rule as enum (
      'none',
      'middle_of_the_night',
      'seventh_of_the_night',
      'twilight_angle'
    );
  end if;
end $$;

-- Whether a Ramadan start date is the product of a calculation or of an
-- officially confirmed moon-sighting decision. These are not interchangeable
-- and the admin UI must never blur them together.
do $$
begin
  if not exists (select 1 from pg_type where typname = 'ramadan_start_type') then
    create type public.ramadan_start_type as enum ('calculated', 'officially_confirmed');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'feedback_status') then
    create type public.feedback_status as enum ('open', 'in_progress', 'resolved', 'closed');
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'announcement_type') then
    create type public.announcement_type as enum (
      'general',
      'prayer',
      'ramadan',
      'maintenance',
      'urgent'
    );
  end if;
end $$;

do $$
begin
  if not exists (select 1 from pg_type where typname = 'target_platform') then
    create type public.target_platform as enum ('android', 'all');
  end if;
end $$;
