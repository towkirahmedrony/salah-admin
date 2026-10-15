import { z } from "zod";

import {
  booleanFromForm,
  optionalDateOnly,
  optionalHttpUrl,
  optionalText,
  optionalUuid,
  trimmedText,
} from "@/lib/validation/common";
import type {
  AsrMadhhab,
  HighLatitudeRule,
  PrayerCalculationConfigRow,
  PrayerCalculationMethod,
  PrayerConfigScope,
} from "@/lib/types/database";

/**
 * Prayer calculation parameters.
 *
 * These describe what the Android app's own offline engine (Adhan Kotlin,
 * vendored as `com.batoulapps.adhan:adhan2`, pinned `0.0.5`) should be
 * configured with. The panel never computes prayer times itself and never
 * replaces that engine; it publishes parameters the app already knows how to read.
 *
 * Every vocabulary below was read out of the Android repository, not inferred from
 * other prayer-time applications:
 *
 *   core/model/PrayerCalculationMethod.kt   -> PRAYER_CALCULATION_METHODS
 *   core/model/PrayerCalculationProfile.kt  -> AsrCalculationMethod, HighLatitudeRule
 *   core/model/PrayerSettings.kt            -> MAX_ADJUSTMENT_MINUTES
 *
 * If a vocabulary here does not exist in that repository, it must not exist here:
 * a setting the engine cannot read is a lie in a configuration screen.
 * See docs/PRAYER_CONFIGURATION.md.
 */

// --- Schema version ----------------------------------------------------------

/**
 * Version of the *published payload contract*, not of the engine and not of the
 * panel. The Android app must reject a payload whose version it does not know
 * rather than applying the fields it recognises.
 */
export const PRAYER_CONFIG_SCHEMA_VERSION = 1;

/**
 * Whether a payload schema version is one this contract defines.
 *
 * The Android app's rule, stated once so it can be tested and cited: a payload whose
 * version is newer than the app's highest known version must be **rejected**, not
 * partially applied, because a newer version may mean any unrecognised field has
 * changed meaning. A version below 1 is malformed rather than old.
 */
export function isSupportedConfigSchemaVersion(version: number): boolean {
  return Number.isInteger(version) && version >= 1 && version <= PRAYER_CONFIG_SCHEMA_VERSION;
}

// --- Scope -------------------------------------------------------------------

export const PRAYER_CONFIG_SCOPES = ["global", "division", "district", "thana"] as const;

export const SCOPE_LABELS: Record<PrayerConfigScope, string> = {
  global: "Global — every location",
  division: "Division",
  district: "District",
  thana: "Thana / Upazila",
};

export const SCOPE_SHORT_LABELS: Record<PrayerConfigScope, string> = {
  global: "Global",
  division: "Division",
  district: "District",
  thana: "Thana",
};

/**
 * The column that holds the target location for each scope, or `null` for global.
 *
 * A dedicated column per level rather than one polymorphic id, so each level keeps a
 * real foreign key and the database — not application code — guarantees that a
 * configuration points at a location that exists.
 */
export const SCOPE_TARGET_COLUMN: Record<
  PrayerConfigScope,
  "division_id" | "district_id" | "thana_id" | null
> = {
  global: null,
  division: "division_id",
  district: "district_id",
  thana: "thana_id",
};

/**
 * Most specific first. This is the precedence the Android app must apply, and the
 * order `public.resolve_prayer_config()` implements.
 *
 * `locality` is not in this list: the app's stored locality reference has no stable
 * id (its source is an OpenStreetMap neighbourhood layer), so a locality override
 * could never be resolved by the app. Scope stops at thana. See
 * docs/PRAYER_CONFIGURATION.md section 3.2.
 */
export const SCOPE_PRECEDENCE: readonly PrayerConfigScope[] = [
  "thana",
  "district",
  "division",
  "global",
];

/** The target id a configuration row points at, or `null` for a global row. */
export function scopeTargetId(
  config: Pick<PrayerCalculationConfigRow, "scope" | "division_id" | "district_id" | "thana_id">,
): string | null {
  const column = SCOPE_TARGET_COLUMN[config.scope];
  return column ? config[column] : null;
}

// --- Calculation method ------------------------------------------------------

export const PRAYER_CALCULATION_METHODS = [
  "karachi",
  "muslim_world_league",
  "egyptian",
  "umm_al_qura",
  "dubai",
  "moon_sighting_committee",
  "north_america",
  "kuwait",
  "qatar",
  "singapore",
  "turkey",
] as const;

/** The engine's own angles for a method, mirrors of `PrayerCalculationMethod`. */
export interface MethodEngineParameters {
  fajrAngleDegrees: number;
  /** `null` when the engine defines Isha as an interval instead of an angle. */
  ishaAngleDegrees: number | null;
  ishaIntervalMinutes: number | null;
}

/**
 * What the engine will actually compute for each method.
 *
 * These values mirror the Kotlin enum and exist so the panel can *show* the
 * effective angles and so `derivePrayerConfigAngles` can be tested against a single
 * source here. They are never sent as a setting: the app passes the method identity
 * and the engine supplies the arithmetic.
 */
export const METHOD_ENGINE_PARAMETERS: Record<PrayerCalculationMethod, MethodEngineParameters> = {
  karachi: { fajrAngleDegrees: 18.0, ishaAngleDegrees: 18.0, ishaIntervalMinutes: null },
  muslim_world_league: { fajrAngleDegrees: 18.0, ishaAngleDegrees: 17.0, ishaIntervalMinutes: null },
  egyptian: { fajrAngleDegrees: 19.5, ishaAngleDegrees: 17.5, ishaIntervalMinutes: null },
  umm_al_qura: { fajrAngleDegrees: 18.5, ishaAngleDegrees: null, ishaIntervalMinutes: 90 },
  dubai: { fajrAngleDegrees: 18.2, ishaAngleDegrees: 18.2, ishaIntervalMinutes: null },
  moon_sighting_committee: {
    fajrAngleDegrees: 18.0,
    ishaAngleDegrees: 18.0,
    ishaIntervalMinutes: null,
  },
  north_america: { fajrAngleDegrees: 15.0, ishaAngleDegrees: 15.0, ishaIntervalMinutes: null },
  kuwait: { fajrAngleDegrees: 18.0, ishaAngleDegrees: 17.5, ishaIntervalMinutes: null },
  qatar: { fajrAngleDegrees: 18.0, ishaAngleDegrees: null, ishaIntervalMinutes: 90 },
  singapore: { fajrAngleDegrees: 20.0, ishaAngleDegrees: 18.0, ishaIntervalMinutes: null },
  turkey: { fajrAngleDegrees: 18.0, ishaAngleDegrees: 17.0, ishaIntervalMinutes: null },
};

export const PRAYER_CALCULATION_METHOD_LABELS: Record<PrayerCalculationMethod, string> = {
  karachi: "Karachi — University of Islamic Sciences",
  muslim_world_league: "Muslim World League",
  egyptian: "Egyptian General Authority of Survey",
  umm_al_qura: "Umm al-Qura, Makkah",
  dubai: "Gulf region (Dubai)",
  moon_sighting_committee: "Moonsighting Committee",
  north_america: "ISNA (North America)",
  kuwait: "Kuwait",
  qatar: "Qatar",
  singapore: "Singapore",
  turkey: "Diyanet, Turkey",
};

/**
 * What each method computes, in the engine's own terms.
 *
 * Deliberately descriptive rather than authoritative. The app does not claim any of
 * these reproduces a national authority's printed timetable, and neither does this
 * panel — see `PRAYER_CALCULATION.md` section 6 in the Android repository.
 */
export function describeMethod(method: PrayerCalculationMethod): string {
  const parameters = METHOD_ENGINE_PARAMETERS[method];
  const fajr = `Fajr at ${parameters.fajrAngleDegrees}° below the horizon`;
  const isha =
    parameters.ishaIntervalMinutes !== null
      ? `Isha ${parameters.ishaIntervalMinutes} minutes after Maghrib`
      : `Isha at ${parameters.ishaAngleDegrees}° below the horizon`;
  return `${fajr}, ${isha}.`;
}

/**
 * The method a fresh configuration starts from.
 *
 * Karachi (18°/18°) with Hanafi Asr is the profile the Android app ships as its
 * default, so this makes a new configuration describe what the app already does.
 * It is a **default setting, not a verified authority**, and the form says so.
 */
export const DEFAULT_CALCULATION_METHOD: PrayerCalculationMethod = "karachi";

// --- Asr ---------------------------------------------------------------------

export const ASR_MADHHABS = ["shafi", "hanafi"] as const;

export const ASR_MADHHAB_LABELS: Record<AsrMadhhab, string> = {
  shafi: "Standard / Shafi'i — object's own shadow (earlier Asr)",
  hanafi: "Hanafi — twice the object's shadow (later Asr)",
};

// --- High latitude -----------------------------------------------------------

export const HIGH_LATITUDE_RULES = [
  "automatic",
  "middle_of_the_night",
  "seventh_of_the_night",
  "twilight_angle",
] as const;

export const HIGH_LATITUDE_RULE_LABELS: Record<HighLatitudeRule, string> = {
  automatic: "Automatic — the rule the engine recommends for the latitude",
  middle_of_the_night: "Middle of the night",
  seventh_of_the_night: "One seventh of the night",
  twilight_angle: "Twilight angle",
};

/**
 * Corrected from the previous wording, which described this setting as "None —
 * undefined at extreme latitudes". The engine has no off switch: `AUTOMATIC` maps to
 * a `null` rule and the engine then applies the rule it recommends for the
 * latitude, so a bound always exists. At Bangladesh's latitude the rule is never
 * reached and does not change any calculated time.
 */
export const HIGH_LATITUDE_RULE_HELP: Record<HighLatitudeRule, string> = {
  automatic:
    "The engine chooses the bound. This is what the app uses by default, and at Bangladesh's latitude it never changes a time.",
  middle_of_the_night: "Fajr is never earlier, and Isha never later, than the middle of the night.",
  seventh_of_the_night:
    "Fajr is bounded by the last seventh of the night, Isha by the first seventh.",
  twilight_angle: "As one seventh of the night, but the fraction is derived from the twilight angles.",
};

// --- Manual adjustments ------------------------------------------------------

/** Mirrors `PrayerSettings.MAX_ADJUSTMENT_MINUTES` in the Android app. */
export const PRAYER_ADJUSTMENT_LIMIT_MINUTES = 60;

export const PRAYER_ADJUSTMENTS = [
  { column: "adjust_fajr", prayer: "Fajr", label: "Fajr" },
  { column: "adjust_dhuhr", prayer: "Dhuhr", label: "Dhuhr" },
  { column: "adjust_asr", prayer: "Asr", label: "Asr" },
  { column: "adjust_maghrib", prayer: "Maghrib", label: "Maghrib" },
  { column: "adjust_isha", prayer: "Isha", label: "Isha" },
] as const;

export type PrayerAdjustmentColumn = (typeof PRAYER_ADJUSTMENTS)[number]["column"];

// --- Engine ------------------------------------------------------------------

/**
 * Recognised engine identifiers. Publishing for an unknown engine is refused,
 * because the parameters would have no effect.
 *
 * This list is mirrored by the check inside `public.publish_prayer_config()`; the
 * two must be updated together when the app ships a new engine version.
 */
export const SUPPORTED_ENGINES: Record<string, { label: string; versions: string[] }> = {
  adhan_kotlin: {
    label: "Adhan Kotlin (com.batoulapps.adhan:adhan2)",
    versions: ["0.0.5"],
  },
};

export const DEFAULT_ENGINE_KEY = "adhan_kotlin";
export const DEFAULT_ENGINE_VERSION = "0.0.5";

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

/** True when the panel and the app agree on this engine and version. */
export function isSupportedEngine(engineKey: string, engineVersion: string): boolean {
  const engine = SUPPORTED_ENGINES[engineKey];
  return Boolean(engine && engine.versions.includes(engineVersion));
}

// --- Field helpers -----------------------------------------------------------

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

/** An enum select that may legitimately be unset while the row is still a draft. */
function optionalEnumFromForm<T extends readonly [string, ...string[]]>(values: T, label: string) {
  return z.preprocess(
    emptyToUndefined,
    z
      .enum(values, {
        errorMap: () => ({ message: `Select a valid ${label.toLowerCase()}.` }),
      })
      .optional(),
  );
}

const adjustmentMinutes = (label: string) =>
  z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ invalid_type_error: `${label} adjustment must be a whole number of minutes.` })
      .int({ message: `${label} adjustment must be a whole number of minutes.` })
      .min(-PRAYER_ADJUSTMENT_LIMIT_MINUTES, {
        message: `${label} adjustment cannot be earlier than ${PRAYER_ADJUSTMENT_LIMIT_MINUTES} minutes.`,
      })
      .max(PRAYER_ADJUSTMENT_LIMIT_MINUTES, {
        message: `${label} adjustment cannot be later than ${PRAYER_ADJUSTMENT_LIMIT_MINUTES} minutes.`,
      })
      .default(0),
  );

// --- The form schema ---------------------------------------------------------

/**
 * Validates a save from the create/edit form.
 *
 * The bar here is "this is a well-formed configuration", not "this is a publishable
 * one". A draft may legitimately be incomplete — an operator transcribing parameters
 * from a printed source saves half-finished work — and it cannot affect the live
 * configuration, so incompleteness is reported at publish time by
 * `reviewPrayerConfigForPublish()` and enforced by a database constraint. What is
 * refused *here* is a value that is wrong in itself: an unknown method, an
 * out-of-range adjustment, a mismatched scope and target, a reversed date range.
 */
export const prayerCalculationConfigSchema = z
  .object({
    id: optionalUuid("Configuration"),
    name: trimmedText(160, "Configuration name"),
    scope: z.enum(PRAYER_CONFIG_SCOPES),
    division_id: optionalUuid("Division"),
    district_id: optionalUuid("District"),
    thana_id: optionalUuid("Thana / Upazila"),
    engine_key: z.string().trim().min(1).max(64),
    engine_version: z.string().trim().min(1).max(32),
    calculation_method: optionalEnumFromForm(PRAYER_CALCULATION_METHODS, "calculation method"),
    asr_madhhab: z.enum(ASR_MADHHABS),
    high_latitude_rule: z.enum(HIGH_LATITUDE_RULES),
    adjust_fajr: adjustmentMinutes("Fajr"),
    adjust_dhuhr: adjustmentMinutes("Dhuhr"),
    adjust_asr: adjustmentMinutes("Asr"),
    adjust_maghrib: adjustmentMinutes("Maghrib"),
    adjust_isha: adjustmentMinutes("Isha"),
    timezone: z
      .string()
      .trim()
      .min(1, { message: "A timezone is required." })
      .max(64)
      .refine(isValidTimezone, { message: "Enter a valid IANA timezone such as Asia/Dhaka." }),
    effective_from: optionalDateOnly("Effective from"),
    effective_to: optionalDateOnly("Effective to"),
    source_name: optionalText(200, "Source name"),
    source_url: optionalHttpUrl("Source URL"),
    notes: optionalText(2000, "Notes"),
    /** Carried through so it can be reported back if the fields do not validate. */
    confirm_reviewed: booleanFromForm.optional(),
    /**
     * `updated_at` of the row this form was rendered from. Used for optimistic
     * concurrency: a form built from a stale row must not overwrite a newer edit.
     * See `savePrayerConfig` in features/prayer-config/actions.ts.
     */
    __expected_updated_at: optionalText(40, "Concurrency token"),
  })
  .superRefine((value, ctx) => {
    // --- scope and target must agree ---------------------------------------
    const targetColumn = SCOPE_TARGET_COLUMN[value.scope];
    const targetValue = targetColumn ? value[targetColumn] : undefined;

    if (targetColumn && !targetValue) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: [targetColumn],
        message: `A ${value.scope}-specific configuration must select its ${value.scope === "thana" ? "thana/upazila" : value.scope}.`,
      });
    }

    // Every other target column must be empty: two targets would leave the row
    // pointing at two places, and `pcc_scope_target_agrees` refuses it anyway.
    for (const column of ["division_id", "district_id", "thana_id"] as const) {
      if (column !== targetColumn && value[column]) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [column],
          message:
            "This location level does not match the selected scope. Clear it, or change the scope.",
        });
      }
    }

    // --- effective period ---------------------------------------------------
    if (value.effective_from && value.effective_to && value.effective_to < value.effective_from) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["effective_to"],
        message: "The effective-to date cannot be before the effective-from date.",
      });
    }

    // --- engine compatibility ----------------------------------------------
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

// --- Pre-publication review --------------------------------------------------

export interface PrayerConfigForPublish {
  name: string;
  scope: PrayerConfigScope;
  division_id: string | null;
  district_id: string | null;
  thana_id: string | null;
  engine_key: string;
  engine_version: string;
  calculation_method: PrayerCalculationMethod | null;
  asr_madhhab: string;
  high_latitude_rule: string;
  timezone: string;
  effective_from: string | null;
  effective_to: string | null;
  source_name: string | null;
}

export interface PrayerConfigIssue {
  severity: "error" | "warning";
  message: string;
  /** Form field this issue belongs beside, when it maps to one. */
  field?: string;
}

/**
 * Checks a configuration immediately before publication.
 *
 * Errors block publishing; warnings inform the reviewer and do not. The dividing
 * line is whether the panel can state the configuration is *unreadable or
 * unsafe* — a missing source or a reversed date range is an error, whereas "this is
 * the global configuration" is a fact worth stating, not a defect.
 *
 * `today` is injected rather than read from the clock so the result is deterministic
 * and testable.
 */
export function reviewPrayerConfigForPublish(
  config: PrayerConfigForPublish,
  options: { today?: string } = {},
): PrayerConfigIssue[] {
  const issues: PrayerConfigIssue[] = [];
  const today = options.today ?? new Date().toISOString().slice(0, 10);

  if (!config.calculation_method) {
    issues.push({
      severity: "error",
      field: "calculation_method",
      message:
        "Choose a calculation method. The engine derives its Fajr and Isha angles from the method, so there is nothing to publish without one.",
    });
  }

  const targetColumn = SCOPE_TARGET_COLUMN[config.scope];
  if (targetColumn && !config[targetColumn]) {
    issues.push({
      severity: "error",
      field: targetColumn,
      message:
        "This configuration is scoped to a location but no location is selected, so it could never be resolved.",
    });
  }

  if (!config.source_name) {
    issues.push({
      severity: "error",
      field: "source_name",
      message:
        "Record the source these parameters came from. A published configuration without a source cannot be reviewed later.",
    });
  }

  if (!config.effective_from) {
    issues.push({
      severity: "error",
      field: "effective_from",
      message:
        "Set the date this configuration takes effect. Without one, nobody can tell which of two configurations applies on a given day.",
    });
  }

  if (!isValidTimezone(config.timezone)) {
    issues.push({
      severity: "error",
      field: "timezone",
      message: `"${config.timezone}" is not a valid timezone. Bangladesh uses Asia/Dhaka.`,
    });
  }

  if (!SUPPORTED_ENGINES[config.engine_key]) {
    issues.push({
      severity: "error",
      field: "engine_key",
      message: "The engine key is not one the app ships, so publishing would have no effect.",
    });
  } else if (!SUPPORTED_ENGINES[config.engine_key]!.versions.includes(config.engine_version)) {
    issues.push({
      severity: "error",
      field: "engine_version",
      message: `Engine version ${config.engine_version} is not known for ${config.engine_key}. The app would refuse the payload.`,
    });
  }

  if (config.effective_to && config.effective_to < today) {
    issues.push({
      severity: "warning",
      field: "effective_to",
      message: `The effective period ended on ${config.effective_to}, so the app will not apply this configuration. Leave the end date blank for an open-ended configuration.`,
    });
  }

  if (config.effective_from && config.effective_from > today) {
    issues.push({
      severity: "warning",
      field: "effective_from",
      message: `This configuration does not take effect until ${config.effective_from}. Until then the previous configuration continues to apply.`,
    });
  }

  if (config.scope === "global") {
    issues.push({
      severity: "warning",
      message:
        "This is the global configuration, so it applies to every location that has no more specific override.",
    });
  }

  return issues;
}

export function prayerConfigIssuesHaveErrors(issues: PrayerConfigIssue[]): boolean {
  return issues.some((issue) => issue.severity === "error");
}

// --- Comparison --------------------------------------------------------------

export interface PrayerConfigDifference {
  label: string;
  before: string;
  after: string;
}

/** Renders one configuration value for display, in words rather than raw enums. */
export function describeAdjustment(minutes: number): string {
  if (minutes === 0) return "No adjustment";
  return `${minutes > 0 ? "+" : ""}${minutes} min`;
}

/**
 * The differences between two configurations, field by field.
 *
 * Used by the detail page so a reviewer reads the delta against the live
 * configuration instead of re-reading an entire form and guessing what moved.
 * A field that is equal is not returned, so an empty result means "no change".
 */
export function diffPrayerConfigs(
  before: Pick<
    PrayerCalculationConfigRow,
    | "scope"
    | "division_id"
    | "district_id"
    | "thana_id"
    | "calculation_method"
    | "asr_madhhab"
    | "high_latitude_rule"
    | "adjust_fajr"
    | "adjust_dhuhr"
    | "adjust_asr"
    | "adjust_maghrib"
    | "adjust_isha"
    | "timezone"
    | "effective_from"
    | "effective_to"
    | "source_name"
    | "engine_key"
    | "engine_version"
  >,
  after: PrayerCalculationConfigRow,
  locationLabel: (config: Pick<PrayerCalculationConfigRow, "scope" | "division_id" | "district_id" | "thana_id">) => string,
): PrayerConfigDifference[] {
  const differences: PrayerConfigDifference[] = [];

  const compare = (label: string, beforeValue: string, afterValue: string) => {
    if (beforeValue !== afterValue) {
      differences.push({ label, before: beforeValue, after: afterValue });
    }
  };

  compare("Scope", SCOPE_LABELS[before.scope], SCOPE_LABELS[after.scope]);
  compare("Location", locationLabel(before), locationLabel(after));

  compare(
    "Calculation method",
    before.calculation_method
      ? PRAYER_CALCULATION_METHOD_LABELS[before.calculation_method]
      : "Not set",
    after.calculation_method ? PRAYER_CALCULATION_METHOD_LABELS[after.calculation_method] : "Not set",
  );

  compare("Asr madhhab", ASR_MADHHAB_LABELS[before.asr_madhhab], ASR_MADHHAB_LABELS[after.asr_madhhab]);
  compare(
    "High-latitude rule",
    HIGH_LATITUDE_RULE_LABELS[before.high_latitude_rule],
    HIGH_LATITUDE_RULE_LABELS[after.high_latitude_rule],
  );

  for (const adjustment of PRAYER_ADJUSTMENTS) {
    compare(
      `${adjustment.label} adjustment`,
      describeAdjustment(before[adjustment.column]),
      describeAdjustment(after[adjustment.column]),
    );
  }

  compare("Timezone", before.timezone, after.timezone);
  compare("Effective from", before.effective_from ?? "Not set", after.effective_from ?? "Not set");
  compare("Effective to", before.effective_to ?? "Open-ended", after.effective_to ?? "Open-ended");
  compare("Source", before.source_name ?? "Not recorded", after.source_name ?? "Not recorded");
  compare(
    "Engine",
    `${before.engine_key} ${before.engine_version}`,
    `${after.engine_key} ${after.engine_version}`,
  );

  return differences;
}
