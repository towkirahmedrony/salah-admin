-- =============================================================================
-- Salah Admin — 0003: prayer configuration, timetables, Ramadan, content
-- =============================================================================

-- -----------------------------------------------------------------------------
-- prayer_calculation_configs
--
-- The Android app computes prayer times offline with its own bundled engine
-- (Adhan Kotlin). This table does NOT replace that engine: it describes the
-- *parameters* an app build understands, so a correction can be shipped as data
-- instead of as a new APK. `engine_key` / `engine_version` exist precisely so
-- the panel can refuse to publish parameters for an engine it does not know.
-- -----------------------------------------------------------------------------
create table if not exists public.prayer_calculation_configs (
  id                    uuid primary key default gen_random_uuid(),
  name                  text not null,
  scope                 public.prayer_config_scope not null default 'global',
  thana_id              uuid references public.thanas (id) on delete restrict,
  engine_key            text not null default 'adhan_kotlin',
  engine_version        text not null default '0.0.5',
  calculation_method    text,
  fajr_angle            numeric(5, 2),
  isha_angle            numeric(5, 2),
  isha_interval_minutes integer,
  asr_madhhab           public.asr_madhhab not null default 'hanafi',
  high_latitude_rule    public.high_latitude_rule not null default 'none',
  timezone              text not null default 'Asia/Dhaka',
  effective_from        date,
  effective_to          date,
  source_name           text,
  source_url            text,
  notes                 text,
  status                public.record_status not null default 'draft',
  version               integer not null default 1,
  reviewed_by           uuid references auth.users (id) on delete set null,
  reviewed_at           timestamptz,
  published_by          uuid references auth.users (id) on delete set null,
  published_at          timestamptz,
  created_at            timestamptz not null default now(),
  created_by            uuid references auth.users (id) on delete set null,
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users (id) on delete set null,
  constraint pcc_name_not_blank check (length(btrim(name)) > 0),
  constraint pcc_version_positive check (version >= 1),
  constraint pcc_angle_ranges check (
    (fajr_angle is null or (fajr_angle between 0 and 30))
    and (isha_angle is null or (isha_angle between 0 and 30))
  ),
  constraint pcc_isha_interval_range check (
    isha_interval_minutes is null
    or (isha_interval_minutes between 0 and 240)
  ),
  -- The engine takes either an Isha angle or an Isha interval, never both.
  constraint pcc_isha_exclusive check (
    isha_angle is null or isha_interval_minutes is null
  ),
  constraint pcc_effective_range check (
    effective_from is null or effective_to is null or effective_to >= effective_from
  ),
  constraint pcc_scope_target_agrees check (
    (scope = 'global' and thana_id is null)
    or (scope = 'thana' and thana_id is not null)
  ),
  constraint pcc_source_url_scheme check (source_url is null or source_url ~* '^https?://'),
  -- A published configuration must be complete enough to actually drive the
  -- engine, and must name the source it came from. Drafts are free-form.
  constraint pcc_published_is_complete check (
    status <> 'published'
    or (
      fajr_angle is not null
      and (isha_angle is not null or isha_interval_minutes is not null)
      and source_name is not null
      and length(btrim(source_name)) > 0
    )
  )
);

create index if not exists pcc_status_idx on public.prayer_calculation_configs (status);
create index if not exists pcc_thana_idx on public.prayer_calculation_configs (thana_id);
create index if not exists pcc_scope_idx on public.prayer_calculation_configs (scope);

-- At most one published global configuration, and at most one published
-- override per thana. Archived and draft versions are unlimited, which is how
-- history is preserved instead of being overwritten in place.
create unique index if not exists pcc_one_published_global
  on public.prayer_calculation_configs (scope)
  where status = 'published' and scope = 'global';
create unique index if not exists pcc_one_published_per_thana
  on public.prayer_calculation_configs (thana_id)
  where status = 'published' and scope = 'thana';

comment on table public.prayer_calculation_configs is
  'Parameter sets for the Android app''s own offline prayer engine. Publishing here never marks a schedule as religiously verified.';

-- -----------------------------------------------------------------------------
-- verified_prayer_timings
--
-- Exactly one target per row: either a thana/upazila or a locality. The
-- locality's parent thana is resolved by the app when filtering, rather than
-- treating the two columns as interchangeable.
-- -----------------------------------------------------------------------------
create table if not exists public.verified_prayer_timings (
  id          uuid primary key default gen_random_uuid(),
  thana_id    uuid references public.thanas (id) on delete restrict,
  locality_id uuid references public.localities (id) on delete restrict,
  prayer_date date not null,
  timezone    text not null default 'Asia/Dhaka',
  fajr        time not null,
  sunrise     time not null,
  dhuhr       time not null,
  asr         time not null,
  maghrib     time not null,
  isha        time not null,
  sunset      time,
  source_name text,
  source_url  text,
  notes       text,
  status      public.record_status not null default 'draft',
  version     integer not null default 1,
  verified_by uuid references auth.users (id) on delete set null,
  verified_at timestamptz,
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  constraint vpt_one_target check ((thana_id is not null) <> (locality_id is not null)),
  constraint vpt_version_positive check (version >= 1),
  constraint vpt_source_url_scheme check (source_url is null or source_url ~* '^https?://'),
  -- Chronology is enforced only for published rows so that a draft can be saved
  -- while it is being transcribed. No constraint touches `sunset`: a source may
  -- print it relative to a different definition of Maghrib, and guessing which
  -- would reject valid data.
  constraint vpt_published_chronology check (
    status <> 'published'
    or (
      fajr < sunrise
      and sunrise <= dhuhr
      and dhuhr < asr
      and asr < maghrib
      and maghrib < isha
    )
  )
);

create index if not exists vpt_date_idx on public.verified_prayer_timings (prayer_date);
create index if not exists vpt_thana_date_idx on public.verified_prayer_timings (thana_id, prayer_date);
create index if not exists vpt_locality_date_idx on public.verified_prayer_timings (locality_id, prayer_date);
create index if not exists vpt_status_idx on public.verified_prayer_timings (status);

-- One live published schedule per target per day, regardless of how many
-- historical versions exist.
create unique index if not exists vpt_one_published_per_thana_day
  on public.verified_prayer_timings (thana_id, prayer_date)
  where status = 'published' and thana_id is not null;
create unique index if not exists vpt_one_published_per_locality_day
  on public.verified_prayer_timings (locality_id, prayer_date)
  where status = 'published' and locality_id is not null;

-- -----------------------------------------------------------------------------
-- ramadan_calendar_versions / ramadan_calendar_days
-- -----------------------------------------------------------------------------
create table if not exists public.ramadan_calendar_versions (
  id                  uuid primary key default gen_random_uuid(),
  ramadan_year        integer not null,
  hijri_year          integer,
  thana_id            uuid references public.thanas (id) on delete restrict,
  expected_start_date date,
  start_date_type     public.ramadan_start_type not null default 'calculated',
  source_name         text,
  source_url          text,
  notes               text,
  status              public.record_status not null default 'draft',
  version             integer not null default 1,
  reviewed_by         uuid references auth.users (id) on delete set null,
  reviewed_at         timestamptz,
  published_by        uuid references auth.users (id) on delete set null,
  published_at        timestamptz,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,
  constraint rcv_year_range check (ramadan_year between 1900 and 2200),
  constraint rcv_hijri_year_range check (hijri_year is null or hijri_year between 1300 and 1600),
  constraint rcv_version_positive check (version >= 1),
  constraint rcv_source_url_scheme check (source_url is null or source_url ~* '^https?://'),
  -- An officially confirmed start date must cite where the confirmation came
  -- from; without that the row would be asserting a decision nobody made.
  constraint rcv_confirmed_needs_source check (
    start_date_type <> 'officially_confirmed'
    or (source_name is not null and length(btrim(source_name)) > 0)
  ),
  constraint rcv_published_is_complete check (
    status <> 'published'
    or (expected_start_date is not null and source_name is not null and length(btrim(source_name)) > 0)
  )
);

create index if not exists rcv_year_idx on public.ramadan_calendar_versions (ramadan_year);
create index if not exists rcv_status_idx on public.ramadan_calendar_versions (status);

create unique index if not exists rcv_one_published_national
  on public.ramadan_calendar_versions (ramadan_year)
  where status = 'published' and thana_id is null;
create unique index if not exists rcv_one_published_per_thana
  on public.ramadan_calendar_versions (ramadan_year, thana_id)
  where status = 'published' and thana_id is not null;

create table if not exists public.ramadan_calendar_days (
  id                  uuid primary key default gen_random_uuid(),
  version_id          uuid not null references public.ramadan_calendar_versions (id) on delete cascade,
  day_number          integer not null,
  gregorian_date      date not null,
  hijri_date          text,
  -- Imsak and Sehri-end are distinct values and are stored separately: some
  -- published calendars print both, and collapsing them would silently change
  -- the data.
  imsak_time          time,
  sehri_end_time      time,
  iftar_time          time,
  source_name         text,
  source_url          text,
  verification_status public.verification_status not null default 'unverified',
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,
  constraint rcd_day_number_range check (day_number between 1 and 30),
  constraint rcd_source_url_scheme check (source_url is null or source_url ~* '^https?://'),
  constraint rcd_imsak_before_sehri check (
    imsak_time is null or sehri_end_time is null or imsak_time <= sehri_end_time
  ),
  constraint rcd_sehri_before_iftar check (
    sehri_end_time is null or iftar_time is null or sehri_end_time < iftar_time
  ),
  -- Nothing may be marked verified while its times are still missing.
  constraint rcd_verified_has_times check (
    verification_status <> 'verified'
    or (sehri_end_time is not null and iftar_time is not null)
  )
);

create unique index if not exists rcd_version_day_key
  on public.ramadan_calendar_days (version_id, day_number);
create unique index if not exists rcd_version_date_key
  on public.ramadan_calendar_days (version_id, gregorian_date);
create index if not exists rcd_gregorian_idx on public.ramadan_calendar_days (gregorian_date);

-- -----------------------------------------------------------------------------
-- app_configs — remote configuration consumed by the Android app.
--
-- The key check is a real safeguard, not decoration: this table must never
-- become a place where an API secret is parked.
-- -----------------------------------------------------------------------------
create table if not exists public.app_configs (
  id          uuid primary key default gen_random_uuid(),
  key         text not null,
  category    text not null default 'general',
  value       jsonb not null default '{}'::jsonb,
  description text,
  is_public   boolean not null default false,
  status      public.record_status not null default 'draft',
  version     integer not null default 1,
  published_by uuid references auth.users (id) on delete set null,
  published_at timestamptz,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  constraint app_configs_key_format check (key ~ '^[a-z0-9][a-z0-9_.-]{0,95}$'),
  constraint app_configs_version_positive check (version >= 1),
  constraint app_configs_key_not_secret check (
    key !~* '(secret|token|password|passwd|credential|api[_-]?key|private[_-]?key|service[_-]?role|signing)'
  ),
  constraint app_configs_value_is_json_object check (jsonb_typeof(value) = 'object')
);

create unique index if not exists app_configs_key_key on public.app_configs (key);
create index if not exists app_configs_status_idx on public.app_configs (status);
create index if not exists app_configs_category_idx on public.app_configs (category);

comment on constraint app_configs_key_not_secret on public.app_configs is
  'Blocks keys that look like credentials. Secrets belong in the platform secret store, never in a table the app reads.';

-- -----------------------------------------------------------------------------
-- announcements
-- -----------------------------------------------------------------------------
create table if not exists public.announcements (
  id               uuid primary key default gen_random_uuid(),
  title_en         text not null,
  body_en          text not null,
  title_bn         text,
  body_bn          text,
  type             public.announcement_type not null default 'general',
  target_platform  public.target_platform not null default 'android',
  min_app_version  text,
  max_app_version  text,
  publish_at       timestamptz,
  expires_at       timestamptz,
  status           public.record_status not null default 'draft',
  version          integer not null default 1,
  published_by     uuid references auth.users (id) on delete set null,
  published_at     timestamptz,
  created_at       timestamptz not null default now(),
  created_by       uuid references auth.users (id) on delete set null,
  updated_at       timestamptz not null default now(),
  updated_by       uuid references auth.users (id) on delete set null,
  constraint announcements_title_en_not_blank check (length(btrim(title_en)) > 0),
  constraint announcements_body_en_not_blank check (length(btrim(body_en)) > 0),
  constraint announcements_version_positive check (version >= 1),
  constraint announcements_expiry_after_publish check (
    publish_at is null or expires_at is null or expires_at > publish_at
  ),
  constraint announcements_published_is_scheduled check (
    status <> 'published' or publish_at is not null
  )
);

create index if not exists announcements_status_idx on public.announcements (status);
create index if not exists announcements_publish_at_idx on public.announcements (publish_at desc);

-- -----------------------------------------------------------------------------
-- feedback_reports
--
-- Deliberately holds no latitude/longitude and no coarse location field: the
-- panel has no consent-based feature that needs an end user's position, so it
-- is not collected in the first place.
-- -----------------------------------------------------------------------------
create table if not exists public.feedback_reports (
  id                  uuid primary key default gen_random_uuid(),
  category            text not null default 'general',
  status              public.feedback_status not null default 'open',
  subject             text,
  message             text not null,
  contact_email       text,
  app_version         text,
  android_version     text,
  device_model        text,
  app_language        text,
  -- Free-form diagnostics supplied by the app build. Rendered through a
  -- redaction filter before display (see src/lib/utils/redact.ts).
  diagnostic_metadata jsonb,
  -- Client-generated idempotency key so a retried submission does not create a
  -- duplicate report.
  client_reference    text,
  assigned_to         uuid references public.admin_users (id) on delete set null,
  admin_reply         text,
  replied_by          uuid references auth.users (id) on delete set null,
  replied_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  constraint feedback_category_not_blank check (length(btrim(category)) > 0),
  constraint feedback_message_length check (
    length(btrim(message)) between 10 and 4000
  ),
  constraint feedback_client_reference_length check (
    client_reference is null or length(client_reference) between 8 and 80
  ),
  constraint feedback_reply_sets_timestamp check (
    (admin_reply is null) = (replied_at is null)
  )
);

create unique index if not exists feedback_client_reference_key
  on public.feedback_reports (client_reference) where client_reference is not null;
create index if not exists feedback_status_idx on public.feedback_reports (status);
create index if not exists feedback_category_idx on public.feedback_reports (category);
create index if not exists feedback_created_at_idx on public.feedback_reports (created_at desc);
create index if not exists feedback_assigned_idx on public.feedback_reports (assigned_to);
