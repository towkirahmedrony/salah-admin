import { z } from "zod";

import {
  optionalHttpUrl,
  optionalText,
  optionalTimeOnly,
  dateOnly,
  booleanFromForm,
  optionalUuid,
  timeOnly,
} from "@/lib/validation/common";

/** The six daily times, plus the optional sunset some sources also print. */
export interface TimetableTimes {
  fajr: string;
  sunrise: string;
  dhuhr: string;
  asr: string;
  maghrib: string;
  isha: string;
  sunset?: string | null;
}

export interface TimetableIssue {
  field: string;
  message: string;
  severity: "error" | "warning";
}

export function timeToMinutes(value: string): number | null {
  const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value.trim());
  if (!match) return null;
  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;
  return hours * 60 + minutes;
}

/**
 * Chronological review of a daily timetable.
 *
 * Errors are limited to orderings that are physically impossible in any
 * location — a sunrise after noon, an Asr before Dhuhr. Anything that merely
 * *looks* unusual is a warning, because a reviewer who has a real published
 * source in front of them must be able to publish it. False rejections are worse
 * than an unanswered warning: they push reviewers to enter false data.
 */
const REQUIRED_FIELDS = ["fajr", "sunrise", "dhuhr", "asr", "maghrib", "isha"] as const;
type RequiredField = (typeof REQUIRED_FIELDS)[number];

export function validateTimetable(times: TimetableTimes): TimetableIssue[] {
  const issues: TimetableIssue[] = [];
  const parsed: Partial<Record<RequiredField, number>> = {};

  // Parse first. Ordering checks against an unparseable value would produce
  // nonsense messages like "Sunrise must be later than Fajr" when the real
  // problem is that sunrise is empty.
  let missingOrInvalid = false;
  for (const field of REQUIRED_FIELDS) {
    const minutes = timeToMinutes(times[field] ?? "");
    if (minutes === null) {
      issues.push({
        field,
        message: `${label(field)} is not a valid 24-hour time.`,
        severity: "error",
      });
      missingOrInvalid = true;
    } else {
      parsed[field] = minutes;
    }
  }

  let sunset: number | null = null;
  if (times.sunset) {
    sunset = timeToMinutes(times.sunset);
    if (sunset === null) {
      issues.push({
        field: "sunset",
        message: "Sunset is not a valid 24-hour time.",
        severity: "error",
      });
      return issues;
    }
  }

  if (missingOrInvalid) return issues;

  const t = parsed as Record<RequiredField, number>;

  // --- Errors: orderings that are impossible anywhere ------------------------

  const ordered: Array<[RequiredField, RequiredField]> = [
    ["fajr", "sunrise"],
    ["sunrise", "dhuhr"],
    ["dhuhr", "asr"],
    ["asr", "maghrib"],
    ["maghrib", "isha"],
  ];

  for (const [earlier, later] of ordered) {
    if (t[earlier] >= t[later]) {
      issues.push({
        field: later,
        message: `${label(later)} must be later than ${label(earlier)}.`,
        severity: "error",
      });
    }
  }

  // --- Warnings: unusual for Bangladesh, but a source may really say so ------

  if (t.sunrise - t.fajr < 45) {
    issues.push({
      field: "sunrise",
      message:
        "Fajr and sunrise are less than 45 minutes apart, which is unusual for Bangladesh. Confirm both against the source.",
      severity: "warning",
    });
  }

  if (t.isha - t.maghrib < 30) {
    issues.push({
      field: "isha",
      message:
        "Isha is less than 30 minutes after Maghrib. Check whether the source prints an Isha interval in minutes rather than a clock time.",
      severity: "warning",
    });
  }

  if (t.asr - t.dhuhr > 6 * 60) {
    issues.push({
      field: "asr",
      message:
        "Asr is more than six hours after Dhuhr. Confirm the Asr madhhab matches the source.",
      severity: "warning",
    });
  }

  if (sunset !== null) {
    if (sunset < t.asr) {
      issues.push({ field: "sunset", message: "Sunset is before Asr.", severity: "warning" });
    }
    if (sunset > t.isha) {
      issues.push({ field: "sunset", message: "Sunset is after Isha.", severity: "warning" });
    }
    if (Math.abs(sunset - t.maghrib) > 60) {
      issues.push({
        field: "sunset",
        message:
          "Sunset and Maghrib are more than an hour apart. Maghrib is usually sunset plus a few minutes.",
        severity: "warning",
      });
    }
  }

  return issues;
}

function label(field: string): string {
  return field.charAt(0).toUpperCase() + field.slice(1);
}

export function timetableHasErrors(issues: TimetableIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

// --- Form schema -------------------------------------------------------------

export const prayerTimingSchema = z
  .object({
    id: optionalUuid("Timetable record"),
    target_type: z.enum(["thana", "locality"]),
    thana_id: optionalUuid("Thana / Upazila"),
    locality_id: optionalUuid("Locality"),
    prayer_date: dateOnly("Date"),
    timezone: z.string().trim().min(1).max(64).default("Asia/Dhaka"),
    fajr: timeOnly("Fajr"),
    sunrise: timeOnly("Sunrise"),
    dhuhr: timeOnly("Dhuhr"),
    asr: timeOnly("Asr"),
    maghrib: timeOnly("Maghrib"),
    isha: timeOnly("Isha"),
    sunset: optionalTimeOnly("Sunset"),
    source_name: optionalText(200, "Source name"),
    source_url: optionalHttpUrl("Source URL"),
    notes: optionalText(2000, "Notes"),
    confirm_reviewed: booleanFromForm.optional(),
  })
  .superRefine((value, ctx) => {
    // The database enforces "exactly one target" with a CHECK constraint; this
    // produces a message a person can act on instead.
    if (value.target_type === "thana" && !value.thana_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["thana_id"],
        message: "Select the thana/upazila this timetable applies to.",
      });
    }
    if (value.target_type === "locality" && !value.locality_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["locality_id"],
        message: "Select the locality this timetable applies to.",
      });
    }

    const issues = validateTimetable(value).filter((issue) => issue.severity === "error");
    for (const issue of issues) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [issue.field],
        message: issue.message,
      });
    }
  });

export type PrayerTimingInput = z.infer<typeof prayerTimingSchema>;
