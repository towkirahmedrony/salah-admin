# Live Database Schema — salah-app

> এই নথিটি ২০২৬-১০-১৫ তারিখে live Supabase database catalog থেকে তৈরি। এটি schema metadata—এতে কোনো application row, user PII, credential বা secret অন্তর্ভুক্ত নেই।

## Database পরিচিতি

| বিষয় | Live value |
|---|---|
| Supabase project | `Salah-app` |
| Project ref | `aagyqdiwsokebmgexazj` |
| Region | `ap-southeast-1` |
| PostgreSQL | `17.11.0.003` (engine 17) |
| Schema-র scope | `public` application schema; Supabase-এর `auth` schema-র `auth.users`-কে FK target হিসেবে ব্যবহার করা হয় |
| public base tables | ১৫ |
| public views / materialized views | নেই |
| RLS | ১৫/১৫ public base table-এ enabled; `FORCE ROW LEVEL SECURITY` কোনোটিতে নেই |
| Extensions | `pgcrypto`, `pg_stat_statements`, `supabase_vault`, `uuid-ossp` |
| GitHub snapshot | `towkirahmedrony/salah-admin`, branch `main`, commit `a01d7d02557f694034f01cd7b7ca475a7f326ea` |

## Agent-দের জন্য গুরুত্বপূর্ণ সতর্কতা

1. **এই live schema-কে runtime contract হিসেবে ধরুন।** GitHub migration directory-র সঙ্গে live migration ledger এক-এক করে মেলে না। Live ledger-এ migration IDs/names `20261014…` এবং `20261015…`-এর আলাদা set আছে। GitHub-এর `20260101000000`-এর পরে থাকা migration files live ledger-এ একই version/name-এ নেই; objects থাকতে পারে, কিন্তু SQL file হুবহু চালানো হয়েছিল—এটি ledger থেকে প্রমাণিত নয়।
2. `faq_items`, `hijri_month_starts` এবং সংশ্লিষ্ট public RPC live-এ আছে, কিন্তু যাচাইকৃত GitHub `supabase/migrations/` ফোল্ডারে তাদের definition নেই। এগুলোকে **live-only / repo drift** হিসেবে ধরুন; drop বা recreate করবেন না।
3. `authenticated` role-এর direct table grant-এ `TRUNCATE` অনুমতি ১৪টি public table-এ আছে (শুধু `audit_logs` ব্যতিক্রম)। **RLS `TRUNCATE` আটকায় না।** এটি বর্তমান live grant-এর পর্যবেক্ষণ, কোনো অনুমোদন বা সুপারিশ নয়; grant change কেবল আলাদা অনুমোদিত migration-এ বিবেচনা করুন। `anon`-এর public table-এ direct grants নেই।
4. নতুন DDL লেখার আগে FK, enum, constraints এবং RLS policies এই নথির পাশাপাশি live catalog-এ পুনরায় যাচাই করুন। এই নথি deploy script নয় এবং database থেকে schema পুনর্গঠনের সম্পূর্ণ বিকল্পও নয়।

## উচ্চ-স্তরের ডেটা মডেল

- **Geography:** `divisions → districts → thanas → localities`; locality-র `thana_id` nullable এবং `district_id` fallback parent হতে পারে।
- **Prayer configuration:** `prayer_calculation_configs`-এ একটিমাত্র scope target—`global`, `division`, `district`, অথবা `thana`; scope precedence হলো thana → district → division → global।
- **Prayer timetable:** `verified_prayer_timings`-এর প্রতিটি row হয় একটি thana, নয় একটি locality-কে target করে।
- **Ramadan:** `ramadan_calendar_versions` parent, `ramadan_calendar_days` child; child delete হলে parent FK relationship cascade করে।
- **Admin:** `admin_users.id` হলো `auth.users.id`; business authorization JWT metadata-র বদলে roster/role থেকে নির্ধারিত হয়।
- **Content:** `app_configs`, `announcements`, live-only `faq_items`, এবং `hijri_month_starts` versioned/publication lifecycle ব্যবহার করে।

## Tables ও columns

নিচের column তালিকা live `information_schema.columns` থেকে নেওয়া। `NULL` মানে nullable; `NOT NULL` মানে বাধ্যতামূলক। Default-এ `—` মানে catalog-এ কোনো default নেই। Enum column-গুলোর value **Enums** section-এ আছে।

### `admin_users`

Supabase Auth user ID-র সঙ্গে যুক্ত Salah Admin roster; role ও active flag এখানেই authoritative.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `—` |
| `email` | `text` | NOT NULL | `—` |
| `full_name` | `text` | NULL | `—` |
| `role` | `admin_role` | NOT NULL | `'support_admin'::admin_role` |
| `is_active` | `boolean` | NOT NULL | `true` |
| `notes` | `text` | NULL | `—` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |

### `audit_logs`

প্রশাসনিক পরিবর্তনের append-only audit trail; actor, পুরোনো/নতুন row image এবং request ID রাখে.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `bigint` | NOT NULL | `nextval('audit_logs_id_seq'::regclass)` |
| `occurred_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `actor_id` | `uuid` | NULL | `—` |
| `actor_email` | `text` | NULL | `—` |
| `actor_role` | `admin_role` | NULL | `—` |
| `action` | `text` | NOT NULL | `—` |
| `entity_table` | `text` | NOT NULL | `—` |
| `entity_id` | `text` | NULL | `—` |
| `old_data` | `jsonb` | NULL | `—` |
| `new_data` | `jsonb` | NULL | `—` |
| `request_id` | `text` | NULL | `—` |
| `source` | `text` | NOT NULL | `'trigger'::text` |

### `divisions`

বাংলাদেশের প্রশাসনিক division lookup.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `code` | `text` | NOT NULL | `—` |
| `name_en` | `text` | NOT NULL | `—` |
| `name_bn` | `text` | NULL | `—` |
| `is_active` | `boolean` | NOT NULL | `true` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |

### `districts`

Division-এর অধীন জেলা lookup.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `division_id` | `uuid` | NOT NULL | `—` |
| `code` | `text` | NOT NULL | `—` |
| `name_en` | `text` | NOT NULL | `—` |
| `name_bn` | `text` | NULL | `—` |
| `is_active` | `boolean` | NOT NULL | `true` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |

### `thanas`

District-এর অধীন thana/upazila এবং optional coordinates.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `district_id` | `uuid` | NOT NULL | `—` |
| `code` | `text` | NOT NULL | `—` |
| `name_en` | `text` | NOT NULL | `—` |
| `name_bn` | `text` | NULL | `—` |
| `latitude` | `numeric(9,6)` | NULL | `—` |
| `longitude` | `numeric(9,6)` | NULL | `—` |
| `is_active` | `boolean` | NOT NULL | `true` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |

### `localities`

Thana বা district-এর অধীন verified locality; source ও coordinates সংরক্ষণ করে.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `thana_id` | `uuid` | NULL | `—` |
| `district_id` | `uuid` | NULL | `—` |
| `code` | `text` | NULL | `—` |
| `name_en` | `text` | NOT NULL | `—` |
| `name_bn` | `text` | NULL | `—` |
| `alternative_names` | `text[]` | NOT NULL | `'{}'::text[]` |
| `latitude` | `numeric(9,6)` | NULL | `—` |
| `longitude` | `numeric(9,6)` | NULL | `—` |
| `source_name` | `text` | NULL | `—` |
| `source_url` | `text` | NULL | `—` |
| `verification_status` | `verification_status` | NOT NULL | `'unverified'::verification_status` |
| `is_active` | `boolean` | NOT NULL | `true` |
| `notes` | `text` | NULL | `—` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |

### `prayer_calculation_configs`

Android prayer engine-এর published configuration/version; scope global → division → district → thana.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `name` | `text` | NOT NULL | `—` |
| `scope` | `prayer_config_scope` | NOT NULL | `'global'::prayer_config_scope` |
| `thana_id` | `uuid` | NULL | `—` |
| `engine_key` | `text` | NOT NULL | `'adhan_kotlin'::text` |
| `engine_version` | `text` | NOT NULL | `'0.0.5'::text` |
| `calculation_method` | `prayer_calculation_method` | NULL | `—` |
| `fajr_angle` | `numeric(5,2)` | NULL | `—` |
| `isha_angle` | `numeric(5,2)` | NULL | `—` |
| `isha_interval_minutes` | `integer` | NULL | `—` |
| `asr_madhhab` | `asr_madhhab` | NOT NULL | `'hanafi'::asr_madhhab` |
| `high_latitude_rule` | `high_latitude_rule` | NOT NULL | `'automatic'::high_latitude_rule` |
| `timezone` | `text` | NOT NULL | `'Asia/Dhaka'::text` |
| `effective_from` | `date` | NULL | `—` |
| `effective_to` | `date` | NULL | `—` |
| `source_name` | `text` | NULL | `—` |
| `source_url` | `text` | NULL | `—` |
| `notes` | `text` | NULL | `—` |
| `status` | `record_status` | NOT NULL | `'draft'::record_status` |
| `version` | `integer` | NOT NULL | `1` |
| `reviewed_by` | `uuid` | NULL | `—` |
| `reviewed_at` | `timestamp with time zone` | NULL | `—` |
| `published_by` | `uuid` | NULL | `—` |
| `published_at` | `timestamp with time zone` | NULL | `—` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |
| `fajr_offset_minutes` | `integer` | NOT NULL | `0` |
| `sunrise_offset_minutes` | `integer` | NOT NULL | `0` |
| `dhuhr_offset_minutes` | `integer` | NOT NULL | `0` |
| `asr_offset_minutes` | `integer` | NOT NULL | `0` |
| `maghrib_offset_minutes` | `integer` | NOT NULL | `0` |
| `isha_offset_minutes` | `integer` | NOT NULL | `0` |
| `division_id` | `uuid` | NULL | `—` |
| `district_id` | `uuid` | NULL | `—` |
| `adjust_fajr` | `integer` | NOT NULL | `0` |
| `adjust_dhuhr` | `integer` | NOT NULL | `0` |
| `adjust_asr` | `integer` | NOT NULL | `0` |
| `adjust_maghrib` | `integer` | NOT NULL | `0` |
| `adjust_isha` | `integer` | NOT NULL | `0` |
| `schema_version` | `integer` | NOT NULL | `1` |

### `verified_prayer_timings`

Thana অথবা locality-র জন্য তারিখভিত্তিক, source-attributed prayer timetable.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `thana_id` | `uuid` | NULL | `—` |
| `locality_id` | `uuid` | NULL | `—` |
| `prayer_date` | `date` | NOT NULL | `—` |
| `timezone` | `text` | NOT NULL | `'Asia/Dhaka'::text` |
| `fajr` | `time without time zone` | NOT NULL | `—` |
| `sunrise` | `time without time zone` | NOT NULL | `—` |
| `dhuhr` | `time without time zone` | NOT NULL | `—` |
| `asr` | `time without time zone` | NOT NULL | `—` |
| `maghrib` | `time without time zone` | NOT NULL | `—` |
| `isha` | `time without time zone` | NOT NULL | `—` |
| `sunset` | `time without time zone` | NULL | `—` |
| `source_name` | `text` | NULL | `—` |
| `source_url` | `text` | NULL | `—` |
| `notes` | `text` | NULL | `—` |
| `status` | `record_status` | NOT NULL | `'draft'::record_status` |
| `version` | `integer` | NOT NULL | `1` |
| `verified_by` | `uuid` | NULL | `—` |
| `verified_at` | `timestamp with time zone` | NULL | `—` |
| `published_by` | `uuid` | NULL | `—` |
| `published_at` | `timestamp with time zone` | NULL | `—` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |

### `ramadan_calendar_versions`

জাতীয় বা thana-ভিত্তিক Ramadan calendar-এর version, start-date evidence ও publication metadata.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `ramadan_year` | `integer` | NOT NULL | `—` |
| `hijri_year` | `integer` | NULL | `—` |
| `thana_id` | `uuid` | NULL | `—` |
| `expected_start_date` | `date` | NULL | `—` |
| `start_date_type` | `ramadan_start_type` | NOT NULL | `'calculated'::ramadan_start_type` |
| `source_name` | `text` | NULL | `—` |
| `source_url` | `text` | NULL | `—` |
| `notes` | `text` | NULL | `—` |
| `status` | `record_status` | NOT NULL | `'draft'::record_status` |
| `version` | `integer` | NOT NULL | `1` |
| `reviewed_by` | `uuid` | NULL | `—` |
| `reviewed_at` | `timestamp with time zone` | NULL | `—` |
| `published_by` | `uuid` | NULL | `—` |
| `published_at` | `timestamp with time zone` | NULL | `—` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |
| `day_count` | `integer` | NULL | `—` |

### `ramadan_calendar_days`

একটি Ramadan calendar version-এর day-by-day Sehri/Iftar entries.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `version_id` | `uuid` | NOT NULL | `—` |
| `day_number` | `integer` | NOT NULL | `—` |
| `gregorian_date` | `date` | NOT NULL | `—` |
| `hijri_date` | `text` | NULL | `—` |
| `imsak_time` | `time without time zone` | NULL | `—` |
| `sehri_end_time` | `time without time zone` | NULL | `—` |
| `iftar_time` | `time without time zone` | NULL | `—` |
| `source_name` | `text` | NULL | `—` |
| `source_url` | `text` | NULL | `—` |
| `verification_status` | `verification_status` | NOT NULL | `'unverified'::verification_status` |
| `notes` | `text` | NULL | `—` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |

### `app_configs`

Versioned app configuration; public exposure-এ key + published + is_public শর্ত লাগে.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `key` | `text` | NOT NULL | `—` |
| `category` | `text` | NOT NULL | `'general'::text` |
| `value` | `jsonb` | NOT NULL | `'{}'::jsonb` |
| `description` | `text` | NULL | `—` |
| `is_public` | `boolean` | NOT NULL | `false` |
| `status` | `record_status` | NOT NULL | `'draft'::record_status` |
| `version` | `integer` | NOT NULL | `1` |
| `published_by` | `uuid` | NULL | `—` |
| `published_at` | `timestamp with time zone` | NULL | `—` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |

### `announcements`

Scheduled/versioned bilingual announcements.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `title_en` | `text` | NOT NULL | `—` |
| `body_en` | `text` | NOT NULL | `—` |
| `title_bn` | `text` | NULL | `—` |
| `body_bn` | `text` | NULL | `—` |
| `type` | `announcement_type` | NOT NULL | `'general'::announcement_type` |
| `target_platform` | `target_platform` | NOT NULL | `'android'::target_platform` |
| `min_app_version` | `text` | NULL | `—` |
| `max_app_version` | `text` | NULL | `—` |
| `publish_at` | `timestamp with time zone` | NULL | `—` |
| `expires_at` | `timestamp with time zone` | NULL | `—` |
| `status` | `record_status` | NOT NULL | `'draft'::record_status` |
| `version` | `integer` | NOT NULL | `1` |
| `published_by` | `uuid` | NULL | `—` |
| `published_at` | `timestamp with time zone` | NULL | `—` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |

### `feedback_reports`

Anonymous/app feedback intake, assignment, diagnostics ও admin reply.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `category` | `text` | NOT NULL | `'general'::text` |
| `status` | `feedback_status` | NOT NULL | `'open'::feedback_status` |
| `subject` | `text` | NULL | `—` |
| `message` | `text` | NOT NULL | `—` |
| `contact_email` | `text` | NULL | `—` |
| `app_version` | `text` | NULL | `—` |
| `android_version` | `text` | NULL | `—` |
| `device_model` | `text` | NULL | `—` |
| `app_language` | `text` | NULL | `—` |
| `diagnostic_metadata` | `jsonb` | NULL | `—` |
| `client_reference` | `text` | NULL | `—` |
| `assigned_to` | `uuid` | NULL | `—` |
| `admin_reply` | `text` | NULL | `—` |
| `replied_by` | `uuid` | NULL | `—` |
| `replied_at` | `timestamp with time zone` | NULL | `—` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |

### `faq_items`

Live database-এ আছে; বর্তমান GitHub migration directory-তে এর table definition পাওয়া যায়নি.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `category` | `text` | NOT NULL | `'general'::text` |
| `question_en` | `text` | NOT NULL | `—` |
| `answer_en` | `text` | NOT NULL | `—` |
| `question_bn` | `text` | NULL | `—` |
| `answer_bn` | `text` | NULL | `—` |
| `sort_order` | `integer` | NOT NULL | `0` |
| `status` | `record_status` | NOT NULL | `'draft'::record_status` |
| `version` | `integer` | NOT NULL | `1` |
| `published_by` | `uuid` | NULL | `—` |
| `published_at` | `timestamp with time zone` | NULL | `—` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |

### `hijri_month_starts`

Hijri month start-date record, calculated বা officially-confirmed source-সহ; live-only migration object.

| Column | Type | Nullability | Default |
|---|---|---|---|
| `id` | `uuid` | NOT NULL | `gen_random_uuid()` |
| `hijri_year` | `integer` | NOT NULL | `—` |
| `hijri_month` | `integer` | NOT NULL | `—` |
| `gregorian_start_date` | `date` | NOT NULL | `—` |
| `start_date_type` | `ramadan_start_type` | NOT NULL | `'calculated'::ramadan_start_type` |
| `source_name` | `text` | NULL | `—` |
| `source_url` | `text` | NULL | `—` |
| `notes` | `text` | NULL | `—` |
| `status` | `record_status` | NOT NULL | `'draft'::record_status` |
| `version` | `integer` | NOT NULL | `1` |
| `reviewed_by` | `uuid` | NULL | `—` |
| `reviewed_at` | `timestamp with time zone` | NULL | `—` |
| `published_by` | `uuid` | NULL | `—` |
| `published_at` | `timestamp with time zone` | NULL | `—` |
| `created_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `created_by` | `uuid` | NULL | `—` |
| `updated_at` | `timestamp with time zone` | NOT NULL | `now()` |
| `updated_by` | `uuid` | NULL | `—` |

## Relationships / foreign keys

- `admin_users.id → auth.users.id` (`ON DELETE CASCADE`); `created_by`/`updated_by` এবং publication/review actor columns সাধারণত `auth.users.id → SET NULL`।
- `districts.division_id → divisions.id` (`RESTRICT`); `thanas.district_id → districts.id` (`RESTRICT`)।
- `localities.thana_id → thanas.id` এবং `localities.district_id → districts.id` (`RESTRICT`); `localities_has_parent` অন্তত একটি parent বাধ্যতামূলক করে।
- `prayer_calculation_configs.division_id`, `.district_id`, `.thana_id` যথাক্রমে geography table-এ `RESTRICT`; scope check ঠিক একটি matching target দাবি করে।
- `verified_prayer_timings.thana_id → thanas.id` এবং `.locality_id → localities.id` (`RESTRICT`); `vpt_one_target` XOR check ঠিক একটি target দাবি করে।
- `ramadan_calendar_versions.thana_id → thanas.id` (`RESTRICT`); `ramadan_calendar_days.version_id → ramadan_calendar_versions.id` (`CASCADE`)।
- `feedback_reports.assigned_to → admin_users.id` (`SET NULL`); `.replied_by → auth.users.id` (`SET NULL`)।
- `faq_items`, `hijri_month_starts`-এর `created_by`/`updated_by`/review/publish actor IDs `auth.users`-কে reference করে।

## Enums

- `admin_role`: `super_admin`, `location_manager`, `content_editor`, `prayer_data_reviewer`, `support_admin`
- `record_status`: `draft`, `published`, `archived`
- `verification_status`: `unverified`, `verified`, `rejected`
- `prayer_config_scope`: `global`, `division`, `district`, `thana`
- `prayer_calculation_method`: `karachi`, `muslim_world_league`, `egyptian`, `umm_al_qura`, `dubai`, `moon_sighting_committee`, `north_america`, `kuwait`, `qatar`, `singapore`, `turkey`
- `asr_madhhab`: `shafi`, `hanafi`
- `high_latitude_rule`: `automatic`, `middle_of_the_night`, `seventh_of_the_night`, `twilight_angle`
- `ramadan_start_type`: `calculated`, `officially_confirmed`
- `feedback_status`: `open`, `in_progress`, `resolved`, `closed`
- `announcement_type`: `general`, `prayer`, `ramadan`, `maintenance`, `urgent`
- `target_platform`: `android`, `all`

## প্রধান constraints ও index contract

প্রতিটি table-এ primary key এবং FK/check constraints live catalog-এ আছে। নিচে agent-দের জন্য সবচেয়ে গুরুত্বপূর্ণ business invariants ও unique/index behavior সংক্ষেপে দেওয়া হলো।

- **`admin_users`:** lowercase/nonblank email checks; `admin_users_email_key` lower(email)-এ unique। Auth roster-ই authorization source।
- **Geography:** division/district/thana codes format-checked ও unique; locality-র parent আবশ্যক, coordinates pair হিসেবে থাকতে হয়, ranges valid হতে হয়, `verified` locality-তে source name লাগে।
- **`prayer_calculation_configs`:** `pcc_scope_target_agrees` matching target enforce করে; `effective_to >= effective_from`; angle/isha/offset values range-checked; published row-তে method, engine, timezone, source, effective date, Isha parameter এবং reviewer metadata লাগে। `schema_version` 1–1000। Published uniqueness: global, division, district, thana scope target-এ সর্বোচ্চ একটি করে।
- **`verified_prayer_timings`:** ঠিক একটি target; published prayer chronology `fajr < sunrise <= dhuhr < asr < maghrib < isha`; target/date অনুযায়ী published unique index। Live check `vpt_published_needs_reviewer`-এ `verified_by`/`verified_at` বাধ্যতামূলক।
- **Ramadan:** year range 1900–2200; published version-এ start date/source/reviewer এবং `day_count` 29 বা 30 লাগে। Day number 1–30; একই version-এ day number ও Gregorian date উভয়ই unique; verified day-তে Sehri end ও Iftar লাগবে।
- **`app_configs`:** key format restricted, credential-like key-name নিষিদ্ধ, `value` JSON object; key unique। Public RPC-তে কেবল `is_public AND status='published'` row যায়।
- **`announcements`:** title/body nonblank, expiry publish time-এর পরে; `published` হলে `publish_at` আবশ্যক।
- **`feedback_reports`:** message 10–4000 characters; client reference 8–80; `feedback_client_reference_key` nullable reference-এ unique; admin reply ও replied_at একসঙ্গে null/non-null।
- **`faq_items`:** English question/answer nonblank, category 1–40, positive version; category+sort এবং status indexes।
- **`hijri_month_starts`:** year 1300–1600, month 1–12, start date 1880–2200; officially-confirmed date-এ source name; published row source + reviewer চায়; বছর-মাসে সর্বোচ্চ একটি published row (`hms_one_published_per_month`)।

### গুরুত্বপূর্ণ secondary indexes

- Geography: `divisions_code_key`, `districts_code_key`, `thanas_code_key`, `localities_code_key` (locality-তে non-null code partial unique), parent/lookup এবং lower(name_en) indexes।
- Prayer configs: `pcc_scope_idx`, `pcc_status_idx`, location indexes, effective-date index এবং `pcc_one_published_global`, `pcc_one_published_per_division`, `pcc_one_published_per_district`, `pcc_one_published_per_thana` unique partial indexes।
- Timings: date, target+date, status indexes এবং published per-thana/locality per-day unique indexes।
- Ramadan: year/status indexes; national/per-thana published uniqueness; child version/day, version/date unique এবং Gregorian-date index।
- Feedback: unique client reference plus status/category/created_at/assigned_to indexes।
- Audit: occurred_at, entity, actor indexes।

## RLS, table grants ও access model

**RLS enabled আছে সব ১৫টি public table-এ**, কিন্তু `FORCE ROW LEVEL SECURITY` নেই। `anon` role-এর direct public-table privilege নেই; public/mobile read path ও feedback intake function/RPC দিয়ে। `authenticated`-এর table privileges RLS policies দিয়ে সীমিত করার উদ্দেশ্য; `service_role`-এর broad grants আলাদা trusted server-side path।

| Table group | SELECT policy | Write policy / capability |
|---|---|---|
| `admin_users` | `is_active_admin()` | `admins`; self-demotion/deactivation protection trigger আছে |
| `audit_logs` | `can_admin('audit')` | API-তে write policy নেই; trigger/service-side writing |
| Geography (`divisions`, `districts`, `thanas`, `localities`) | `is_active_admin()` | `can_admin('locations')` |
| `prayer_calculation_configs` | `is_active_admin()` | draft insert/delete; updates authorize `prayer_config` এবং status constraints; publish/archive RPC |
| `verified_prayer_timings` | `is_active_admin()` | `can_admin('prayer_timings')` |
| Ramadan versions/days | `is_active_admin()` | `can_admin('ramadan')` |
| `app_configs` | `is_active_admin()` | `can_admin('app_config')` |
| `announcements` | `is_active_admin()` | `can_admin('announcements')` |
| `feedback_reports` | `can_admin('feedback')` | UPDATE only policy; anonymous insert `submit_feedback()` দিয়ে |
| `faq_items` | `is_active_admin()` | `can_admin('faq')` |
| `hijri_month_starts` | `is_active_admin()` | `can_admin('hijri_calendar')` |

`can_admin(capability)`-এর live role mapping: `super_admin` সব capability; `location_manager` locations; `prayer_data_reviewer` prayer config/timings/Ramadan/Hijri; `content_editor` app config/announcements/FAQ; `support_admin` feedback; `audit` ও `admins` শুধু super admin।

### Privilege সতর্কতা

Live `has_table_privilege` check-এ `authenticated` role-র `TRUNCATE` permission এই ১৪টি table-এ `true`: `admin_users`, `announcements`, `app_configs`, `districts`, `divisions`, `faq_items`, `feedback_reports`, `hijri_month_starts`, `localities`, `prayer_calculation_configs`, `ramadan_calendar_days`, `ramadan_calendar_versions`, `thanas`, `verified_prayer_timings`। `audit_logs`-এ false। `TRUNCATE` row-level policy দ্বারা নিয়ন্ত্রিত হয় না। কোনো agent যেন এটিকে RLS দ্বারা সুরক্ষিত ধরে না নেয়; প্রয়োজন হলে privilege hardening আলাদা reviewed migration-এ করতে হবে।

## Functions / RPC catalog

নিচে live `public` schema-র application routines-এর signature ও দায়িত্ব দেওয়া হলো। অধিকাংশ `SECURITY DEFINER` এবং fixed `search_path` ব্যবহার করে; `request_header(text)` security definer নয়। Trigger/event-trigger function সরাসরি RPC হিসেবে ব্যবহার করার জন্য নয়।

### Admin, authorization ও audit

| Function | কাজ / output |
|---|---|
| `is_active_admin()` → `boolean` | Current JWT user-এর active admin roster membership. |
| `current_admin_role()` → `admin_role` | Current active admin-এর role; না হলে null. |
| `has_admin_role(VARIADIC p_roles admin_role[])` → `boolean` | Current user নির্দিষ্ট role-এর যেকোনো একটিতে আছে কি না. |
| `can_admin(p_capability text)` → `boolean` | Capability-to-role authorization; RLS ও guarded RPC-তে ব্যবহৃত. |
| `provision_admin(p_email text, p_role admin_role, p_full_name text DEFAULT NULL)` → `uuid` | Existing `auth.users` account-কে admin roster-এ যোগ/আপডেট; `admins` capability re-check করে. |
| `bootstrap_first_admin(p_email text, p_full_name text DEFAULT NULL)` → `uuid` | প্রথম super-admin provisioning; `service_role` execution. |
| `administrator_roster_is_provisioned()` → `boolean` | Public setup check—কোনো active admin আছে কি না, identity প্রকাশ করে না. |
| `request_header(p_name text)` → `text` | PostgREST request-header GUC থেকে header value; malformed/missing value-তে null. |
| `touch_audit_columns()` → trigger | Insert/update-এ created/updated timestamps ও authenticated actor stamps. |
| `audit_row_change()` → trigger | Row insert/update/delete-এর পুরোনো/নতুন ছবি, actor এবং request ID audit log-এ লেখে. |
| `guard_admin_account_safety()` → trigger | Self-demotion/deactivation ও last active super-admin removal guard. |

### Prayer configuration

| Function | কাজ / output |
|---|---|
| `derive_prayer_config_angles()` → trigger | `calculation_method` থেকে engine-derived Fajr/Isha angles বা Isha interval বসায়. |
| `guard_pcc_immutable()` → trigger | Non-draft configuration content rewrite আটকায়; status transition অনুমোদিত path-এ চলে. |
| `guard_pcc_delete()` → trigger | Draft ছাড়া prayer config delete আটকায়. |
| `publish_prayer_config(p_id uuid)` → `prayer_calculation_configs` | Authorization check করে একই scope target-এর live config archive করে নতুনটি publish করে; actor/reviewer stamps database-set. |
| `archive_prayer_config(p_id uuid)` → `prayer_calculation_configs` | Authorization check করে config archive করে; row physically delete করে না. |
| `resolve_prayer_config(p_division_id uuid, p_district_id uuid, p_thana_id uuid, p_on_date date)` → table | Effective date ও thana→district→division→global precedence দিয়ে matched published config preview. |
| `public_prayer_configs()` → table | App-facing published configuration contract; scope code, engine, method, adjustments, timezone, date/version/source fields; internal actor/note columns বাদ. |

### Public app data & feedback

| Function | কাজ / output |
|---|---|
| `public_divisions()` → table | Active division lookup. |
| `public_districts()` → table | Active districts whose parent division is active. |
| `public_thanas()` → table | Active thanas whose district/division are active. |
| `public_localities()` → table | Active, verified locality lookup. |
| `public_prayer_timings(p_thana_id uuid, p_locality_id uuid, p_from date, p_to date)` → table | Published timetable; request date range capped at 365 days. |
| `public_ramadan_calendar(p_ramadan_year integer, p_thana_id uuid)` → table | Published calendar/day rows; rejected days বাদ, national/thana fallback included. |
| `public_hijri_month_starts(p_hijri_year integer)` → table | Published Hijri month-start records; optional year filter. |
| `public_faq_items()` → table | Published FAQ rows ordered by category/sort order. |
| `public_announcements()` → table | Published announcements inside publish/expiry window. |
| `public_app_configs()` → table | Only public + published app config values. |
| `public_data_version()` → table | Dataset name, last-updated timestamp ও public row-count metadata. |
| `submit_feedback(p_message text, p_category text, p_subject text, p_contact_email text, p_app_version text, p_android_version text, p_device_model text, p_app_language text, p_diagnostics jsonb, p_client_reference text)` → `(feedback_id uuid, was_duplicate boolean)` | Validates anonymous feedback, strips matching top-level credential-like diagnostic keys, status/assignment/reply caller-set হতে দেয় না; duplicate reference lookup করে. Unique index final duplicate row আটকায়. |

### Publication / automatic RLS triggers

- `stamp_publish_metadata()` → trigger: status published হলে publisher/reviewer stamps বসায়; published থেকে বের হলে publication stamps clear করে. `app_configs`, `announcements`, FAQ, Hijri, prayer config, timetable, Ramadan version-এ attached.
- `sync_ramadan_version_day_count()` → trigger: day insert/update/delete-এ parent `day_count` recalculate করে.
- `rls_auto_enable()` → event-trigger function: নতুন `public` table তৈরি হলে RLS auto-enable করে. Live event trigger-এর নাম `ensure_rls` (`ddl_command_end`).

### Function grants snapshot

- `anon` + `authenticated` + `service_role`: `public_*` read RPCs, `submit_feedback()`, `administrator_roster_is_provisioned()`.
- `authenticated` + `service_role`: `provision_admin()`.
- `service_role` only: `bootstrap_first_admin()`.
- `publish_prayer_config()`, `archive_prayer_config()` এবং `resolve_prayer_config()`-এর ACL-এ `anon` ও `authenticated` EXECUTE দেখা গেছে; publish/archive function body-তে `can_admin('prayer_config')` authorization re-check আছে. `resolve_prayer_config` published config fields দেয়—grant intentionally public কি না ভবিষ্যৎ access review-তে যাচাই করুন.
- Internal helper/trigger functions-এর ACL-এও `PUBLIC`/`anon` EXECUTE দেখা যায়; trigger-returning functions সরাসরি RPC হিসেবে invoke করা যায় না, কিন্তু নতুন `SECURITY DEFINER` function যোগ হলে ACL আলাদাভাবে পরীক্ষা করুন.

## Triggers

- Managed application tables-এ (audit log table ব্যতীত) `set_audit_columns` এবং `audit_row_change` triggers সক্রিয়.
- `admin_users`: `guard_admin_account_safety`.
- `prayer_calculation_configs`: `derive_prayer_config_angles`, `guard_pcc_delete`, `guard_pcc_immutable`, `stamp_publish_metadata`.
- `ramadan_calendar_days`: `sync_ramadan_day_count`.
- `ramadan_calendar_versions`, `verified_prayer_timings`, `app_configs`, `announcements`, `faq_items`, `hijri_month_starts`: `stamp_publish_metadata` যেখানে প্রযোজ্য.
- `ensure_rls` event trigger নতুন public tables-এ RLS চালু করে. Supabase/PostgREST-এর internal event triggers-ও আছে; application logic হিসেবে শুধু `ensure_rls` ধরা হয়েছে.

## Migration ledger (live Supabase)

`supabase_migrations` ledger-এ ১৪টি entry দেখা গেছে:

| Version | Name |
|---|---|
| `20260101000000` | `extensions_and_types` |
| `20261014204023` | `drop_legacy_salah_schema` |
| `20261014204040` | `admin_identity_audit_geography` |
| `20261014204111` | `prayer_config_timetables_ramadan_content` |
| `20261014204128` | `authz_helpers_audit_triggers` |
| `20261014204146` | `row_level_security` |
| `20261014204222` | `publication_guards_lockout_protection` |
| `20261014204238` | `anonymous_entry_points` |
| `20261014204250` | `admin_provisioning` |
| `20261014204631` | `prayer_offsets_hijri_months_faq_tables` |
| `20261014204646` | `authz_triggers_rls_for_hijri_faq` |
| `20261014204714` | `public_read_functions_for_app` |
| `20261015053809` | `prayer_config_contract` |
| `20261015053853` | `prayer_config_functions_and_policies` |

## Operational guidance for future agents

- Read this file before suggesting schema-dependent app changes, but verify live catalog when making a DDL decision.
- Never infer that a table is absent just because it is missing from the GitHub migration directory; `faq_items` ও `hijri_month_starts` live-only examples.
- Do not use `TRUNCATE` as an API-role cleanup shortcut. Live privilege snapshot allows `authenticated` to truncate most public tables and RLS will not stop it.
- Public clients should normally use the narrowly scoped `public_*` RPC contracts, not direct table access.
- Do not put service-role secrets in tables or app config. Do not expose raw audit logs/diagnostics without a privacy review.
- After an approved migration, regenerate/refresh this reference from live metadata and reconcile the repository migration ledger before the next deploy.
