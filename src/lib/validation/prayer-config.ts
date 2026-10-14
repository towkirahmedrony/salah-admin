import { z } from "zod";

import {
  booleanFromForm,
  optionalDateOnly,
  optionalDecimal,
  optionalHttpUrl,
  optionalInteger,
  optionalText,
  optionalUuid,
  requiredDecimal,
  trimmedText,
} from "@/lib/validation/common";

/**
 * Prayer calculation parameters.
 *
 * These describe what the Android app's own offline engine (Adhan Kotlin,
 * vendored in the app as `com.batoulapps.adhan:adhan2`) should be configured
 * with. The panel never computes prayer times itself and never replaces that
 * engine; it publishes parameters the app already knows how to read.
 */

export const ASR_MADHHABS = ["shafi", "hanafi"] as const;
export const HIGH_LATITUDE_RULES = [
  "none",
  "middle_of_the_night",
  "seventh_of_the_night",
  "twilight_angle",
] as const;
export const PRAYER_CONFIG_SCOPES = ["global", "thana"] as const;

export const ASR_MADHHAB_LABELS: Record<(typeof ASR_MADHHABS)[number], string> = {
  shafi: "Shafi — earlier Asr (shadow ratio 1)",
  hanafi: "Hanafi — later Asr (shadow ratio 2)",
};

export const HIGH_LATITUDE_RULE_LABELS: Record<(typeof HIGH_LATITUDE_RULES)[number], string> = {
  none: "None — undefined at extreme latitudes",
  middle_of_the_night: "Middle of the night",
  seventh_of_the_night: "One seventh of the night",
  twilight_angle: "Twilight angle",
};

export const HIGH_LATITUDE_RULE_HELP: Record<(typeof HIGH_LATITUDE_RULES)[number], string> = {
  none: "The app's default. Appropriate for Bangladesh, where the sun never fails to set or rise.",
  middle_of_the_night: "Fajr and Isha are placed at the midpoint of the night.",
  seventh_of_the_night: "Fajr and Isha are placed one seventh of the night from their respective ends.",
  twilight_angle: "Fajr and Isha are limited by the twilight angle.",
};

/** Recognised engine identifiers. Publishing for an unknown engine is refused. */
export const SUPPORTED_ENGINES: Record<string, { label: string; versions: string[] }> = {
  adhan_kotlin: {
    label: "Adhan Kotlin (com.batoulapps.adhan:adhan2)",
    versions: ["0.0.5"],
  },
};

export const DEFAULT_TIMEZONE = "Asia/Dhaka";

/** `Intl` is the authority on whether a zone identifier is real. */
export function isValidTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

export const prayerCalculationConfigSchema = z
  .object({
    id: optionalUuid("Configuration"),
    name: trimmedText(160, "Configuration name"),
    scope: z.enum(PRAYER_CONFIG_SCOPES),
    thana_id: optionalUuid("Thana / Upazila"),
    engine_key: z.string().trim().min(1).max(64),
    engine_version: z.string().trim().min(1).max(32),
    calculation_method: optionalText(64, "Calculation method"),
    fajr_angle: requiredDecimal(0, 30, "Fajr angle"),
    isha_angle: optionalDecimal(0, 30, "Isha angle"),
    isha_interval_minutes: optionalInteger(0, 240, "Isha interval"),
    asr_madhhab: z.enum(ASR_MADHHABS),
    high_latitude_rule: z.enum(HIGH_LATITUDE_RULES),
    timezone: z
      .string()
      .trim()
      .min(1)
      .max(64)
      .refine(isValidTimezone, { message: "Enter a valid IANA timezone such as Asia/Dhaka." }),
    effective_from: optionalDateOnly("Effective from"),
    effective_to: optionalDateOnly("Effective to"),
    source_name: optionalText(200, "Source name"),
    source_url: optionalHttpUrl("Source URL"),
    notes: optionalText(2000, "Notes"),
    confirm_reviewed: booleanFromForm.optional(),
  })
  .superRefine((value, ctx) => {
    if (value.scope === "thana" && !value.thana_id) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["thana_id"],
        message: "A thana-specific configuration must select its thana/upazila.",
      });
    }

    // The engine takes one or the other; both or neither leaves undefined behaviour.
    const hasAngle = value.isha_angle !== undefined;
    const hasInterval = value.isha_interval_minutes !== undefined;

    if (hasAngle && hasInterval) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isha_angle"],
        message:
          "Provide either an Isha angle or an Isha interval, not both — the engine accepts one definition of Isha.",
      });
    }

    if (!hasAngle && !hasInterval) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["isha_interval_minutes"],
        message: "Provide either an Isha angle or an Isha interval.",
      });
    }

    if (
      value.effective_from &&
      value.effective_to &&
      value.effective_to < value.effective_from
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effective_to"],
        message: "The effective-to date cannot be before the effective-from date.",
      });
    }

    if (!SUPPORTED_ENGINES[value.engine_key]) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["engine_key"],
        message:
          "This engine is not recognised. Publishing parameters for an engine the app does not ship would have no effect.",
      });
      return;
    }

    const versions = SUPPORTED_ENGINES[value.engine_key]!.versions;
    if (!versions.includes(value.engine_version)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["engine_version"],
        message: `Known ${value.engine_key} versions: ${versions.join(", ")}. Publishing a different version would not be read by the app.`,
      });
    }
  });

export type PrayerCalculationConfigInput = z.infer<typeof prayerCalculationConfigSchema>;

export interface PrayerConfigForPublish {
  name: string;
  scope: "global" | "thana";
  engine_key: string;
  engine_version: string;
  fajr_angle: number | null;
  isha_angle: number | null;
  isha_interval_minutes: number | null;
  asr_madhhab: string;
  high_latitude_rule: string;
  timezone: string;
  source_name: string | null;
}

export interface PrayerConfigIssue {
  severity: "error" | "warning";
  message: string;
}

/**
 * Checks a configuration immediately before publication.
 *
 * The last line is deliberate: publishing is an administrative act, and the
 * panel must not let that read as a religious endorsement. Only the value of the
 * source is being asserted here.
 */
export function reviewPrayerConfigForPublish(
  config: PrayerConfigForPublish,
): PrayerConfigIssue[] {
  const issues: PrayerConfigIssue[] = [];

  if (config.fajr_angle === null) {
    issues.push({ severity: "error", message: "A Fajr angle is required before publishing." });
  }

  if (config.isha_angle === null && config.isha_interval_minutes === null) {
    issues.push({
      severity: "error",
      message: "Set either an Isha angle or an Isha interval before publishing.",
    });
  }

  if (!config.source_name) {
    issues.push({
      severity: "error",
      message:
        "Record the source these parameters came from. A published configuration without a source cannot be reviewed later.",
    });
  }

  if (!isValidTimezone(config.timezone)) {
    issues.push({
      severity: "error",
      message: `"${config.timezone}" is not a valid timezone. Bangladesh uses Asia/Dhaka.`,
    });
  }

  if (!SUPPORTED_ENGINES[config.engine_key]) {
    issues.push({
      severity: "error",
      message: "The engine key is not one the app ships, so publishing would have no effect.",
    });
  } else if (!SUPPORTED_ENGINES[config.engine_key]!.versions.includes(config.engine_version)) {
    issues.push({
      severity: "error",
      message: `Engine version ${config.engine_version} is not known for ${config.engine_key}.`,
    });
  }

  if (config.scope === "global") {
    issues.push({
      severity: "warning",
      message:
        "This is the global configuration, so it applies to every location without its own override.",
    });
  }

  return issues;
}

export function prayerConfigIssuesHaveErrors(issues: PrayerConfigIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}
