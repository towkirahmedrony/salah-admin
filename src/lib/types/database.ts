/**
 * Database row types.
 *
 * These mirror `supabase/migrations/*.sql` exactly — column names, nullability
 * and enum vocabularies. They are written by hand because this repository had no
 * database to introspect when the schema was created.
 *
 * If the project is ever linked to a live Supabase project, replace this file
 * with generated types and keep the enum aliases at the bottom:
 *
 *   supabase gen types typescript --project-id <ref> --schema public \
 *     > src/lib/types/database.ts
 *
 * The `Database` shape matches what `@supabase/supabase-js` expects, so
 * generated output is a drop-in replacement.
 */

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

// --- Enums -------------------------------------------------------------------

export type AdminRole =
  | "super_admin"
  | "location_manager"
  | "content_editor"
  | "prayer_data_reviewer"
  | "support_admin";

export type RecordStatus = "draft" | "published" | "archived";
export type VerificationStatus = "unverified" | "verified" | "rejected";
export type PrayerConfigScope = "global" | "thana";
export type AsrMadhhab = "shafi" | "hanafi";
export type HighLatitudeRule =
  | "none"
  | "middle_of_the_night"
  | "seventh_of_the_night"
  | "twilight_angle";
export type RamadanStartType = "calculated" | "officially_confirmed";
export type FeedbackStatus = "open" | "in_progress" | "resolved" | "closed";
export type AnnouncementType =
  | "general"
  | "prayer"
  | "ramadan"
  | "maintenance"
  | "urgent";
export type TargetPlatform = "android" | "all";

// --- Row types ---------------------------------------------------------------

export type AdminUserRow = {
  id: string;
  email: string;
  full_name: string | null;
  role: AdminRole;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type AuditLogRow = {
  id: number;
  occurred_at: string;
  actor_id: string | null;
  actor_email: string | null;
  actor_role: AdminRole | null;
  action: string;
  entity_table: string;
  entity_id: string | null;
  old_data: Json | null;
  new_data: Json | null;
  request_id: string | null;
  source: string;
}

export type DivisionRow = {
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type DistrictRow = {
  id: string;
  division_id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type ThanaRow = {
  id: string;
  district_id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  latitude: number | null;
  longitude: number | null;
  is_active: boolean;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type LocalityRow = {
  id: string;
  thana_id: string | null;
  district_id: string | null;
  code: string | null;
  name_en: string;
  name_bn: string | null;
  alternative_names: string[];
  latitude: number | null;
  longitude: number | null;
  source_name: string | null;
  source_url: string | null;
  verification_status: VerificationStatus;
  is_active: boolean;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type PrayerCalculationConfigRow = {
  id: string;
  name: string;
  scope: PrayerConfigScope;
  thana_id: string | null;
  engine_key: string;
  engine_version: string;
  calculation_method: string | null;
  fajr_angle: number | null;
  isha_angle: number | null;
  isha_interval_minutes: number | null;
  asr_madhhab: AsrMadhhab;
  high_latitude_rule: HighLatitudeRule;
  timezone: string;
  effective_from: string | null;
  effective_to: string | null;
  source_name: string | null;
  source_url: string | null;
  notes: string | null;
  status: RecordStatus;
  version: number;
  reviewed_by: string | null;
  reviewed_at: string | null;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type VerifiedPrayerTimingRow = {
  id: string;
  thana_id: string | null;
  locality_id: string | null;
  prayer_date: string;
  timezone: string;
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
  sunset: string | null;
  source_name: string | null;
  source_url: string | null;
  notes: string | null;
  status: RecordStatus;
  version: number;
  verified_by: string | null;
  verified_at: string | null;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type RamadanCalendarVersionRow = {
  id: string;
  ramadan_year: number;
  hijri_year: number | null;
  thana_id: string | null;
  expected_start_date: string | null;
  start_date_type: RamadanStartType;
  source_name: string | null;
  source_url: string | null;
  notes: string | null;
  status: RecordStatus;
  version: number;
  day_count: number | null;
  reviewed_by: string | null;
  reviewed_at: string | null;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type RamadanCalendarDayRow = {
  id: string;
  version_id: string;
  day_number: number;
  gregorian_date: string;
  hijri_date: string | null;
  imsak_time: string | null;
  sehri_end_time: string | null;
  iftar_time: string | null;
  source_name: string | null;
  source_url: string | null;
  verification_status: VerificationStatus;
  notes: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type AppConfigRow = {
  id: string;
  key: string;
  category: string;
  value: Json;
  description: string | null;
  is_public: boolean;
  status: RecordStatus;
  version: number;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type AnnouncementRow = {
  id: string;
  title_en: string;
  body_en: string;
  title_bn: string | null;
  body_bn: string | null;
  type: AnnouncementType;
  target_platform: TargetPlatform;
  min_app_version: string | null;
  max_app_version: string | null;
  publish_at: string | null;
  expires_at: string | null;
  status: RecordStatus;
  version: number;
  published_by: string | null;
  published_at: string | null;
  created_at: string;
  created_by: string | null;
  updated_at: string;
  updated_by: string | null;
}

export type FeedbackReportRow = {
  id: string;
  category: string;
  status: FeedbackStatus;
  subject: string | null;
  message: string;
  contact_email: string | null;
  app_version: string | null;
  android_version: string | null;
  device_model: string | null;
  app_language: string | null;
  diagnostic_metadata: Json | null;
  client_reference: string | null;
  assigned_to: string | null;
  admin_reply: string | null;
  replied_by: string | null;
  replied_at: string | null;
  created_at: string;
  updated_at: string;
}

// --- Insert / Update ---------------------------------------------------------
//
// Insert types drop the columns the database fills or the trigger stamps, and
// keep business columns required so a missing value is a compile error rather
// than a runtime constraint violation.

type InsertShape<Row, Generated extends keyof Row, Optional extends keyof Row = never> = Omit<
  Row,
  Generated | Optional
> &
  Partial<Pick<Row, Generated | Optional>>;

export type AdminUserInsert = InsertShape<AdminUserRow, "created_at" | "updated_at" | "created_by" | "updated_by" | "notes" | "full_name" | "is_active">;
export type AuditLogInsert = InsertShape<AuditLogRow, "id" | "occurred_at" | "request_id" | "source">;
export type DivisionInsert = InsertShape<DivisionRow, "id" | "created_at" | "updated_at" | "created_by" | "updated_by" | "is_active" | "name_bn">;
export type DistrictInsert = InsertShape<DistrictRow, "id" | "created_at" | "updated_at" | "created_by" | "updated_by" | "is_active" | "name_bn">;
export type ThanaInsert = InsertShape<ThanaRow, "id" | "created_at" | "updated_at" | "created_by" | "updated_by" | "is_active" | "name_bn" | "latitude" | "longitude">;
export type LocalityInsert = InsertShape<LocalityRow, "id" | "created_at" | "updated_at" | "created_by" | "updated_by" | "is_active" | "name_bn" | "code" | "alternative_names" | "latitude" | "longitude" | "source_name" | "source_url" | "verification_status" | "notes" | "thana_id" | "district_id">;
export type PrayerCalculationConfigInsert = InsertShape<PrayerCalculationConfigRow, "id" | "created_at" | "updated_at" | "created_by" | "updated_by" | "status" | "version" | "reviewed_by" | "reviewed_at" | "published_by" | "published_at">;
export type VerifiedPrayerTimingInsert = InsertShape<VerifiedPrayerTimingRow, "id" | "created_at" | "updated_at" | "created_by" | "updated_by" | "status" | "version" | "verified_by" | "verified_at" | "published_by" | "published_at">;
export type RamadanCalendarVersionInsert = InsertShape<RamadanCalendarVersionRow, "id" | "created_at" | "updated_at" | "created_by" | "updated_by" | "status" | "version" | "day_count" | "reviewed_by" | "reviewed_at" | "published_by" | "published_at">;
export type RamadanCalendarDayInsert = InsertShape<RamadanCalendarDayRow, "id" | "created_at" | "updated_at" | "created_by" | "updated_by">;
export type AppConfigInsert = InsertShape<AppConfigRow, "id" | "created_at" | "updated_at" | "created_by" | "updated_by" | "status" | "version" | "published_by" | "published_at">;
export type AnnouncementInsert = InsertShape<AnnouncementRow, "id" | "created_at" | "updated_at" | "created_by" | "updated_by" | "status" | "version" | "published_by" | "published_at">;
export type FeedbackReportInsert = InsertShape<FeedbackReportRow, "id" | "created_at" | "updated_at" | "replied_by" | "replied_at" | "admin_reply" | "status" | "assigned_to" | "client_reference" | "diagnostic_metadata" | "app_version" | "android_version" | "device_model" | "app_language" | "contact_email" | "subject">;

export type TableUpdate<Row> = Partial<Row>;

// --- Client-facing shape -----------------------------------------------------

/**
 * Every table entry carries a `Relationships` list because
 * `@supabase/postgrest-js` requires it. Only relationships inside the exposed
 * `public` schema are listed — references into `auth.users` are intentionally
 * absent, exactly as generated types omit them.
 */
export interface Database {
  public: {
    Tables: {
      admin_users: {
        Row: AdminUserRow;
        Insert: AdminUserInsert;
        Update: TableUpdate<AdminUserRow>;
        Relationships: [];
      };
      audit_logs: {
        Row: AuditLogRow;
        Insert: AuditLogInsert;
        Update: TableUpdate<AuditLogRow>;
        Relationships: [];
      };
      divisions: {
        Row: DivisionRow;
        Insert: DivisionInsert;
        Update: TableUpdate<DivisionRow>;
        Relationships: [];
      };
      districts: {
        Row: DistrictRow;
        Insert: DistrictInsert;
        Update: TableUpdate<DistrictRow>;
        Relationships: [
          {
            foreignKeyName: "districts_division_id_fkey";
            columns: ["division_id"];
            isOneToOne: false;
            referencedRelation: "divisions";
            referencedColumns: ["id"];
          },
        ];
      };
      thanas: {
        Row: ThanaRow;
        Insert: ThanaInsert;
        Update: TableUpdate<ThanaRow>;
        Relationships: [
          {
            foreignKeyName: "thanas_district_id_fkey";
            columns: ["district_id"];
            isOneToOne: false;
            referencedRelation: "districts";
            referencedColumns: ["id"];
          },
        ];
      };
      localities: {
        Row: LocalityRow;
        Insert: LocalityInsert;
        Update: TableUpdate<LocalityRow>;
        Relationships: [
          {
            foreignKeyName: "localities_thana_id_fkey";
            columns: ["thana_id"];
            isOneToOne: false;
            referencedRelation: "thanas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "localities_district_id_fkey";
            columns: ["district_id"];
            isOneToOne: false;
            referencedRelation: "districts";
            referencedColumns: ["id"];
          },
        ];
      };
      prayer_calculation_configs: {
        Row: PrayerCalculationConfigRow;
        Insert: PrayerCalculationConfigInsert;
        Update: TableUpdate<PrayerCalculationConfigRow>;
        Relationships: [
          {
            foreignKeyName: "prayer_calculation_configs_thana_id_fkey";
            columns: ["thana_id"];
            isOneToOne: false;
            referencedRelation: "thanas";
            referencedColumns: ["id"];
          },
        ];
      };
      verified_prayer_timings: {
        Row: VerifiedPrayerTimingRow;
        Insert: VerifiedPrayerTimingInsert;
        Update: TableUpdate<VerifiedPrayerTimingRow>;
        Relationships: [
          {
            foreignKeyName: "verified_prayer_timings_thana_id_fkey";
            columns: ["thana_id"];
            isOneToOne: false;
            referencedRelation: "thanas";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "verified_prayer_timings_locality_id_fkey";
            columns: ["locality_id"];
            isOneToOne: false;
            referencedRelation: "localities";
            referencedColumns: ["id"];
          },
        ];
      };
      ramadan_calendar_versions: {
        Row: RamadanCalendarVersionRow;
        Insert: RamadanCalendarVersionInsert;
        Update: TableUpdate<RamadanCalendarVersionRow>;
        Relationships: [
          {
            foreignKeyName: "ramadan_calendar_versions_thana_id_fkey";
            columns: ["thana_id"];
            isOneToOne: false;
            referencedRelation: "thanas";
            referencedColumns: ["id"];
          },
        ];
      };
      ramadan_calendar_days: {
        Row: RamadanCalendarDayRow;
        Insert: RamadanCalendarDayInsert;
        Update: TableUpdate<RamadanCalendarDayRow>;
        Relationships: [
          {
            foreignKeyName: "ramadan_calendar_days_version_id_fkey";
            columns: ["version_id"];
            isOneToOne: false;
            referencedRelation: "ramadan_calendar_versions";
            referencedColumns: ["id"];
          },
        ];
      };
      app_configs: {
        Row: AppConfigRow;
        Insert: AppConfigInsert;
        Update: TableUpdate<AppConfigRow>;
        Relationships: [];
      };
      announcements: {
        Row: AnnouncementRow;
        Insert: AnnouncementInsert;
        Update: TableUpdate<AnnouncementRow>;
        Relationships: [];
      };
      feedback_reports: {
        Row: FeedbackReportRow;
        Insert: FeedbackReportInsert;
        Update: TableUpdate<FeedbackReportRow>;
        Relationships: [
          {
            foreignKeyName: "feedback_reports_assigned_to_fkey";
            columns: ["assigned_to"];
            isOneToOne: false;
            referencedRelation: "admin_users";
            referencedColumns: ["id"];
          },
        ];
      };
    };
    Views: { [_ in never]: never };
    Functions: {
      submit_feedback: {
        Args: {
          p_message: string;
          p_category?: string;
          p_subject?: string | null;
          p_contact_email?: string | null;
          p_app_version?: string | null;
          p_android_version?: string | null;
          p_device_model?: string | null;
          p_app_language?: string | null;
          p_diagnostics?: Json | null;
          p_client_reference?: string | null;
        };
        Returns: { feedback_id: string; was_duplicate: boolean }[];
      };
      public_app_configs: {
        Args: Record<string, never>;
        Returns: {
          key: string;
          category: string;
          value: Json;
          version: number;
          published_at: string | null;
        }[];
      };
      public_announcements: {
        Args: Record<string, never>;
        Returns: {
          id: string;
          title_en: string;
          body_en: string;
          title_bn: string | null;
          body_bn: string | null;
          type: AnnouncementType;
          target_platform: TargetPlatform;
          min_app_version: string | null;
          max_app_version: string | null;
          publish_at: string | null;
          expires_at: string | null;
        }[];
      };
      administrator_roster_is_provisioned: {
        Args: Record<string, never>;
        Returns: boolean;
      };
      provision_admin: {
        Args: { p_email: string; p_role: AdminRole; p_full_name?: string | null };
        Returns: string;
      };
      is_active_admin: { Args: Record<string, never>; Returns: boolean };
      current_admin_role: { Args: Record<string, never>; Returns: AdminRole | null };
      can_admin: { Args: { p_capability: string }; Returns: boolean };
    };
    Enums: {
      admin_role: AdminRole;
      record_status: RecordStatus;
      verification_status: VerificationStatus;
      prayer_config_scope: PrayerConfigScope;
      asr_madhhab: AsrMadhhab;
      high_latitude_rule: HighLatitudeRule;
      ramadan_start_type: RamadanStartType;
      feedback_status: FeedbackStatus;
      announcement_type: AnnouncementType;
      target_platform: TargetPlatform;
    };
    CompositeTypes: { [_ in never]: never };
  };
}
