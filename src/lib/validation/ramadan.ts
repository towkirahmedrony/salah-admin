import { z } from "zod";

import {
  dateOnly,
  enumFromForm,
  optionalHttpUrl,
  optionalInteger,
  optionalText,
  optionalTimeOnly,
  optionalUuid,
  requiredInteger,
} from "@/lib/validation/common";

export const RAMADAN_START_TYPES = ["calculated", "officially_confirmed"] as const;
export type RamadanStartTypeInput = (typeof RAMADAN_START_TYPES)[number];

export const RAMADAN_START_TYPE_LABELS: Record<RamadanStartTypeInput, string> = {
  calculated: "Calculated (timetable projection)",
  officially_confirmed: "Officially confirmed (moon sighting)",
};

export const RAMADAN_START_TYPE_HELP: Record<RamadanStartTypeInput, string> = {
  calculated:
    "A projected start date. The Salah app labels this as calculated and does not present it as a national decision.",
  officially_confirmed:
    "A start date confirmed by an official announcement. Requires a named source so the confirmation can be traced.",
};

export const ramadanVersionSchema = z
  .object({
    id: optionalUuid("Calendar version"),
    ramadan_year: requiredInteger(1900, 2200, "Ramadan year"),
    hijri_year: optionalInteger(1300, 1600, "Hijri year"),
    thana_id: optionalUuid("Thana / Upazila"),
    expected_start_date: dateOnly("Expected start date"),
    start_date_type: enumFromForm(RAMADAN_START_TYPES, "Start date type"),
    source_name: optionalText(200, "Source name"),
    source_url: optionalHttpUrl("Source URL"),
    notes: optionalText(2000, "Notes"),
  })
  .superRefine((value, ctx) => {
    if (value.start_date_type === "officially_confirmed" && !value.source_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_name"],
        message:
          "An officially confirmed start date must name the source of the confirmation.",
      });
    }

    // The convention is the Gregorian year Ramadan begins in. A start date in a
    // different year is usually a typo, so it is flagged even if it is not
    // strictly impossible.
    const startYear = Number(value.expected_start_date.slice(0, 4));
    if (Number.isFinite(startYear) && startYear !== value.ramadan_year) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["expected_start_date"],
        message: `Ramadan ${value.ramadan_year} should begin in ${value.ramadan_year}, but this date is in ${startYear}.`,
      });
    }
  });

export const ramadanDaySchema = z
  .object({
    id: optionalUuid("Calendar day"),
    day_number: requiredInteger(1, 30, "Ramadan day"),
    gregorian_date: dateOnly("Gregorian date"),
    hijri_date: optionalText(60, "Hijri date"),
    imsak_time: optionalTimeOnly("Imsak time"),
    sehri_end_time: optionalTimeOnly("Sehri end time"),
    iftar_time: optionalTimeOnly("Iftar time"),
    source_name: optionalText(200, "Source name"),
    source_url: optionalHttpUrl("Source URL"),
    verification_status: enumFromForm(
      ["unverified", "verified", "rejected"] as const,
      "Verification status",
    ),
    notes: optionalText(1000, "Notes"),
  })
  .superRefine((value, ctx) => {
    // Imsak and Sehri end are separate fields on purpose; the only constraint is
    // that Imsak cannot come after Sehri ends.
    if (
      value.imsak_time &&
      value.sehri_end_time &&
      value.imsak_time > value.sehri_end_time
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["imsak_time"],
        message: "Imsak cannot be later than the Sehri end time.",
      });
    }

    if (value.sehri_end_time && value.iftar_time && value.sehri_end_time >= value.iftar_time) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["iftar_time"],
        message: "Iftar must be later than the Sehri end time.",
      });
    }

    if (value.verification_status === "verified" && !value.source_name) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["source_name"],
        message: "A verified day must name the source its times were checked against.",
      });
    }
  });

export type RamadanVersionInput = z.infer<typeof ramadanVersionSchema>;
export type RamadanDayInput = z.infer<typeof ramadanDaySchema>;

// --- Pre-publication review --------------------------------------------------

export interface RamadanDayForReview {
  day_number: number;
  gregorian_date: string;
  sehri_end_time: string | null;
  iftar_time: string | null;
  verification_status: "unverified" | "verified" | "rejected";
}

export interface RamadanCalendarForReview {
  ramadan_year: number;
  expected_start_date: string | null;
  start_date_type: RamadanStartTypeInput;
  source_name: string | null;
  days: RamadanDayForReview[];
}

export interface RamadanIssue {
  severity: "error" | "warning";
  message: string;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/**
 * Reviews a Ramadan calendar before publication.
 *
 * Errors are the structural failures that make a published calendar unusable:
 * a wrong length, a missing day, a duplicate date, times that are absent or in
 * the wrong order. Everything else — an unverified row, a missing Hijri label,
 * a start date that disagrees with the projection — is a warning, because the
 * reviewer may be working from a source that is right and a projection that is
 * wrong.
 */
export function validateRamadanCalendar(
  calendar: RamadanCalendarForReview,
): RamadanIssue[] {
  const issues: RamadanIssue[] = [];
  const days = [...calendar.days].sort((a, b) => a.day_number - b.day_number);

  if (days.length === 0) {
    issues.push({ severity: "error", message: "The calendar has no daily records." });
    return issues;
  }

  if (days.length !== 29 && days.length !== 30) {
    issues.push({
      severity: "error",
      message: `Ramadan is 29 or 30 days; this calendar has ${days.length}.`,
    });
  }

  // --- Day numbering ---------------------------------------------------------
  const seenNumbers = new Set<number>();
  for (const day of days) {
    if (seenNumbers.has(day.day_number)) {
      issues.push({
        severity: "error",
        message: `Day ${day.day_number} appears more than once.`,
      });
    }
    seenNumbers.add(day.day_number);
  }

  const highest = days[days.length - 1]!.day_number;
  for (let expected = 1; expected <= highest; expected += 1) {
    if (!seenNumbers.has(expected)) {
      issues.push({
        severity: "error",
        message: `Day ${expected} is missing. Day numbering must run from 1 without gaps.`,
      });
    }
  }

  // --- Dates -----------------------------------------------------------------
  const seenDates = new Set<string>();
  for (const day of days) {
    if (seenDates.has(day.gregorian_date)) {
      issues.push({
        severity: "error",
        message: `${day.gregorian_date} is used by more than one day.`,
      });
    }
    seenDates.add(day.gregorian_date);
  }

  if (calendar.expected_start_date) {
    const first = days[0]!;
    if (first.gregorian_date !== calendar.expected_start_date) {
      issues.push({
        severity: "warning",
        message: `Day 1 is dated ${first.gregorian_date} but the expected start date is ${calendar.expected_start_date}.`,
      });
    }

    for (let index = 1; index < days.length; index += 1) {
      const previous = days[index - 1]!;
      const current = days[index]!;
      const expected = addDays(previous.gregorian_date, 1);

      if (current.gregorian_date !== expected) {
        issues.push({
          severity: "error",
          message: `Day ${current.day_number} is dated ${current.gregorian_date} but should be ${expected}, the day after day ${previous.day_number}.`,
        });
      }
    }

  }

  // --- Times -----------------------------------------------------------------
  for (const day of days) {
    if (!day.sehri_end_time || !day.iftar_time) {
      issues.push({
        severity: "error",
        message: `Day ${day.day_number} is missing the Sehri end time or the Iftar time.`,
      });
      continue;
    }

    if (day.sehri_end_time >= day.iftar_time) {
      issues.push({
        severity: "error",
        message: `Day ${day.day_number}: Iftar must be later than the Sehri end time.`,
      });
    }
  }

  // --- Provenance ------------------------------------------------------------
  if (calendar.start_date_type === "officially_confirmed" && !calendar.source_name) {
    issues.push({
      severity: "error",
      message: "An officially confirmed start date must name its source.",
    });
  }

  if (!calendar.source_name) {
    issues.push({
      severity: "warning",
      message: "No source is recorded for this calendar. Reviewers should record where it came from.",
    });
  }

  const unverified = days.filter((day) => day.verification_status === "unverified").length;
  if (unverified > 0) {
    issues.push({
      severity: "warning",
      message: `${unverified} of ${days.length} days are still marked unverified. Publishing records your review, not a religious verification.`,
    });
  }

  return issues;
}

export function ramadanIssuesHaveErrors(issues: RamadanIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

// --- Bulk line entry ---------------------------------------------------------

/**
 * Parses pasted `day | date | imsak | sehri | iftar` lines.
 *
 * Times are left exactly as typed: a value that does not parse is reported
 * rather than guessed, so nothing is invented.
 */
export const ramadanBulkLineSchema = z.object({
  lines: z.string().transform((value) =>
    value
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0 && !line.startsWith("#")),
  ),
});

export interface ParsedRamadanLine {
  lineNumber: number;
  dayNumber: number | null;
  gregorianDate: string | null;
  imsakTime: string | null;
  sehriEndTime: string | null;
  iftarTime: string | null;
  problem: string | null;
}

/**
 * Parses pasted calendar lines for the bulk-entry helper.
 *
 * Expected shape: `day | gregorian date | imsak | sehri end | iftar`, where the
 * last three may be blank. A unparseable line is returned with a `problem`
 * message rather than being silently skipped, so nothing is quietly invented and
 * nothing is quietly dropped.
 */
export function parseRamadanBulkLines(input: string): ParsedRamadanLine[] {
  return input
    .split("\n")
    .map((raw, index) => ({ raw: raw.trim(), lineNumber: index + 1 }))
    .filter(({ raw }) => raw.length > 0 && !raw.startsWith("#"))
    .map(({ raw, lineNumber }) => {
      const parts = raw.split("|").map((part) => part.trim());
      const [dayPart, datePart, imsakPart, sehriPart, iftarPart] = parts;

      const dayNumber = dayPart && /^\d{1,2}$/.test(dayPart) ? Number(dayPart) : null;
      const gregorianDate =
        datePart && /^\d{4}-\d{2}-\d{2}$/.test(datePart) ? datePart : null;

      const parseTime = (value: string | undefined): string | null => {
        if (!value) return null;
        const match = /^(\d{1,2}):(\d{2})(?::(\d{2}))?$/.exec(value);
        if (!match) return null;
        const hours = Number(match[1]);
        const minutes = Number(match[2]);
        if (hours > 23 || minutes > 59) return null;
        return `${String(hours).padStart(2, "0")}:${match[2]}:${match[3] ?? "00"}`;
      };

      let problem: string | null = null;
      if (dayNumber === null || dayNumber < 1 || dayNumber > 30) {
        problem = "Day number must be between 1 and 30.";
      } else if (gregorianDate === null) {
        problem = "Date must be in YYYY-MM-DD format.";
      } else if (imsakPart && !parseTime(imsakPart)) {
        problem = "Imsak time is not a valid 24-hour time.";
      } else if (sehriPart && !parseTime(sehriPart)) {
        problem = "Sehri end time is not a valid 24-hour time.";
      } else if (iftarPart && !parseTime(iftarPart)) {
        problem = "Iftar time is not a valid 24-hour time.";
      }

      return {
        lineNumber,
        dayNumber,
        gregorianDate,
        imsakTime: parseTime(imsakPart),
        sehriEndTime: parseTime(sehriPart),
        iftarTime: parseTime(iftarPart),
        problem,
      };
    });
}
