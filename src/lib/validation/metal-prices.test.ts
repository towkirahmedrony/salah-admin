import { describe, expect, it } from "vitest";

import { FALLBACK_FRESHNESS_POLICY, assessProviderTimestamp, policyFromRow } from "@/features/metal-prices/policy";
import { parseFormData } from "@/lib/validation/common";
import {
  deactivateOverrideSchema,
  effectiveDateToTimestamp,
  metalPriceOverrideSchema,
  pricePerGramField,
  publishRateSchema,
} from "@/lib/validation/metal-prices";

/**
 * Validation and policy tests for the reference-price screens.
 *
 * The prices here are synthetic fixtures, not Bangladesh market prices. Every case
 * asserts what the panel must *refuse* as much as what it accepts: a zero, a
 * negative or an over-precise price reaching the database is the failure this
 * validation exists to prevent.
 *
 * The schemas read an HTML form, so they are exercised through the project's
 * `parseFormData` helper — calling a schema with a `FormData` directly would test
 * something the actions never do.
 */

const CANDIDATE_ID = "11111111-1111-4111-8111-111111111111";
const REPLACEMENT_ID = "22222222-2222-4222-8222-222222222222";

function form(entries: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) data.set(key, value);
  return data;
}

const VALID_OVERRIDE = {
  metal_type: "gold",
  purity: "K22",
  price_per_gram: "19550.07",
  source: "BAJUS notice",
  source_url: "https://www.bajus.org/gold-price",
  effective_at: "2026-10-15",
  reason: "The published record had not been updated after the revision.",
};

describe("pricePerGramField", () => {
  it("keeps the digits as a string", () => {
    const result = pricePerGramField.safeParse("19550.07");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("19550.07");
  });

  it("trims surrounding whitespace but nothing else", () => {
    const result = pricePerGramField.safeParse("  360.50  ");
    expect(result.success).toBe(true);
    if (result.success) expect(result.data).toBe("360.50");
  });

  it.each([
    ["zero", "0"],
    ["zero with decimals", "0.00"],
    ["negative", "-1"],
    ["negative with decimals", "-19550.07"],
    ["an empty string", ""],
    ["whitespace", "   "],
    ["NaN", "NaN"],
    ["Infinity", "Infinity"],
    ["-Infinity", "-Infinity"],
    ["a grouping comma", "19,550.07"],
    ["an exponent", "1.955007e4"],
    ["words", "nineteen thousand"],
    ["a bare decimal point", "."],
    ["a trailing point", "19550."],
    ["a leading point", ".5"],
  ])("refuses %s", (_label, value) => {
    expect(pricePerGramField.safeParse(value).success).toBe(false);
  });

  it("refuses more precision than the column stores rather than rounding it", () => {
    const result = pricePerGramField.safeParse("19550.075");
    expect(result.success).toBe(false);
    if (!result.success) expect(result.error.issues[0]?.message).toContain("two decimal places");
  });
});

describe("metalPriceOverrideSchema", () => {
  it("accepts a well-formed override and keeps the price as a string", () => {
    const result = parseFormData(metalPriceOverrideSchema, form(VALID_OVERRIDE));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.price_per_gram).toBe("19550.07");
  });

  it("accepts an override with no source and no effective date", () => {
    const result = parseFormData(
      metalPriceOverrideSchema,
      form({ metal_type: "silver", purity: "TRADITIONAL", price_per_gram: "250", reason: "A shop notice." }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.source).toBeFalsy();
      expect(result.data.effective_at).toBeFalsy();
    }
  });

  it("requires a reason, because a decision with no reason cannot be reviewed later", () => {
    expect(parseFormData(metalPriceOverrideSchema, form({ ...VALID_OVERRIDE, reason: "  " })).ok).toBe(false);
  });

  it("names the field that failed, so the form can point at it", () => {
    const result = parseFormData(metalPriceOverrideSchema, form({ ...VALID_OVERRIDE, price_per_gram: "0" }));

    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.fieldErrors?.price_per_gram).toBeTruthy();
  });

  it.each(["platinum", "GOLD", "", "gold "])("refuses the metal %s", (metal) => {
    expect(parseFormData(metalPriceOverrideSchema, form({ ...VALID_OVERRIDE, metal_type: metal })).ok).toBe(false);
  });

  it.each(["K24", "22", "k22", ""])("refuses the purity %s", (purity) => {
    expect(parseFormData(metalPriceOverrideSchema, form({ ...VALID_OVERRIDE, purity })).ok).toBe(false);
  });

  it("refuses a source URL that is not http(s)", () => {
    expect(
      parseFormData(metalPriceOverrideSchema, form({ ...VALID_OVERRIDE, source_url: "javascript:alert(1)" })).ok,
    ).toBe(false);
  });

  it("refuses a required field that was not submitted at all", () => {
    const { price_per_gram: _omitted, ...rest } = VALID_OVERRIDE;
    expect(parseFormData(metalPriceOverrideSchema, form(rest)).ok).toBe(false);
  });
});

describe("publishRateSchema", () => {
  it("accepts a rate id with no effective date and no acknowledgement", () => {
    const result = parseFormData(
      publishRateSchema,
      form({ id: CANDIDATE_ID, effective_at: "", acknowledge_stale: "false" }),
    );

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.data.effective_at).toBeFalsy();
      expect(result.data.acknowledge_stale).toBe(false);
    }
  });

  it("reads the acknowledgement from a ticked checkbox", () => {
    const result = parseFormData(publishRateSchema, form({ id: CANDIDATE_ID, acknowledge_stale: "on" }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.acknowledge_stale).toBe(true);
  });

  it("treats a missing acknowledgement as not acknowledged", () => {
    const result = parseFormData(publishRateSchema, form({ id: CANDIDATE_ID }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.acknowledge_stale).toBe(false);
  });

  it("refuses an id that is not a uuid", () => {
    expect(parseFormData(publishRateSchema, form({ id: "not-a-uuid" })).ok).toBe(false);
  });
});

describe("deactivateOverrideSchema", () => {
  it("accepts no replacement rate", () => {
    const result = parseFormData(deactivateOverrideSchema, form({ id: CANDIDATE_ID, restore_id: "" }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.restore_id).toBeFalsy();
  });

  it("accepts a named replacement rate", () => {
    const result = parseFormData(deactivateOverrideSchema, form({ id: CANDIDATE_ID, restore_id: REPLACEMENT_ID }));

    expect(result.ok).toBe(true);
    if (result.ok) expect(result.data.restore_id).toBe(REPLACEMENT_ID);
  });

  it("refuses a replacement that is not a uuid", () => {
    expect(parseFormData(deactivateOverrideSchema, form({ id: CANDIDATE_ID, restore_id: "abc" })).ok).toBe(false);
  });
});

describe("effectiveDateToTimestamp", () => {
  it("anchors the date to the start of the day in Bangladesh", () => {
    expect(effectiveDateToTimestamp("2026-10-15")).toBe("2026-10-15T00:00:00+06:00");
  });

  it("is not midnight UTC, which would be 6am in Dhaka", () => {
    expect(effectiveDateToTimestamp("2026-10-15")).not.toContain("Z");
  });
});

describe("the freshness policy", () => {
  const now = new Date("2026-10-12T18:00:00+06:00");

  it("treats a recent timestamp as within the policy and needing no acknowledgement", () => {
    const result = assessProviderTimestamp("2026-10-12T17:26:22+06:00", FALLBACK_FRESHNESS_POLICY, now);

    expect(result.level).toBe("current");
    expect(result.requiresAcknowledgement).toBe(false);
    expect(result.refusesPublication).toBe(false);
  });

  it("flags a timestamp past the age limit and requires an acknowledgement", () => {
    const result = assessProviderTimestamp("2026-10-04T10:00:00+06:00", FALLBACK_FRESHNESS_POLICY, now);

    expect(result.level).toBe("stale");
    expect(result.requiresAcknowledgement).toBe(true);
    // Stale data is reviewable, not unpublishable: the timestamp is a build time,
    // so it cannot show that the price itself is old.
    expect(result.refusesPublication).toBe(false);
  });

  it("refuses a timestamp further into the future than the tolerated skew", () => {
    const result = assessProviderTimestamp("2026-10-20T10:00:00+06:00", FALLBACK_FRESHNESS_POLICY, now);

    expect(result.level).toBe("implausible");
    expect(result.refusesPublication).toBe(true);
  });

  it("requires an acknowledgement when there is no timestamp at all", () => {
    const result = assessProviderTimestamp(null, FALLBACK_FRESHNESS_POLICY, now);

    expect(result.level).toBe("unknown");
    expect(result.requiresAcknowledgement).toBe(true);
  });

  it("never claims the price is current, only that the record is inside the policy", () => {
    const result = assessProviderTimestamp("2026-10-12T17:26:22+06:00", FALLBACK_FRESHNESS_POLICY, now);

    expect(result.explanation).toContain("rather than proof");
    for (const claim of ["live price", "current market", "guaranteed"]) {
      expect(result.explanation.toLowerCase()).not.toContain(claim);
    }
  });

  it("falls back to the documented defaults for a policy it cannot read", () => {
    expect(policyFromRow(null)).toEqual(FALLBACK_FRESHNESS_POLICY);
    expect(
      policyFromRow({ max_candidate_age_hours: 0, max_published_age_hours: -1, max_future_skew_minutes: 180 }),
    ).toEqual(FALLBACK_FRESHNESS_POLICY);
  });

  it("uses the values the database supplied when they are usable", () => {
    expect(
      policyFromRow({ max_candidate_age_hours: 12, max_published_age_hours: 24, max_future_skew_minutes: 60 }),
    ).toEqual({ maxCandidateAgeHours: 12, maxPublishedAgeHours: 24, maxFutureSkewMinutes: 60 });
  });
});
