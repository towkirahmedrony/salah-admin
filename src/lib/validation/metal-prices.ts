import { z } from "zod";

import { hasAtMostScale, isDecimalLiteral, isPositiveDecimal } from "@/features/metal-prices/decimal";
import { booleanFromForm, enumFromForm, optionalDateOnly, optionalHttpUrl, optionalText, optionalUuid, trimmedText, uuid } from "@/lib/validation/common";
import type { MetalPurity, MetalType } from "@/lib/types/database";

/**
 * Validation for the reference-price screens.
 *
 * The vocabularies are declared here, next to the schemas that validate them, so
 * a select and its validation cannot drift — the same arrangement
 * `lib/validation/prayer-config.ts` uses. They are the literal strings the
 * database CHECK constraints accept and the Android app parses, which is why the
 * purity list is upper case and the metal list is lower case.
 */

export const METAL_TYPES: readonly [MetalType, ...MetalType[]] = ["gold", "silver"];

export const METAL_PURITIES: readonly [MetalPurity, ...MetalPurity[]] = ["K22", "K21", "K18", "TRADITIONAL"];

/** The category the Android app reads for both metals, and the panel's default focus. */
export const DEFAULT_REFERENCE_PURITY: MetalPurity = "K22";

export const METAL_TYPE_LABELS: Record<MetalType, string> = {
  gold: "Gold",
  silver: "Silver",
};

export const METAL_PURITY_LABELS: Record<MetalPurity, string> = {
  K22: "K22 (22K)",
  K21: "K21 (21K)",
  K18: "K18 (18K)",
  TRADITIONAL: "Traditional",
};

/** The currency of every rate in this feature. There is no second option yet. */
export const REFERENCE_PRICE_CURRENCY = "BDT";

/**
 * A price per gram.
 *
 * Stays a string all the way to the database: the value is a monetary amount in a
 * `numeric(12,2)` column, and `z.coerce.number()` would put a double in the middle
 * of it. Precision is refused rather than rounded — if an administrator types
 * 19550.075, telling them the column holds two decimals is kinder than quietly
 * storing 19550.08.
 */
export const pricePerGramField = z
  .string({ required_error: "A price per gram is required." })
  .transform((value) => value.trim())
  .refine((value) => value.length > 0, { message: "A price per gram is required." })
  .refine((value) => isDecimalLiteral(value), {
    message: "Enter a price as digits, for example 19550.07. Commas, spaces and exponents are not part of a price.",
  })
  .refine((value) => isPositiveDecimal(value), { message: "A price must be greater than zero." })
  .refine((value) => hasAtMostScale(value, 2), {
    message: "A price may have at most two decimal places, which is what the database stores.",
  });

/** A manual override: the panel's own reference price, with its reason and provenance. */
export const metalPriceOverrideSchema = z.object({
  metal_type: enumFromForm(METAL_TYPES, "Metal"),
  purity: enumFromForm(METAL_PURITIES, "Purity"),
  price_per_gram: pricePerGramField,
  source: optionalText(120, "Source"),
  source_url: optionalHttpUrl("Source URL"),
  effective_at: optionalDateOnly("Effective date"),
  // Required, not optional: an override is a decision, and a decision with no
  // recorded reason cannot be reviewed by anyone later.
  reason: trimmedText(500, "Reason for the manual price"),
});

export const publishRateSchema = z.object({
  id: uuid("Rate"),
  effective_at: optionalDateOnly("Effective date"),
  acknowledge_stale: booleanFromForm,
});

export const rejectCandidateSchema = z.object({
  id: uuid("Candidate"),
  reason: optionalText(500, "Reason"),
});

export const deactivateOverrideSchema = z.object({
  id: uuid("Override"),
  restore_id: optionalUuid("Replacement rate"),
  acknowledge_stale: booleanFromForm,
});

/**
 * Turns an effective *date* into the instant that date began in Bangladesh.
 *
 * The panel works in Asia/Dhaka (see `DISPLAY_TIMEZONE`), Bangladesh has no
 * daylight saving, and an effective date the administrator typed means the start
 * of that day where the prices are published — not midnight UTC, which is 6am
 * there.
 */
export function effectiveDateToTimestamp(date: string): string {
  return `${date}T00:00:00+06:00`;
}
