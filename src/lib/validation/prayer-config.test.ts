import { describe, expect, it } from "vitest";

import {
  METHOD_ENGINE_PARAMETERS,
  PRAYER_ADJUSTMENT_LIMIT_MINUTES,
  PRAYER_CALCULATION_METHODS,
  PRAYER_CONFIG_SCHEMA_VERSION,
  PRAYER_CONFIG_SCOPES,
  SCOPE_PRECEDENCE,
  SCOPE_TARGET_COLUMN,
  SUPPORTED_ENGINES,
  describeAdjustment,
  diffPrayerConfigs,
  isSupportedConfigSchemaVersion,
  prayerCalculationConfigSchema,
  prayerConfigIssuesHaveErrors,
  reviewPrayerConfigForPublish,
  scopeTargetId,
  type PrayerConfigForPublish,
} from "@/lib/validation/prayer-config";
import { capabilitiesFor, navForRole, roleCan } from "@/lib/permissions/permissions";
import type { PrayerCalculationConfigRow } from "@/lib/types/database";

/**
 * Tests for the rules that decide what may be stored and what may be published.
 *
 * These are the places where a bug is silent and expensive. A method the panel
 * believes it can publish but the engine cannot read produces a configuration that
 * does nothing; an adjustment outside the engine's clamp produces a parameter the
 * app silently corrects; and a scope the app cannot resolve produces an override
 * that never applies to anybody. All three are invisible in the interface — the
 * form looks right, the row saves, and the effect is simply absent.
 */

const DIVISION_ID = "11111111-1111-4111-8111-111111111111";
const DISTRICT_ID = "22222222-2222-4222-8222-222222222222";
const THANA_ID = "33333333-3333-4333-8333-333333333333";

function formPayload(overrides: Record<string, string> = {}): Record<string, string> {
  return {
    name: "Bangladesh default",
    scope: "global",
    engine_key: "adhan_kotlin",
    engine_version: "0.0.5",
    calculation_method: "karachi",
    asr_madhhab: "hanafi",
    high_latitude_rule: "automatic",
    adjust_fajr: "0",
    adjust_dhuhr: "0",
    adjust_asr: "0",
    adjust_maghrib: "0",
    adjust_isha: "0",
    timezone: "Asia/Dhaka",
    effective_from: "2026-01-01",
    source_name: "internal decision",
    ...overrides,
  };
}

function publishable(overrides: Partial<PrayerConfigForPublish> = {}): PrayerConfigForPublish {
  return {
    name: "Bangladesh default",
    scope: "global",
    division_id: null,
    district_id: null,
    thana_id: null,
    engine_key: "adhan_kotlin",
    engine_version: "0.0.5",
    calculation_method: "karachi",
    asr_madhhab: "hanafi",
    high_latitude_rule: "automatic",
    timezone: "Asia/Dhaka",
    effective_from: "2026-01-01",
    effective_to: null,
    source_name: "internal decision",
    ...overrides,
  };
}

// --- Engine parity -----------------------------------------------------------

describe("calculation methods", () => {
  it("lists exactly the methods the Android engine ships", () => {
    // Mirrors PrayerCalculationMethod in the prayer repository. Adding a member here
    // without adding it there would let the panel publish an unreadable method.
    expect([...PRAYER_CALCULATION_METHODS].sort()).toEqual(
      [
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
      ].sort(),
    );
  });

  it("carries the engine's own angles for every method", () => {
    expect(METHOD_ENGINE_PARAMETERS.karachi).toEqual({
      fajrAngleDegrees: 18.0,
      ishaAngleDegrees: 18.0,
      ishaIntervalMinutes: null,
    });
    expect(METHOD_ENGINE_PARAMETERS.muslim_world_league.ishaAngleDegrees).toBe(17.0);
    expect(METHOD_ENGINE_PARAMETERS.egyptian).toEqual({
      fajrAngleDegrees: 19.5,
      ishaAngleDegrees: 17.5,
      ishaIntervalMinutes: null,
    });
    expect(METHOD_ENGINE_PARAMETERS.dubai.fajrAngleDegrees).toBe(18.2);
    expect(METHOD_ENGINE_PARAMETERS.north_america.fajrAngleDegrees).toBe(15.0);
    expect(METHOD_ENGINE_PARAMETERS.singapore.fajrAngleDegrees).toBe(20.0);
    expect(METHOD_ENGINE_PARAMETERS.kuwait.ishaAngleDegrees).toBe(17.5);
    expect(METHOD_ENGINE_PARAMETERS.turkey.ishaAngleDegrees).toBe(17.0);
  });

  it("defines Isha as either an angle or an interval, never both", () => {
    for (const method of PRAYER_CALCULATION_METHODS) {
      const parameters = METHOD_ENGINE_PARAMETERS[method];
      const hasAngle = parameters.ishaAngleDegrees !== null;
      const hasInterval = parameters.ishaIntervalMinutes !== null;
      expect(hasAngle !== hasInterval, `${method} must define Isha exactly one way`).toBe(true);
    }
  });

  it("treats only Umm al-Qura and Qatar as interval-based", () => {
    const intervalMethods = PRAYER_CALCULATION_METHODS.filter(
      (method) => METHOD_ENGINE_PARAMETERS[method].ishaIntervalMinutes !== null,
    );
    expect(intervalMethods).toEqual(["umm_al_qura", "qatar"]);
    expect(METHOD_ENGINE_PARAMETERS.umm_al_qura.ishaIntervalMinutes).toBe(90);
    expect(METHOD_ENGINE_PARAMETERS.qatar.ishaIntervalMinutes).toBe(90);
  });
});

// --- Scope -------------------------------------------------------------------

describe("location scope", () => {
  it("does not offer locality, because the app cannot resolve one", () => {
    // The app's BangladeshLocalityRef carries a name, a district id and a kind but no
    // stable id, so a locality override could never be matched to a stored location.
    // Adding this scope requires an Android-side change first.
    expect(PRAYER_CONFIG_SCOPES).not.toContain("locality");
    expect([...PRAYER_CONFIG_SCOPES]).toEqual(["global", "division", "district", "thana"]);
  });

  it("orders precedence from most specific to least", () => {
    expect([...SCOPE_PRECEDENCE]).toEqual(["thana", "district", "division", "global"]);
  });

  it("maps every scope to exactly one target column, and global to none", () => {
    for (const scope of PRAYER_CONFIG_SCOPES) {
      const column = SCOPE_TARGET_COLUMN[scope];
      if (scope === "global") expect(column).toBeNull();
      else expect(column).not.toBeNull();
    }
  });

  it("reads the target id for the row's own scope", () => {
    expect(scopeTargetId({ scope: "global", division_id: null, district_id: null, thana_id: null })).toBeNull();
    expect(
      scopeTargetId({ scope: "thana", division_id: null, district_id: null, thana_id: THANA_ID }),
    ).toBe(THANA_ID);
    expect(
      scopeTargetId({ scope: "division", division_id: DIVISION_ID, district_id: null, thana_id: null }),
    ).toBe(DIVISION_ID);
  });
});

// --- Saving ------------------------------------------------------------------

describe("configuration validation on save", () => {
  it("accepts a well-formed global configuration", () => {
    const result = prayerCalculationConfigSchema.safeParse(formPayload());
    expect(result.success).toBe(true);
  });

  it("accepts a draft with no method chosen yet", () => {
    // A draft may legitimately be incomplete; incompleteness blocks publishing, not
    // saving, so an operator transcribing from a printed source can save half-finished work.
    const result = prayerCalculationConfigSchema.safeParse(formPayload({ calculation_method: "" }));
    expect(result.success).toBe(true);
  });

  it("rejects a method the engine does not implement", () => {
    const result = prayerCalculationConfigSchema.safeParse(
      formPayload({ calculation_method: "makkah_royal_court" }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.calculation_method).toBeDefined();
  });

  it("requires a target for a scoped configuration", () => {
    const result = prayerCalculationConfigSchema.safeParse(
      formPayload({ scope: "thana", thana_id: "" }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.thana_id).toBeDefined();
  });

  it("rejects a target that does not match the scope", () => {
    const result = prayerCalculationConfigSchema.safeParse(
      formPayload({ scope: "global", thana_id: THANA_ID }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.thana_id).toBeDefined();
  });

  it("accepts each scoped configuration with its own target", () => {
    for (const [scope, column, id] of [
      ["division", "division_id", DIVISION_ID],
      ["district", "district_id", DISTRICT_ID],
      ["thana", "thana_id", THANA_ID],
    ] as const) {
      const result = prayerCalculationConfigSchema.safeParse(
        formPayload({ scope, [column]: id }),
      );
      expect(result.success, `${scope} should be accepted`).toBe(true);
    }
  });

  it("clamps adjustments to the engine's own limit", () => {
    expect(PRAYER_ADJUSTMENT_LIMIT_MINUTES).toBe(60);

    const ok = prayerCalculationConfigSchema.safeParse(formPayload({ adjust_fajr: "60" }));
    expect(ok.success).toBe(true);

    const tooLate = prayerCalculationConfigSchema.safeParse(formPayload({ adjust_fajr: "61" }));
    expect(tooLate.success).toBe(false);

    const tooEarly = prayerCalculationConfigSchema.safeParse(formPayload({ adjust_isha: "-61" }));
    expect(tooEarly.success).toBe(false);

    const notWhole = prayerCalculationConfigSchema.safeParse(formPayload({ adjust_asr: "2.5" }));
    expect(notWhole.success).toBe(false);
  });

  it("defaults an omitted adjustment to no correction", () => {
    const payload = formPayload();
    delete (payload as Record<string, string>).adjust_maghrib;
    const result = prayerCalculationConfigSchema.safeParse(payload);
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.adjust_maghrib).toBe(0);
  });

  it("rejects a reversed effective period", () => {
    const result = prayerCalculationConfigSchema.safeParse(
      formPayload({ effective_from: "2026-06-01", effective_to: "2026-05-01" }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.effective_to).toBeDefined();
  });

  it("rejects an impossible calendar date", () => {
    const result = prayerCalculationConfigSchema.safeParse(
      formPayload({ effective_from: "2026-02-31" }),
    );
    expect(result.success).toBe(false);
  });

  it("rejects a timezone that is not a real IANA identifier", () => {
    expect(prayerCalculationConfigSchema.safeParse(formPayload({ timezone: "Asia/Dhaka" })).success).toBe(true);
    expect(prayerCalculationConfigSchema.safeParse(formPayload({ timezone: "Dhaka" })).success).toBe(false);
    expect(
      prayerCalculationConfigSchema.safeParse(formPayload({ timezone: "Asia/Nowhere" })).success,
    ).toBe(false);
  });

  it("refuses an engine version the app does not ship", () => {
    const result = prayerCalculationConfigSchema.safeParse(
      formPayload({ engine_version: "0.0.9" }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.engine_version).toBeDefined();
  });

  it("refuses an engine the app does not ship", () => {
    const result = prayerCalculationConfigSchema.safeParse(
      formPayload({ engine_key: "some_other_engine" }),
    );
    expect(result.success).toBe(false);
    if (result.success) return;
    expect(result.error.flatten().fieldErrors.engine_key).toBeDefined();
  });

  it("carries the concurrency token through", () => {
    const result = prayerCalculationConfigSchema.safeParse(
      formPayload({ __expected_updated_at: "2026-05-01T10:00:00.000Z" }),
    );
    expect(result.success).toBe(true);
    if (!result.success) return;
    expect(result.data.__expected_updated_at).toBe("2026-05-01T10:00:00.000Z");
  });
});

// --- Publishing --------------------------------------------------------------

describe("pre-publication review", () => {
  it("passes a complete configuration with only informational warnings", () => {
    const issues = reviewPrayerConfigForPublish(publishable(), { today: "2026-05-01" });
    expect(prayerConfigIssuesHaveErrors(issues)).toBe(false);
    // The global scope is worth stating, not a defect.
    expect(issues.some((issue) => issue.severity === "warning")).toBe(true);
  });

  it("blocks a configuration with no calculation method", () => {
    const issues = reviewPrayerConfigForPublish(publishable({ calculation_method: null }), {
      today: "2026-05-01",
    });
    expect(prayerConfigIssuesHaveErrors(issues)).toBe(true);
    expect(issues.some((issue) => issue.field === "calculation_method")).toBe(true);
  });

  it("blocks a configuration with no source", () => {
    const issues = reviewPrayerConfigForPublish(publishable({ source_name: null }), {
      today: "2026-05-01",
    });
    expect(prayerConfigIssuesHaveErrors(issues)).toBe(true);
    expect(issues.some((issue) => issue.field === "source_name")).toBe(true);
  });

  it("blocks a configuration with no effective-from date", () => {
    const issues = reviewPrayerConfigForPublish(publishable({ effective_from: null }), {
      today: "2026-05-01",
    });
    expect(prayerConfigIssuesHaveErrors(issues)).toBe(true);
    expect(issues.some((issue) => issue.field === "effective_from")).toBe(true);
  });

  it("blocks a scoped configuration with no location selected", () => {
    const issues = reviewPrayerConfigForPublish(
      publishable({ scope: "thana", thana_id: null }),
      { today: "2026-05-01" },
    );
    expect(prayerConfigIssuesHaveErrors(issues)).toBe(true);
    expect(issues.some((issue) => issue.field === "thana_id")).toBe(true);
  });

  it("blocks an engine or version the app does not ship", () => {
    for (const override of [
      { engine_key: "not_an_engine" },
      { engine_version: "0.0.7" },
    ]) {
      const issues = reviewPrayerConfigForPublish(publishable(override), { today: "2026-05-01" });
      expect(prayerConfigIssuesHaveErrors(issues)).toBe(true);
    }
  });

  it("blocks an invalid timezone", () => {
    const issues = reviewPrayerConfigForPublish(publishable({ timezone: "Asia/Nowhere" }), {
      today: "2026-05-01",
    });
    expect(prayerConfigIssuesHaveErrors(issues)).toBe(true);
    expect(issues.some((issue) => issue.field === "timezone")).toBe(true);
  });

  it("warns, but does not block, on an already-expired effective period", () => {
    const issues = reviewPrayerConfigForPublish(
      publishable({ effective_from: "2025-01-01", effective_to: "2025-06-01" }),
      { today: "2026-05-01" },
    );
    expect(prayerConfigIssuesHaveErrors(issues)).toBe(false);
    expect(issues.some((issue) => issue.field === "effective_to")).toBe(true);
  });

  it("warns, but does not block, on a future effective period", () => {
    const issues = reviewPrayerConfigForPublish(
      publishable({ effective_from: "2027-01-01" }),
      { today: "2026-05-01" },
    );
    expect(prayerConfigIssuesHaveErrors(issues)).toBe(false);
    expect(issues.some((issue) => issue.field === "effective_from")).toBe(true);
  });

  it("does not warn about scope for a location-specific configuration", () => {
    const issues = reviewPrayerConfigForPublish(
      publishable({ scope: "district", district_id: DISTRICT_ID }),
      { today: "2026-05-01" },
    );
    expect(issues).toEqual([]);
  });
});

// --- Contract version -------------------------------------------------------

describe("payload schema version", () => {
  it("accepts the versions this contract defines", () => {
    expect(isSupportedConfigSchemaVersion(PRAYER_CONFIG_SCHEMA_VERSION)).toBe(true);
    expect(isSupportedConfigSchemaVersion(1)).toBe(true);
  });

  it("rejects a newer version rather than partially applying it", () => {
    expect(isSupportedConfigSchemaVersion(2)).toBe(false);
    expect(isSupportedConfigSchemaVersion(99)).toBe(false);
  });

  it("rejects a malformed version", () => {
    expect(isSupportedConfigSchemaVersion(0)).toBe(false);
    expect(isSupportedConfigSchemaVersion(-1)).toBe(false);
    expect(isSupportedConfigSchemaVersion(1.5)).toBe(false);
  });

  it("knows exactly one engine and one version", () => {
    // The publish function in SQL repeats this list; the two must move together.
    expect(Object.keys(SUPPORTED_ENGINES)).toEqual(["adhan_kotlin"]);
    expect(SUPPORTED_ENGINES.adhan_kotlin!.versions).toEqual(["0.0.5"]);
  });
});

// --- Presentation -----------------------------------------------------------

describe("adjustment and diff rendering", () => {
  it("describes an adjustment with its sign and unit", () => {
    expect(describeAdjustment(0)).toBe("No adjustment");
    expect(describeAdjustment(3)).toBe("+3 min");
    expect(describeAdjustment(-2)).toBe("-2 min");
  });

  it("returns only the fields that changed", () => {
    const base = {
      scope: "global",
      division_id: null,
      district_id: null,
      thana_id: null,
      calculation_method: "karachi",
      asr_madhhab: "hanafi",
      high_latitude_rule: "automatic",
      adjust_fajr: 0,
      adjust_dhuhr: 0,
      adjust_asr: 0,
      adjust_maghrib: 0,
      adjust_isha: 0,
      timezone: "Asia/Dhaka",
      effective_from: "2026-01-01",
      effective_to: null,
      source_name: "internal decision",
      engine_key: "adhan_kotlin",
      engine_version: "0.0.5",
    } satisfies Partial<PrayerCalculationConfigRow>;

    const locationLabel = () => "All locations";

    // Identical values produce no differences at all.
    expect(
      diffPrayerConfigs(
        base as unknown as PrayerCalculationConfigRow,
        base as unknown as PrayerCalculationConfigRow,
        locationLabel,
      ),
    ).toEqual([]);

    const changed = diffPrayerConfigs(
      base as unknown as PrayerCalculationConfigRow,
      { ...base, asr_madhhab: "shafi", adjust_isha: -5 } as unknown as PrayerCalculationConfigRow,
      locationLabel,
    );

    expect(changed.map((entry) => entry.label).sort()).toEqual([
      "Asr madhhab",
      "Isha adjustment",
    ]);
    expect(changed.find((entry) => entry.label === "Isha adjustment")?.after).toBe("-5 min");
  });
});

// --- Permissions -------------------------------------------------------------

describe("prayer configuration permissions", () => {
  it("is limited to super admins and prayer data reviewers", () => {
    expect(roleCan("super_admin", "manage_prayer_config")).toBe(true);
    expect(roleCan("prayer_data_reviewer", "manage_prayer_config")).toBe(true);
    expect(roleCan("location_manager", "manage_prayer_config")).toBe(false);
    expect(roleCan("content_editor", "manage_prayer_config")).toBe(false);
    expect(roleCan("support_admin", "manage_prayer_config")).toBe(false);
    expect(roleCan(null, "manage_prayer_config")).toBe(false);
  });

  it("does not give a prayer data reviewer unrelated capabilities", () => {
    const capabilities = capabilitiesFor("prayer_data_reviewer");
    expect(capabilities).toContain("manage_prayer_config");
    expect(capabilities).not.toContain("manage_admins");
    expect(capabilities).not.toContain("manage_locations");
    expect(capabilities).not.toContain("manage_feedback");
  });

  it("shows the navigation entry only to roles that can open the page", () => {
    const reviewerHrefs = navForRole("prayer_data_reviewer").flatMap((section) =>
      section.items.map((item) => item.href),
    );
    const supportHrefs = navForRole("support_admin").flatMap((section) =>
      section.items.map((item) => item.href),
    );

    expect(reviewerHrefs).toContain("/prayer-config");
    expect(supportHrefs).not.toContain("/prayer-config");
  });
});
