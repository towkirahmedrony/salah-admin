import {
  ASR_MADHHABS,
  ASR_MADHHAB_LABELS,
  DEFAULT_CALCULATION_METHOD,
  DEFAULT_ENGINE_KEY,
  DEFAULT_ENGINE_VERSION,
  DEFAULT_TIMEZONE,
  HIGH_LATITUDE_RULES,
  HIGH_LATITUDE_RULE_HELP,
  HIGH_LATITUDE_RULE_LABELS,
  PRAYER_CALCULATION_METHODS,
  PRAYER_CALCULATION_METHOD_LABELS,
  PRAYER_CONFIG_SCOPES,
  SCOPE_LABELS,
} from "@/lib/validation/prayer-config";
import type {
  PrayerCalculationConfigRow,
  PrayerConfigScope,
  RecordStatus,
} from "@/lib/types/database";

/**
 * Presentational metadata for the prayer configuration screens.
 *
 * The vocabularies themselves live in `lib/validation/prayer-config.ts`, next to
 * the schema that validates them, so a select and its validation cannot drift. This
 * module only decides how those options are labelled and in what order they appear.
 */

export interface FormOption<T extends string = string> {
  value: T;
  label: string;
}

export const SCOPE_OPTIONS: FormOption<PrayerConfigScope>[] = PRAYER_CONFIG_SCOPES.map((scope) => ({
  value: scope,
  label: SCOPE_LABELS[scope],
}));

export const CALCULATION_METHOD_OPTIONS: FormOption[] = PRAYER_CALCULATION_METHODS.map(
  (method) => ({ value: method, label: PRAYER_CALCULATION_METHOD_LABELS[method] }),
);

export const ASR_MADHHAB_OPTIONS: FormOption[] = ASR_MADHHABS.map((value) => ({
  value,
  label: ASR_MADHHAB_LABELS[value],
}));

export const HIGH_LATITUDE_RULE_OPTIONS: FormOption[] = HIGH_LATITUDE_RULES.map((value) => ({
  value,
  label: HIGH_LATITUDE_RULE_LABELS[value],
}));

export const HIGH_LATITUDE_RULE_HELP_TEXT = HIGH_LATITUDE_RULE_HELP;

export const STATUS_OPTIONS: FormOption<RecordStatus>[] = [
  { value: "draft", label: "Draft" },
  { value: "published", label: "Published" },
  { value: "archived", label: "Archived" },
];

/**
 * Values the form renders from.
 *
 * Strings throughout, because that is what an HTML form sends and what the
 * database returns for a numeric column. An empty string means "not set", which is
 * how a draft legitimately looks.
 */
export type PrayerConfigFormValues = Record<string, string | boolean | null>;

/** The starting point for a new configuration. */
export function newConfigDefaults(today: string): PrayerConfigFormValues {
  return {
    id: null,
    name: "",
    scope: "global",
    division_id: "",
    district_id: "",
    thana_id: "",
    engine_key: DEFAULT_ENGINE_KEY,
    engine_version: DEFAULT_ENGINE_VERSION,
    // The profile the Android app ships as its default. Stated in the form as a
    // default setting, not a verified authority.
    calculation_method: DEFAULT_CALCULATION_METHOD,
    asr_madhhab: "hanafi",
    high_latitude_rule: "automatic",
    adjust_fajr: "0",
    adjust_dhuhr: "0",
    adjust_asr: "0",
    adjust_maghrib: "0",
    adjust_isha: "0",
    timezone: DEFAULT_TIMEZONE,
    // Defaulted rather than left blank so the most common mistake — publishing
    // without an effective date — is not the default state of the form.
    effective_from: today,
    effective_to: "",
    source_name: "",
    source_url: "",
    notes: "",
    updated_at: null,
  };
}

/**
 * Seeds the form from a stored row.
 *
 * Numbers become strings because that is what an HTML input holds and what the
 * schema coerces back. `undefined` never reaches the form — a field with no value is
 * the empty string, which is what "not set" means everywhere in this feature.
 */
export function configToFormValues(row: PrayerCalculationConfigRow): PrayerConfigFormValues {
  const values: PrayerConfigFormValues = {
    id: row.id,
    name: row.name,
    scope: row.scope,
    division_id: row.division_id,
    district_id: row.district_id,
    thana_id: row.thana_id,
    engine_key: row.engine_key,
    engine_version: row.engine_version,
    calculation_method: row.calculation_method,
    asr_madhhab: row.asr_madhhab,
    high_latitude_rule: row.high_latitude_rule,
    adjust_fajr: String(row.adjust_fajr),
    adjust_dhuhr: String(row.adjust_dhuhr),
    adjust_asr: String(row.adjust_asr),
    adjust_maghrib: String(row.adjust_maghrib),
    adjust_isha: String(row.adjust_isha),
    timezone: row.timezone,
    effective_from: row.effective_from,
    effective_to: row.effective_to,
    source_name: row.source_name,
    source_url: row.source_url,
    notes: row.notes,
    status: row.status,
    version: String(row.version),
    updated_at: row.updated_at,
  };

  // A null becomes "" so inputs render empty rather than the text "null".
  for (const [key, value] of Object.entries(values)) {
    if (value === null) values[key] = "";
  }

  return values;
}

/** Column order of the five adjustment inputs. */
export const ADJUSTMENT_FIELDS = [
  { column: "adjust_fajr", label: "Fajr", prayer: "Fajr" },
  { column: "adjust_dhuhr", label: "Dhuhr", prayer: "Dhuhr" },
  { column: "adjust_asr", label: "Asr", prayer: "Asr" },
  { column: "adjust_maghrib", label: "Maghrib", prayer: "Maghrib" },
  { column: "adjust_isha", label: "Isha", prayer: "Isha" },
] as const;
