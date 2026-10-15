import type {
  AnnouncementType,
  FeedbackStatus,
  RecordStatus,
  VerificationStatus,
} from "@/lib/types/database";

/** The panel's single working timezone: the dataset it manages is Bangladesh-only. */
export const DISPLAY_TIMEZONE = "Asia/Dhaka";

export function formatDateTime(
  value: string | Date | null | undefined,
  options: { withSeconds?: boolean } = {},
): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: DISPLAY_TIMEZONE,
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    ...(options.withSeconds ? { second: "2-digit" as const } : {}),
    hour12: false,
  }).format(date);
}

/**
 * Today's date in the panel's working timezone, as `YYYY-MM-DD`.
 *
 * Uses the same timezone `formatDate` and `formatDateTime` render in, so a date
 * default in a form and a date shown in a list cannot disagree about which day it
 * is near midnight.
 */
export function todayInDisplayTimezone(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: DISPLAY_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}

export function formatDate(value: string | Date | null | undefined): string {
  if (!value) return "—";
  const date = typeof value === "string" ? new Date(`${String(value).slice(0, 10)}T00:00:00Z`) : value;
  if (Number.isNaN(date.getTime())) return "—";

  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "UTC",
    day: "2-digit",
    month: "short",
    year: "numeric",
  }).format(date);
}

/** Renders a `time without time zone` value ("05:12:00") as "05:12". */
export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const match = /^(\d{2}):(\d{2})/.exec(value);
  if (!match) return value;
  return `${match[1]}:${match[2]}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

export function pluralise(count: number, singular: string, plural?: string): string {
  return count === 1 ? singular : (plural ?? `${singular}s`);
}

/** "2 minutes ago" style freshness, used on dashboard status rows. */
export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return "never";
  const date = typeof value === "string" ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return "never";

  const seconds = Math.round((Date.now() - date.getTime()) / 1000);
  const formatter = new Intl.RelativeTimeFormat("en", { numeric: "auto" });

  const units: Array<[Intl.RelativeTimeFormatUnit, number]> = [
    ["year", 60 * 60 * 24 * 365],
    ["month", 60 * 60 * 24 * 30],
    ["day", 60 * 60 * 24],
    ["hour", 60 * 60],
    ["minute", 60],
    ["second", 1],
  ];

  for (const [unit, secondsInUnit] of units) {
    if (Math.abs(seconds) >= secondsInUnit || unit === "second") {
      return formatter.format(-Math.round(seconds / secondsInUnit), unit);
    }
  }

  return "just now";
}

export const RECORD_STATUS_LABELS: Record<RecordStatus, string> = {
  draft: "Draft",
  published: "Published",
  archived: "Archived",
};

export const VERIFICATION_STATUS_LABELS: Record<VerificationStatus, string> = {
  unverified: "Unverified",
  verified: "Verified",
  rejected: "Rejected",
};

export const FEEDBACK_STATUS_LABELS: Record<FeedbackStatus, string> = {
  open: "Open",
  in_progress: "In progress",
  resolved: "Resolved",
  closed: "Closed",
};

export const ANNOUNCEMENT_TYPE_LABELS: Record<AnnouncementType, string> = {
  general: "General",
  prayer: "Prayer",
  ramadan: "Ramadan",
  maintenance: "Maintenance",
  urgent: "Urgent",
};

/** Human labels for the tables that appear in audit history. */
export const ENTITY_TABLE_LABELS: Record<string, string> = {
  admin_users: "Administrator account",
  divisions: "Division",
  districts: "District",
  thanas: "Thana / Upazila",
  localities: "Locality",
  prayer_calculation_configs: "Prayer configuration",
  verified_prayer_timings: "Verified timetable",
  ramadan_calendar_versions: "Ramadan calendar version",
  ramadan_calendar_days: "Ramadan calendar day",
  app_configs: "App configuration",
  announcements: "Announcement",
  feedback_reports: "Feedback report",
  audit_logs: "Audit log",
};

export function entityTableLabel(table: string): string {
  return ENTITY_TABLE_LABELS[table] ?? table;
}

const ACTION_LABELS: Record<string, string> = {
  create: "Created",
  update: "Updated",
  delete: "Deleted",
  publish: "Published",
  unpublish: "Unpublished",
  archive: "Archived",
  status_change: "Status changed",
  bootstrap_admin: "Provisioned administrator",
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}
