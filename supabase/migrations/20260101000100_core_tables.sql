-- =============================================================================
-- Salah Admin — 0002: administrator identity, audit trail, geography
-- =============================================================================

-- -----------------------------------------------------------------------------
-- admin_users — the only source of administrative authorization.
--
-- Authorization never reads `auth.users.raw_user_meta_data` or any other field a
-- signed-in user can edit about themselves. A session proves *who* someone is;
-- this table decides *what* they may do, and only a super admin can write to it.
-- -----------------------------------------------------------------------------
create table if not exists public.admin_users (
  id          uuid primary key references auth.users (id) on delete cascade,
  email       text not null,
  full_name   text,
  role        public.admin_role not null default 'support_admin',
  is_active   boolean not null default true,
  notes       text,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  constraint admin_users_email_is_lowercase check (email = lower(email)),
  constraint admin_users_email_not_blank check (length(btrim(email)) >= 3)
);

create unique index if not exists admin_users_email_key
  on public.admin_users (lower(email));

comment on table public.admin_users is
  'Administrator roster. A signed-in user with no active row here is not an administrator, regardless of session state.';

-- -----------------------------------------------------------------------------
-- audit_logs — append-only history.
--
-- Rows are written by the `audit_row_change` trigger (see 0004), which runs as
-- the table owner and captures the real JWT actor. There is deliberately no
-- UPDATE or DELETE policy: an administrator cannot rewrite history from the
-- admin panel. Only super admins may read it.
-- -----------------------------------------------------------------------------
create table if not exists public.audit_logs (
  id           bigserial primary key,
  occurred_at  timestamptz not null default now(),
  actor_id     uuid,
  actor_email  text,
  actor_role   public.admin_role,
  action       text not null,
  entity_table text not null,
  entity_id    text,
  old_data     jsonb,
  new_data     jsonb,
  request_id   text,
  source       text not null default 'trigger',
  constraint audit_logs_action_not_blank check (length(btrim(action)) > 0),
  constraint audit_logs_source_known check (source in ('trigger', 'server_action', 'bootstrap'))
);

create index if not exists audit_logs_occurred_at_idx
  on public.audit_logs (occurred_at desc);
create index if not exists audit_logs_entity_idx
  on public.audit_logs (entity_table, entity_id);
create index if not exists audit_logs_actor_idx
  on public.audit_logs (actor_id);

comment on table public.audit_logs is
  'Append-only audit trail. Written by SECURITY DEFINER triggers so the actor is the authenticated JWT, not client-supplied data.';

-- -----------------------------------------------------------------------------
-- Geography: Division -> District -> Thana/Upazila -> Locality
--
-- Delete rules are `restrict` on purpose. A division holding districts cannot
-- be deleted; the panel offers deactivation instead, which is what preserves
-- historical prayer timetables and Ramadan calendars that reference it.
-- -----------------------------------------------------------------------------
create table if not exists public.divisions (
  id          uuid primary key default gen_random_uuid(),
  code        text not null,
  name_en     text not null,
  name_bn     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  constraint divisions_code_format check (code ~ '^[A-Za-z0-9_.-]{1,32}$'),
  constraint divisions_name_en_not_blank check (length(btrim(name_en)) > 0)
);

create unique index if not exists divisions_code_key on public.divisions (code);
create index if not exists divisions_name_en_idx on public.divisions (lower(name_en));

create table if not exists public.districts (
  id          uuid primary key default gen_random_uuid(),
  division_id uuid not null references public.divisions (id) on delete restrict,
  code        text not null,
  name_en     text not null,
  name_bn     text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  constraint districts_code_format check (code ~ '^[A-Za-z0-9_.-]{1,32}$'),
  constraint districts_name_en_not_blank check (length(btrim(name_en)) > 0)
);

create unique index if not exists districts_code_key on public.districts (code);
create index if not exists districts_division_idx on public.districts (division_id);
create index if not exists districts_name_en_idx on public.districts (lower(name_en));

create table if not exists public.thanas (
  id          uuid primary key default gen_random_uuid(),
  district_id uuid not null references public.districts (id) on delete restrict,
  code        text not null,
  name_en     text not null,
  name_bn     text,
  latitude    numeric(9, 6),
  longitude   numeric(9, 6),
  is_active   boolean not null default true,
  created_at  timestamptz not null default now(),
  created_by  uuid references auth.users (id) on delete set null,
  updated_at  timestamptz not null default now(),
  updated_by  uuid references auth.users (id) on delete set null,
  constraint thanas_code_format check (code ~ '^[A-Za-z0-9_.-]{1,32}$'),
  constraint thanas_name_en_not_blank check (length(btrim(name_en)) > 0),
  constraint thanas_latitude_range check (latitude is null or (latitude between -90 and 90)),
  constraint thanas_longitude_range check (longitude is null or (longitude between -180 and 180))
);

create unique index if not exists thanas_code_key on public.thanas (code);
create index if not exists thanas_district_idx on public.thanas (district_id);
create index if not exists thanas_name_en_idx on public.thanas (lower(name_en));

create table if not exists public.localities (
  id                  uuid primary key default gen_random_uuid(),
  -- A locality's administrative parent. The Android app's OpenStreetMap
  -- neighbourhood layer resolves only to a district, so `thana_id` is nullable
  -- and `district_id` acts as the fallback parent. Inventing a thana for those
  -- rows would be fabricating an administrative claim the source never made.
  thana_id            uuid references public.thanas (id) on delete restrict,
  district_id         uuid references public.districts (id) on delete restrict,
  code                text,
  name_en             text not null,
  name_bn             text,
  alternative_names   text[] not null default '{}',
  latitude            numeric(9, 6),
  longitude           numeric(9, 6),
  source_name         text,
  source_url          text,
  verification_status public.verification_status not null default 'unverified',
  is_active           boolean not null default true,
  notes               text,
  created_at          timestamptz not null default now(),
  created_by          uuid references auth.users (id) on delete set null,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users (id) on delete set null,
  constraint localities_name_en_not_blank check (length(btrim(name_en)) > 0),
  constraint localities_code_format check (code is null or code ~ '^[A-Za-z0-9_.-]{1,32}$'),
  constraint localities_has_parent check (thana_id is not null or district_id is not null),
  constraint localities_latitude_range check (latitude is null or (latitude between -90 and 90)),
  constraint localities_longitude_range check (longitude is null or (longitude between -180 and 180)),
  constraint localities_source_url_scheme check (
    source_url is null or source_url ~* '^https?://'
  ),
  -- A coordinate is only meaningful as a pair.
  constraint localities_coordinates_paired check (
    (latitude is null) = (longitude is null)
  ),
  -- "verified" without a citable source would be an unsupported claim.
  constraint localities_verified_needs_source check (
    verification_status <> 'verified'
    or (source_name is not null and length(btrim(source_name)) > 0)
  )
);

create unique index if not exists localities_code_key
  on public.localities (code) where code is not null;
create index if not exists localities_thana_idx on public.localities (thana_id);
create index if not exists localities_district_idx on public.localities (district_id);
create index if not exists localities_name_en_idx on public.localities (lower(name_en));
create index if not exists localities_verification_idx
  on public.localities (verification_status);

comment on column public.localities.thana_id is
  'Administrative parent when known. Nullable: the OSM neighbourhood source used by the Android app resolves only to a district.';
