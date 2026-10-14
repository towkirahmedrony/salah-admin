import { z } from "zod";

import {
  booleanFromForm,
  optionalText,
  optionalUuid,
  trimmedText,
} from "@/lib/validation/common";
import { parseJsonObject } from "@/lib/utils/json";

/**
 * Remote configuration.
 *
 * Two guards matter here beyond ordinary field validation:
 *
 *   1. A key may never look like a credential. The database enforces this too
 *      (`app_configs_key_not_secret`), because a table the Android app reads is
 *      the worst possible place for an API secret.
 *   2. A *known* key is validated against a real schema, so a configuration the
 *      app consumes cannot be saved in a shape the app will crash on. Unknown
 *      keys are allowed but marked as unvalidated, and are clearly labelled as
 *      such in the UI.
 */

export const CONFIG_KEY_PATTERN = /^[a-z0-9][a-z0-9_.-]{0,95}$/;
const SECRET_KEY_PATTERN =
  /(secret|token|password|passwd|credential|api[_-]?key|private[_-]?key|service[_-]?role|signing)/i;

// --- Known configuration structures -----------------------------------------

export interface KnownConfigDefinition {
  key: string;
  label: string;
  category: string;
  description: string;
  isPublicByDefault: boolean;
  /** Validates the JSON `value` object. */
  schema: z.ZodTypeAny;
  /** Shown in the editor so an administrator knows what the app expects. */
  example: string;
  /** How the Android app is expected to consume it. */
  consumer: string;
}

export const KNOWN_CONFIGS: KnownConfigDefinition[] = [
  {
    key: "app.minimum_supported_version",
    label: "Minimum supported app version",
    category: "app",
    description:
      "The oldest Salah build that is still supported. An app below this version shows an update prompt.",
    isPublicByDefault: true,
    schema: z.object({
      version: z.string().regex(/^\d+(\.\d+){0,2}$/, "version must look like 1.2.3"),
    }),
    example: `{ "version": "1.2.0" }`,
    consumer: "Read once at app start-up; compared against BuildConfig.VERSION_NAME.",
  },
  {
    key: "app.update_required",
    label: "Force update required",
    category: "app",
    description:
      "When required is true, the app blocks normal use until it is updated. Use only for a genuine breakage.",
    isPublicByDefault: true,
    schema: z.object({
      required: z.boolean(),
      store_url: z.string().url().optional(),
    }),
    example: `{ "required": false, "store_url": "https://play.google.com/store/apps/details?id=io.github.towkirahmedrony.salah" }`,
    consumer: "Read once at app start-up.",
  },
  {
    key: "prayer.reminder_defaults",
    label: "Default prayer reminder settings",
    category: "prayer",
    description:
      "Defaults applied only on a fresh install. An existing device keeps the user's own choices, which always win.",
    isPublicByDefault: true,
    schema: z.object({
      enabled: z.boolean(),
      minutes_before: z.number().int().min(0).max(120),
    }),
    example: `{ "enabled": true, "minutes_before": 10 }`,
    consumer: "Read on first launch to seed the notification preferences.",
  },
  {
    key: "ramadan.notice",
    label: "Ramadan notice",
    category: "ramadan",
    description:
      "A short notice shown in the Ramadan section. It does not replace the calendar and does not publish a start date.",
    isPublicByDefault: true,
    schema: z.object({
      enabled: z.boolean(),
      message_en: z.string().max(400).optional(),
      message_bn: z.string().max(400).optional(),
    }),
    example: `{ "enabled": false, "message_en": "", "message_bn": "" }`,
    consumer: "Read when the Ramadan section is opened.",
  },
  {
    key: "location.default_thana_code",
    label: "Default thana code",
    category: "location",
    description:
      "The thana code suggested when a user has not chosen a location. It must match a code in the thanas table.",
    isPublicByDefault: true,
    schema: z.object({
      code: z.string().regex(/^[A-Za-z0-9_.-]{1,32}$/, "code must match a thana code"),
    }),
    example: `{ "code": "BD30290032" }`,
    consumer: "Read by the location picker as the suggested starting point.",
  },
  {
    key: "feedback.intake_enabled",
    label: "In-app feedback intake enabled",
    category: "support",
    description:
      "Controls whether the app shows its feedback form. The admin panel's own intake is unaffected.",
    isPublicByDefault: true,
    schema: z.object({ enabled: z.boolean() }),
    example: `{ "enabled": true }`,
    consumer: "Read when the feedback screen is opened.",
  },
];

const KNOWN_BY_KEY = new Map(KNOWN_CONFIGS.map((entry) => [entry.key, entry]));

export function knownConfig(key: string): KnownConfigDefinition | undefined {
  return KNOWN_BY_KEY.get(key);
}

export type ValueValidation =
  | { state: "known-valid" }
  | { state: "known-invalid"; errors: string[] }
  | { state: "unknown" };

/**
 * Validates a parsed value against the registry.
 *
 * `unknown` is not an error — a future app build may add a key this panel does
 * not know yet — but the UI must say so rather than implying it was checked.
 */
export function validateConfigValue(key: string, value: unknown): ValueValidation {
  const definition = KNOWN_BY_KEY.get(key);
  if (!definition) return { state: "unknown" };

  const result = definition.schema.safeParse(value);
  if (result.success) return { state: "known-valid" };

  return {
    state: "known-invalid",
    errors: result.error.issues.map((issue) =>
      issue.path.length > 0 ? `${issue.path.join(".")}: ${issue.message}` : issue.message,
    ),
  };
}

// --- Form schema -------------------------------------------------------------

export const appConfigSchema = z
  .object({
    id: optionalUuid("Configuration"),
    key: trimmedText(96, "Key"),
    category: trimmedText(40, "Category"),
    value: z.string(),
    description: optionalText(600, "Description"),
    is_public: booleanFromForm,
    confirm_reviewed: booleanFromForm.optional(),
  })
  .superRefine((raw, ctx) => {
    if (!CONFIG_KEY_PATTERN.test(raw.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["key"],
        message:
          "Keys must start with a letter or digit and may contain lowercase letters, digits, dots, dashes and underscores.",
      });
    }

    if (SECRET_KEY_PATTERN.test(raw.key)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["key"],
        message:
          "This key looks like a credential. Secrets must live in the platform secret store, never in a table the app reads.",
      });
    }

    const parsed = parseJsonObject(raw.value);
    if (!parsed.ok) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ["value"], message: parsed.error });
      return;
    }

    const validation = validateConfigValue(raw.key, parsed.value);
    if (validation.state === "known-invalid") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["value"],
        message: `The app expects a different structure for this key: ${validation.errors.join("; ")}`,
      });
    }
  })
  .transform((raw) => {
    const parsed = parseJsonObject(raw.value);
    return {
      id: raw.id,
      key: raw.key,
      category: raw.category,
      description: raw.description,
      is_public: raw.is_public,
      confirm_reviewed: raw.confirm_reviewed,
      // Safe: superRefine already rejected an unparseable value.
      value: parsed.ok ? parsed.value : {},
    };
  });

export type AppConfigInput = z.infer<typeof appConfigSchema>;
