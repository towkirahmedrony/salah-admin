import { z } from "zod";

/**
 * Shared field primitives.
 *
 * HTML forms submit strings, so every schema in this folder is written to accept
 * exactly what a browser sends — including the empty string a cleared optional
 * input produces. Converting `""` to `undefined` up front is what keeps
 * "optional" honest instead of silently storing `""` in a nullable column.
 */

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? undefined : value;

const emptyToNull = (value: unknown): unknown =>
  typeof value === "string" && value.trim() === "" ? null : value;

// --- Text --------------------------------------------------------------------

export const trimmedText = (max: number, label = "This field") =>
  z
    .string({ required_error: `${label} is required.` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} is required.` })
    .refine((value) => value.length <= max, {
      message: `${label} must be ${max} characters or fewer.`,
    });

export const optionalText = (max: number, label = "This field") =>
  z.preprocess(
    emptyToNull,
    z
      .union([
        z.string().max(max, { message: `${label} must be ${max} characters or fewer.` }),
        z.null(),
      ])
      .optional()
      .transform((value) => (value === undefined || value === null ? null : value.trim() || null)),
  );

/**
 * Bangla text. Accepts any Unicode letter/digit plus the punctuation the
 * dataset uses, and rejects control characters and zero-width joiners that
 * would render as an invisible difference between two "identical" names.
 */
export const banglaText = (max: number, label = "Bangla name") =>
  z.preprocess(
    emptyToNull,
    z
      .union([z.string().max(max), z.null()])
      .optional()
      .transform((value) => (value === undefined || value === null ? null : value.trim() || null))
      .refine((value) => value === null || !/[\u0000-\u001f\u200b-\u200f\u2028\u2029]/.test(value), {
        message: `${label} contains characters that are not allowed.`,
      })
      .refine(
        (value) => value === null || /^[\p{L}\p{M}\p{N} .,'’\-–()/&]+$/u.test(value),
        { message: `${label} contains characters that are not expected in a place name.` },
      ),
  );

// --- Stable codes ------------------------------------------------------------

export const stableCode = (label = "Code") =>
  z
    .string({ required_error: `${label} is required.` })
    .transform((value) => value.trim())
    .refine((value) => value.length > 0, { message: `${label} is required.` })
    .refine((value) => value.length <= 32, { message: `${label} must be 32 characters or fewer.` })
    .refine((value) => /^[A-Za-z0-9_.-]+$/.test(value), {
      message: `${label} may only contain letters, digits, dots, dashes and underscores.`,
    });

export const optionalStableCode = (label = "Code") =>
  z.preprocess(
    emptyToNull,
    z.union([z.string(), z.null()]).optional().transform((value) => {
      if (value === undefined || value === null) return null;
      return value.trim() || null;
    }),
  )
    .refine((value) => value === null || value.length <= 32, {
      message: `${label} must be 32 characters or fewer.`,
    })
    .refine((value) => value === null || /^[A-Za-z0-9_.-]+$/.test(value), {
      message: `${label} may only contain letters, digits, dots, dashes and underscores.`,
    });

// --- Numbers -----------------------------------------------------------------

export const optionalDecimal = (min: number, max: number, label = "Value") =>
  z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ invalid_type_error: `${label} must be a number.` })
      .min(min, { message: `${label} must be at least ${min}.` })
      .max(max, { message: `${label} must be at most ${max}.` })
      .optional(),
  );

export const requiredDecimal = (min: number, max: number, label = "Value") =>
  z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ required_error: `${label} is required.`, invalid_type_error: `${label} must be a number.` })
      .min(min, { message: `${label} must be at least ${min}.` })
      .max(max, { message: `${label} must be at most ${max}.` }),
  );

export const optionalInteger = (min: number, max: number, label = "Value") =>
  z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ invalid_type_error: `${label} must be a whole number.` })
      .int({ message: `${label} must be a whole number.` })
      .min(min, { message: `${label} must be at least ${min}.` })
      .max(max, { message: `${label} must be at most ${max}.` })
      .optional(),
  );

export const requiredInteger = (min: number, max: number, label = "Value") =>
  z.preprocess(
    emptyToUndefined,
    z.coerce
      .number({ required_error: `${label} is required.`, invalid_type_error: `${label} must be a whole number.` })
      .int({ message: `${label} must be a whole number.` })
      .min(min, { message: `${label} must be at least ${min}.` })
      .max(max, { message: `${label} must be at most ${max}.` }),
  );

// --- Booleans ----------------------------------------------------------------

/** Checkboxes are absent from FormData when unchecked. */
export const booleanFromForm = z.preprocess(
  (value) => value === "on" || value === "true" || value === true,
  z.boolean(),
);

// --- Dates and times ---------------------------------------------------------

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export const dateOnly = (label = "Date") =>
  z
    .string({ required_error: `${label} is required.` })
    .transform((value) => value.trim())
    .refine((value) => DATE_PATTERN.test(value), {
      message: `${label} must be in YYYY-MM-DD format.`,
    })
    .refine((value) => {
      if (!DATE_PATTERN.test(value)) return false;
      const date = new Date(`${value}T00:00:00Z`);
      // Rejects 2026-02-31: the parsed date would roll into March.
      return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
    }, { message: `${label} is not a real calendar date.` });

export const optionalDateOnly = (label = "Date") =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .transform((value) => value.trim())
      .refine((value) => DATE_PATTERN.test(value), {
        message: `${label} must be in YYYY-MM-DD format.`,
      })
      .refine((value) => {
        if (!DATE_PATTERN.test(value)) return false;
        const date = new Date(`${value}T00:00:00Z`);
        return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
      }, { message: `${label} is not a real calendar date.` })
      .optional(),
  );

/**
 * Accepts an optional leading zero on the hour.
 *
 * A native `<input type="time">` always submits `HH:MM`, but a time pasted from a
 * published calendar is often written `5:12`. The two other time parsers in this
 * codebase (`timeToMinutes`, and the Ramadan bulk-line parser) already accept the
 * unpadded form, and having one of the three disagree would mean a value typed in
 * the bulk editor was accepted while the same value typed into a field was not.
 * Everything is normalised to zero-padded `HH:MM:SS` before it reaches the
 * database, so the stored form is unambiguous either way.
 */
const TIME_PATTERN = /^([01]?\d|2[0-3]):([0-5]\d)(?::([0-5]\d))?$/;

/** Normalises "5:12" and "05:12" to the `HH:MM:SS` PostgreSQL `time` form. */
export function normaliseTime(value: string): string | null {
  const match = TIME_PATTERN.exec(value.trim());
  if (!match) return null;
  const [, hours, minutes, seconds] = match;
  return `${hours!.padStart(2, "0")}:${minutes}:${seconds ?? "00"}`;
}

export const timeOnly = (label = "Time") =>
  z
    .string({ required_error: `${label} is required.` })
    .transform((value) => value.trim())
    .refine((value) => normaliseTime(value) !== null, {
      message: `${label} must be a 24-hour time such as 05:12.`,
    })
    .transform((value) => normaliseTime(value)!);

export const optionalTimeOnly = (label = "Time") =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .transform((value) => value.trim())
      .refine((value) => normaliseTime(value) !== null, {
        message: `${label} must be a 24-hour time such as 05:12.`,
      })
      .transform((value) => normaliseTime(value)!)
      .optional(),
  );

export const optionalTimestamp = (label = "Date and time") =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .transform((value) => value.trim())
      .refine((value) => !Number.isNaN(new Date(value).getTime()), {
        message: `${label} is not a valid date and time.`,
      })
      .transform((value) => new Date(value).toISOString())
      .optional(),
  );

// --- URLs and contact details ------------------------------------------------

export const optionalHttpUrl = (label = "Source URL") =>
  z.preprocess(
    emptyToNull,
    z
      .union([z.string().max(2048), z.null()])
      .optional()
      .transform((value) => (value === undefined || value === null ? null : value.trim() || null))
      .refine((value) => value === null || /^https?:\/\/\S+$/i.test(value), {
        message: `${label} must be a full http:// or https:// address.`,
      }),
  );

export const optionalEmail = (label = "Email address") =>
  z.preprocess(
    emptyToNull,
    z
      .union([z.string().max(200), z.null()])
      .optional()
      .transform((value) => (value === undefined || value === null ? null : value.trim().toLowerCase() || null))
      .refine((value) => value === null || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value), {
        message: `${label} is not a valid email address.`,
      }),
  );

// --- Lists -------------------------------------------------------------------

/** Comma or newline separated input, as used for locality alternative names. */
export const optionalTextList = (maxItems: number, maxItemLength: number, label = "List") =>
  z.preprocess(
    (value) => {
      if (typeof value !== "string") return [];
      return value
        .split(/[,\n]/)
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0);
    },
    z
      .array(z.string().max(maxItemLength, { message: `${label} entries must be ${maxItemLength} characters or fewer.` }))
      .max(maxItems, { message: `${label} may contain at most ${maxItems} entries.` }),
  );

// --- Enums -------------------------------------------------------------------

export function enumFromForm<T extends readonly [string, ...string[]]>(
  values: T,
  label: string,
): z.ZodType<T[number]> {
  return z
    .string({ required_error: `${label} is required.` })
    .refine((value): value is T[number] => (values as readonly string[]).includes(value), {
      message: `Select a valid ${label.toLowerCase()}.`,
    }) as unknown as z.ZodType<T[number]>;
}

// --- Form parsing ------------------------------------------------------------

export interface FormParseFailure {
  ok: false;
  message: string;
  fieldErrors: Record<string, string[]>;
}

export type FormParseResult<T> = { ok: true; data: T } | FormParseFailure;

/**
 * Parses a `FormData` payload with a schema and flattens the first error per
 * field, which is the shape the form components render.
 */
export function parseFormData<Schema extends z.ZodTypeAny>(
  schema: Schema,
  formData: FormData,
): FormParseResult<z.infer<Schema>> {
  const raw: Record<string, unknown> = {};

  for (const key of new Set(formData.keys())) {
    const values = formData.getAll(key);
    raw[key] = values.length > 1 ? values : values[0];
  }

  const result = schema.safeParse(raw);

  if (!result.success) {
    const flattened = result.error.flatten();
    const fieldErrors = Object.fromEntries(
      Object.entries(flattened.fieldErrors).filter(([, messages]) => messages && messages.length > 0),
    ) as Record<string, string[]>;

    const firstMessage =
      Object.values(fieldErrors)[0]?.[0] ??
      flattened.formErrors[0] ??
      "Please correct the highlighted fields.";

    return { ok: false, message: firstMessage, fieldErrors };
  }

  return { ok: true, data: result.data };
}

/** Reads a uuid field and rejects anything that is not one, before it reaches a query. */
export const uuid = (label = "Selection") =>
  z
    .string({ required_error: `${label} is required.` })
    .transform((value) => value.trim())
    .refine(
      (value) =>
        /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
      { message: `Select a valid ${label.toLowerCase()}.` },
    );

export const optionalUuid = (label = "Selection") =>
  z.preprocess(
    emptyToUndefined,
    z
      .string()
      .transform((value) => value.trim())
      .refine(
        (value) =>
          /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value),
        { message: `Select a valid ${label.toLowerCase()}.` },
      )
      .optional(),
  );
