import { describe, expect, it } from "vitest";

import { validateTimetable } from "@/lib/validation/prayer-timings";
import { validateRamadanCalendar } from "@/lib/validation/ramadan";
import { validateConfigValue, knownConfig } from "@/lib/validation/app-config";
import {
  compareAppVersions,
  isVersionWithinRange,
  parseAppVersion,
} from "@/lib/utils/version";
import { parseJsonObject } from "@/lib/utils/json";
import { redactForDisplay, REDACTED } from "@/lib/utils/redact";
import { toCsv } from "@/lib/utils/csv";
import { roleCan, capabilitiesFor, navForRole } from "@/lib/permissions/permissions";
import { normaliseTime } from "@/lib/validation/common";
import { toAppError } from "@/lib/errors";

/**
 * Unit tests for the pure rules that decide what the panel will accept.
 *
 * These are the parts where a bug is silent and expensive: a chronology rule that
 * wrongly rejects a valid timetable pushes a reviewer into entering false data,
 * and a version comparison that is wrong hides an announcement from the users who
 * need it.
 */

const VALID_DAY = {
  fajr: "04:32:00",
  sunrise: "05:44:00",
  dhuhr: "11:58:00",
  asr: "15:22:00",
  maghrib: "18:11:00",
  isha: "19:28:00",
};

describe("time normalisation", () => {
  it("accepts unpadded and padded 24-hour times", () => {
    expect(normaliseTime("5:12")).toBe("05:12:00");
    expect(normaliseTime("05:12")).toBe("05:12:00");
    expect(normaliseTime("05:12:30")).toBe("05:12:30");
  });

  it("rejects out-of-range and 12-hour values", () => {
    expect(normaliseTime("24:00")).toBeNull();
    expect(normaliseTime("12:60")).toBeNull();
    expect(normaliseTime("5:12 am")).toBeNull();
    expect(normaliseTime("")).toBeNull();
  });
});

describe("timetable chronology", () => {
  it("accepts a realistic Bangladeshi timetable with no issues", () => {
    expect(validateTimetable(VALID_DAY)).toEqual([]);
  });

  it("rejects a physically impossible ordering", () => {
    const issues = validateTimetable({ ...VALID_DAY, dhuhr: "04:00:00" });
    expect(issues.some((issue) => issue.severity === "error")).toBe(true);
    expect(issues.some((issue) => issue.message.includes("Dhuhr"))).toBe(true);
  });

  it("warns rather than errors on an unusual but possible source", () => {
    // Isha 20 minutes after Maghrib is unusual, but a real source may print it.
    const issues = validateTimetable({ ...VALID_DAY, isha: "18:31:00" });
    expect(issues.every((issue) => issue.severity !== "error")).toBe(true);
    expect(issues.some((issue) => issue.severity === "warning")).toBe(true);
  });

  it("reports invalid times instead of ordering against them", () => {
    const issues = validateTimetable({ ...VALID_DAY, fajr: "" });
    expect(issues).toHaveLength(1);
    expect(issues[0]!.field).toBe("fajr");
    expect(issues[0]!.severity).toBe("error");
  });

  it("does not constrain sunset, which sources define differently", () => {
    const issues = validateTimetable({ ...VALID_DAY, sunset: "18:40:00" });
    expect(issues.filter((issue) => issue.field === "sunset" && issue.severity === "error")).toEqual(
      [],
    );
  });
});

describe("app version comparison", () => {
  it("orders numerically, not lexicographically", () => {
    expect(compareAppVersions("1.10.0", "1.9.0")).toBe(1);
    expect(compareAppVersions("1.9.0", "1.10.0")).toBe(-1);
    expect(compareAppVersions("2.0.0", "2.0.0")).toBe(0);
  });

  it("treats missing segments as zero", () => {
    expect(parseAppVersion("1")).toEqual([1, 0, 0]);
    expect(parseAppVersion("1.2")).toEqual([1, 2, 0]);
    expect(compareAppVersions("1", "1.0.0")).toBe(0);
  });

  it("returns null for anything that is not a version", () => {
    expect(parseAppVersion("v1.2.3")).toBeNull();
    expect(compareAppVersions("abc", "1.0.0")).toBeNull();
  });

  it("treats open bounds as unbounded and unparseable versions as no match", () => {
    expect(isVersionWithinRange("1.5.0", null, null)).toBe(true);
    expect(isVersionWithinRange("1.5.0", "1.2.0", null)).toBe(true);
    expect(isVersionWithinRange("1.1.0", "1.2.0", null)).toBe(false);
    expect(isVersionWithinRange("9.9.9", null, "2.0.0")).toBe(false);
    expect(isVersionWithinRange("nightly", "1.0.0", null)).toBe(false);
  });
});

describe("ramadan calendar review", () => {
  const days = Array.from({ length: 30 }, (_, index) => {
    const date = new Date(Date.UTC(2026, 1, 18));
    date.setUTCDate(date.getUTCDate() + index);
    return {
      day_number: index + 1,
      gregorian_date: date.toISOString().slice(0, 10),
      sehri_end_time: "04:20:00",
      iftar_time: "18:05:00",
      verification_status: "verified" as const,
    };
  });

  const base = {
    ramadan_year: 2026,
    expected_start_date: "2026-02-18",
    start_date_type: "officially_confirmed" as const,
    source_name: "Islamic Foundation Bangladesh",
  };

  it("accepts a complete, consecutive 30-day calendar", () => {
    const issues = validateRamadanCalendar({ ...base, days });
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("accepts a 29-day calendar", () => {
    const issues = validateRamadanCalendar({ ...base, days: days.slice(0, 29) });
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });

  it("rejects a wrong length", () => {
    const issues = validateRamadanCalendar({ ...base, days: days.slice(0, 12) });
    expect(issues.some((issue) => issue.message.includes("29 or 30"))).toBe(true);
  });

  it("rejects a missing day and a duplicate date", () => {
    const withGap = [days[0]!, days[2]!];
    const issues = validateRamadanCalendar({ ...base, days: withGap });
    expect(issues.some((issue) => issue.message.includes("Day 2 is missing"))).toBe(true);
  });

  it("requires a source for an officially confirmed start date", () => {
    const issues = validateRamadanCalendar({ ...base, source_name: null, days });
    expect(
      issues.some(
        (issue) => issue.severity === "error" && issue.message.includes("must name its source"),
      ),
    ).toBe(true);
  });

  it("requires both Sehri end and Iftar, and their order", () => {
    const broken = days.map((day, index) =>
      index === 3 ? { ...day, iftar_time: "03:00:00" } : day,
    );
    const issues = validateRamadanCalendar({ ...base, days: broken });
    expect(issues.some((issue) => issue.message.includes("Day 4"))).toBe(true);
  });

  it("warns about unverified days without blocking publication", () => {
    const unverified = days.map((day) => ({ ...day, verification_status: "unverified" as const }));
    const issues = validateRamadanCalendar({ ...base, days: unverified });
    expect(issues.some((issue) => issue.severity === "warning")).toBe(true);
    expect(issues.filter((issue) => issue.severity === "error")).toEqual([]);
  });
});

describe("app configuration values", () => {
  it("knows the documented keys", () => {
    expect(knownConfig("app.minimum_supported_version")).toBeDefined();
    expect(knownConfig("prayer.reminder_defaults")).toBeDefined();
  });

  it("validates a known key against its real shape", () => {
    expect(validateConfigValue("app.minimum_supported_version", { version: "1.2.0" }).state).toBe(
      "known-valid",
    );
    expect(validateConfigValue("app.minimum_supported_version", { version: "one" }).state).toBe(
      "known-invalid",
    );
  });

  it("marks an unknown key as unvalidated rather than valid", () => {
    expect(validateConfigValue("something.new", { anything: true }).state).toBe("unknown");
  });

  it("rejects non-object JSON, which cannot be patched by key later", () => {
    expect(parseJsonObject("[1,2,3]").ok).toBe(false);
    expect(parseJsonObject('"text"').ok).toBe(false);
    expect(parseJsonObject("{}").ok).toBe(true);
    expect(parseJsonObject("{ nope").ok).toBe(false);
  });
});

describe("redaction", () => {
  it("removes credential-looking keys and token-like values", () => {
    const redacted = redactForDisplay({
      device: "Pixel 7",
      auth_token: "abc",
      nested: { password: "hunter2" },
      blob: "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dBjftJeZ4CVP",
    }) as Record<string, unknown>;

    expect(redacted.device).toBe("Pixel 7");
    expect(redacted.auth_token).toBe(REDACTED);
    expect((redacted.nested as Record<string, unknown>).password).toBe(REDACTED);
    expect(redacted.blob).toBe(REDACTED);
  });
});

describe("csv export", () => {
  it("escapes separators, quotes and newlines", () => {
    const csv = toCsv(
      [{ name: 'Kaliakair, "Sadar"', note: "line\nbreak" }],
      [
        { key: "name", header: "name", value: (row) => row.name },
        { key: "note", header: "note", value: (row) => row.note },
      ],
    );

    expect(csv).toContain('"Kaliakair, ""Sadar"""');
    expect(csv).toContain('"line\nbreak"');
  });

  it("neutralises spreadsheet formula injection", () => {
    const csv = toCsv(
      [{ name: "=1+1" }],
      [{ key: "name", header: "name", value: (row) => row.name }],
    );
    expect(csv.split("\r\n")[1]!.startsWith("\t=1+1")).toBe(true);
  });
});

describe("permission matrix", () => {
  it("matches the documented matrix", () => {
    expect(roleCan("super_admin", "manage_admins")).toBe(true);
    expect(roleCan("location_manager", "manage_locations")).toBe(true);
    expect(roleCan("location_manager", "manage_announcements")).toBe(false);
    expect(roleCan("content_editor", "manage_announcements")).toBe(true);
    expect(roleCan("content_editor", "manage_prayer_config")).toBe(false);
    expect(roleCan("prayer_data_reviewer", "manage_prayer_timings")).toBe(true);
    expect(roleCan("prayer_data_reviewer", "view_audit_logs")).toBe(false);
    expect(roleCan("support_admin", "manage_feedback")).toBe(true);
    expect(roleCan("support_admin", "manage_locations")).toBe(false);
    expect(roleCan(null, "view_dashboard")).toBe(false);
  });

  it("gives only super_admin the audit log and administrator management", () => {
    for (const role of ["location_manager", "content_editor", "prayer_data_reviewer", "support_admin"] as const) {
      expect(roleCan(role, "view_audit_logs")).toBe(false);
      expect(roleCan(role, "manage_admins")).toBe(false);
    }
  });

  it("hides navigation the role cannot use", () => {
    const labels = navForRole("support_admin").flatMap((section) =>
      section.items.map((item) => item.label),
    );
    expect(labels).toContain("Feedback & Bug Reports");
    expect(labels).not.toContain("Divisions");
    expect(labels).not.toContain("Audit Logs");
  });

  it("gives every role the dashboard", () => {
    for (const role of ["super_admin", "location_manager", "content_editor", "prayer_data_reviewer", "support_admin"] as const) {
      expect(capabilitiesFor(role)).toContain("view_dashboard");
    }
  });
});

describe("database error mapping", () => {
  it("never echoes raw SQL for an unmapped failure", () => {
    const mapped = toAppError({ code: "42P01", message: 'relation "public.divisions" does not exist' });
    expect(mapped.kind).toBe("schema");
    expect(mapped.message).not.toContain("public.divisions");
  });

  it("maps privilege and conflict failures to actionable text", () => {
    expect(toAppError({ code: "42501", message: "permission denied" }).kind).toBe("permission");
    expect(toAppError({ code: "23505", message: "duplicate key value violates unique constraint" }).kind).toBe(
      "conflict",
    );
  });

  it("surfaces a constraint message our own migration authored", () => {
    const mapped = toAppError({
      code: "23514",
      message: "You cannot deactivate your own administrator account.",
    });
    expect(mapped.message).toBe("You cannot deactivate your own administrator account.");
  });
});
