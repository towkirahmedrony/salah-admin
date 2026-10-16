import { compareDecimals, isDecimalLiteral } from "@/features/metal-prices/decimal";
import type { MetalPriceRow, MetalPurity, MetalType } from "@/lib/types/database";
import {
  METAL_PURITY_LABELS,
  METAL_TYPE_LABELS,
  METAL_PURITIES,
  METAL_TYPES,
} from "@/lib/validation/metal-prices";

/**
 * Presentational metadata for the reference-price screens. The vocabularies
 * themselves live in `lib/validation/metal-prices.ts`, beside the schemas that
 * validate them.
 */

export interface RateIdentity {
  metal: MetalType;
  purity: MetalPurity;
}

/**
 * Every rate the panel manages, in the order it is shown.
 *
 * The Android app uses gold K22 and silver K22 as its defaults. The other six are
 * managed here because the provider publishes them and the contract allows them —
 * and because silently substituting another purity when K22 is missing is exactly
 * what must not happen, so the panel has to be able to say which of them is
 * missing.
 */
export const RATE_MATRIX: readonly RateIdentity[] = METAL_TYPES.flatMap((metal) =>
  METAL_PURITIES.map((purity) => ({ metal, purity })),
);

export const GOLD_K22: RateIdentity = { metal: "gold", purity: "K22" };
export const SILVER_K22: RateIdentity = { metal: "silver", purity: "K22" };

export function rateKey(metal: MetalType, purity: MetalPurity): string {
  return `${metal}:${purity}`;
}

export function rateLabel(metal: MetalType, purity: MetalPurity): string {
  return `${METAL_TYPE_LABELS[metal]} ${METAL_PURITY_LABELS[purity]}`;
}

export const METAL_OPTIONS = METAL_TYPES.map((metal) => ({
  value: metal,
  label: METAL_TYPE_LABELS[metal],
}));

export const PURITY_OPTIONS = METAL_PURITIES.map((purity) => ({
  value: purity,
  label: METAL_PURITY_LABELS[purity],
}));

/** Values the manual override form renders from. Strings, as an HTML form sends. */
export type OverrideFormValues = Record<string, string | boolean | null>;

/**
 * The starting point for a manual override.
 *
 * Gold K22 is not preselected out of preference: it is the one rate the app reads
 * when nothing else is chosen, so it is the most likely thing an administrator
 * came here to set. The reason field is deliberately empty — a prefilled reason
 * would be a reason nobody thought about.
 */
export function newOverrideDefaults(today: string): OverrideFormValues {
  return {
    metal_type: GOLD_K22.metal,
    purity: GOLD_K22.purity,
    price_per_gram: "",
    source: "",
    source_url: "",
    effective_at: today,
    reason: "",
  };
}

/** Seeds the override form from a rate that is already published. */
export function rateToOverrideValues(rate: MetalPriceRow, today: string): OverrideFormValues {
  return {
    metal_type: rate.metal_type,
    purity: rate.purity,
    price_per_gram: String(rate.price_per_gram),
    source: rate.source ?? "",
    source_url: rate.source_url ?? "",
    effective_at: (rate.effective_at ?? "").slice(0, 10) || today,
    reason: rate.review_note ?? "",
  };
}

/**
 * How a reviewer should describe a proposed change against the live rate.
 *
 * `unknown` is a real answer, not a failure: when nothing is published for the
 * rate, or the published rate's price cannot be read, the panel says so rather
 * than implying the candidate is higher or lower.
 */
export type PriceDirection = "higher" | "lower" | "same" | "unknown";

/**
 * Compares a proposed price with the one it would replace, exactly.
 *
 * The inputs are the strings the money helpers already work with. A
 * `numeric(12,2)` column arrives from PostgREST as a JSON number, and
 * `String(value)` recovers the two-decimal literal that was stored — a double's
 * shortest round-trip form reproduces any decimal of this length — so the
 * comparison stays a comparison of digits rather than of binary approximations.
 */
export function priceDirection(
  before: string | number | null | undefined,
  after: string | number | null | undefined,
): PriceDirection {
  const left = normalise(before);
  const right = normalise(after);
  if (left === null || right === null) return "unknown";

  const comparison = compareDecimals(right, left);
  if (comparison === 0) return "same";
  return comparison > 0 ? "higher" : "lower";
}

function normalise(value: string | number | null | undefined): string | null {
  if (value === null || value === undefined) return null;
  const text = typeof value === "number" ? String(value) : value.trim();
  return isDecimalLiteral(text) ? text : null;
}
