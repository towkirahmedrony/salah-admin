import type { MetalPriceRow } from "@/lib/types/database";

/**
 * The reference-price freshness policy.
 *
 * The thresholds themselves live in the database
 * (`public.metal_price_freshness_policy()`, migration
 * `20260101001100_metal_price_functions_and_policies.sql`) and are read from
 * there rather than kept as a second copy here. That matters for one reason
 * above the others: `publish_metal_price_rate()` refuses a stale candidate
 * without an acknowledgement, and if the panel had its own idea of "stale" the
 * two could disagree about a specific price.
 *
 * This module is the *interpretation* of that policy — what each level means and
 * what the administrator is told — and it is pure, so it is testable without a
 * database.
 *
 * What the policy can and cannot say
 * ---------------------------------
 * The provider's `lastUpdate` is the time its JSON document was built. It is not
 * the time the price changed, and the provider says so: prices may be unchanged
 * between builds. So an old timestamp does not prove a price is out of date, and
 * a fresh one does not prove it is current. Every level below is therefore a
 * statement about *the record*, never a claim about the market.
 */
export interface FreshnessPolicy {
  /** How old a candidate's provider timestamp may be before it needs an acknowledgement. */
  maxCandidateAgeHours: number;
  /** How old a *published* rate's provider timestamp may be before the panel asks for a review. */
  maxPublishedAgeHours: number;
  /** How far into the future a provider timestamp may be before it is treated as broken. */
  maxFutureSkewMinutes: number;
}

/**
 * Used only when the policy cannot be read — for instance before the migration
 * has been applied. These are the same numbers as the migration's defaults, so a
 * missing policy degrades to exactly the documented behaviour rather than to
 * "no policy at all".
 */
export const FALLBACK_FRESHNESS_POLICY: FreshnessPolicy = {
  maxCandidateAgeHours: 72,
  maxPublishedAgeHours: 96,
  maxFutureSkewMinutes: 180,
};

export type FreshnessLevel =
  /** Within the policy, and the date it was built is known. */
  | "current"
  /** Inside the policy, but far enough into it that a review is worth prompting. */
  | "aging"
  /** Beyond the policy: publishing needs an explicit acknowledgement. */
  | "stale"
  /** No timestamp at all, so nothing can be said about when the document was built. */
  | "unknown"
  /** Further into the future than the tolerated clock skew: a broken feed or clock. */
  | "implausible";

export interface FreshnessAssessment {
  level: FreshnessLevel;
  /** Hours between the timestamp and now; null when there is no usable timestamp. */
  ageHours: number | null;
  /** Short label for a badge. */
  label: string;
  /** One sentence, shown next to the timestamp. Never claims the price is current. */
  explanation: string;
  /** True when publishing must be explicitly acknowledged (see the publish RPC). */
  requiresAcknowledgement: boolean;
  /** True when the timestamp cannot be trusted at all and publication is refused. */
  refusesPublication: boolean;
}

const HOUR_MS = 60 * 60 * 1000;

function hoursBetween(from: Date, to: Date): number {
  return (to.getTime() - from.getTime()) / HOUR_MS;
}

/**
 * Assesses a provider-supplied timestamp against the policy.
 *
 * `now` is a parameter rather than a call to `Date.now()` so the result is
 * deterministic in a test.
 */
export function assessProviderTimestamp(
  providerLastUpdate: string | null | undefined,
  policy: FreshnessPolicy,
  now: Date = new Date(),
): FreshnessAssessment {
  if (!providerLastUpdate) {
    return {
      level: "unknown",
      ageHours: null,
      label: "No provider timestamp",
      explanation:
        "The provider did not supply a timestamp for this record, so when its data was built is unknown. That does not make the price wrong, but nothing here shows when it was last refreshed.",
      requiresAcknowledgement: true,
      refusesPublication: false,
    };
  }

  const timestamp = new Date(providerLastUpdate);
  if (Number.isNaN(timestamp.getTime())) {
    return {
      level: "unknown",
      ageHours: null,
      label: "Unreadable timestamp",
      explanation:
        "The provider timestamp could not be read as a date and time, so this record's freshness cannot be judged from it.",
      requiresAcknowledgement: true,
      refusesPublication: false,
    };
  }

  const ageHours = hoursBetween(timestamp, now);

  if (ageHours < -policy.maxFutureSkewMinutes / 60) {
    return {
      level: "implausible",
      ageHours,
      label: "Timestamp in the future",
      explanation: `The provider timestamp is ${Math.round(-ageHours)} hours in the future, which is further than the ${policy.maxFutureSkewMinutes}-minute clock skew this panel tolerates. A timestamp that has not happened yet cannot be reviewed into validity, so this record is refused rather than flagged.`,
      requiresAcknowledgement: false,
      refusesPublication: true,
    };
  }

  if (ageHours > policy.maxCandidateAgeHours) {
    const days = Math.round(ageHours / 24);
    return {
      level: "stale",
      ageHours,
      label: "Older than the freshness policy",
      explanation: `The provider document was built about ${days} day${days === 1 ? "" : "s"} ago, which is past the ${policy.maxCandidateAgeHours}-hour limit. That is when the file was generated, not when the price changed — so it does not prove the price is out of date, and it cannot show that it is current either. Check the source before publishing, and record the effective date if you can establish it.`,
      requiresAcknowledgement: true,
      refusesPublication: false,
    };
  }

  if (ageHours > policy.maxCandidateAgeHours / 2) {
    return {
      level: "aging",
      ageHours,
      label: "Approaching the freshness limit",
      explanation: `The provider document was built about ${Math.round(ageHours)} hours ago. Still within the ${policy.maxCandidateAgeHours}-hour policy, so review is not required, but the next refresh is worth watching.`,
      requiresAcknowledgement: false,
      refusesPublication: false,
    };
  }

  return {
    level: "current",
    ageHours,
    label: "Within the freshness policy",
    explanation: `The provider document was built about ${Math.round(ageHours)} hour${Math.round(ageHours) === 1 ? "" : "s"} ago. That is when the file was generated, which is a statement about the record rather than proof that the price is current.`,
    requiresAcknowledgement: false,
    refusesPublication: false,
  };
}

/** Assesses how long ago a rate was last confirmed, for the published view. */
export function assessPublishedAge(
  rate: Pick<MetalPriceRow, "provider_last_update" | "fetched_at">,
  policy: FreshnessPolicy,
  now: Date = new Date(),
): FreshnessAssessment {
  const assessment = assessProviderTimestamp(rate.provider_last_update, policy, now);
  if (assessment.level !== "current" && assessment.level !== "aging") return assessment;

  // A published rate gets the longer published window: it is already live, and
  // the question is whether to prompt for a review, not whether to withhold it.
  if (assessment.ageHours !== null && assessment.ageHours > policy.maxPublishedAgeHours) {
    const days = Math.round(assessment.ageHours / 24);
    return {
      level: "stale",
      ageHours: assessment.ageHours,
      label: "Review recommended",
      explanation: `This rate has been published from a provider document built about ${days} day${days === 1 ? "" : "s"} ago, past the ${policy.maxPublishedAgeHours}-hour review threshold. It stays published — the app reads it — but a fresh price should be fetched and reviewed.`,
      requiresAcknowledgement: true,
      refusesPublication: false,
    };
  }

  return assessment;
}

/** Reads the policy out of a `metal_price_freshness_policy()` row, defensively. */
export function policyFromRow(row: {
  max_candidate_age_hours: number;
  max_published_age_hours: number;
  max_future_skew_minutes: number;
} | null | undefined): FreshnessPolicy {
  if (!row) return FALLBACK_FRESHNESS_POLICY;

  return {
    maxCandidateAgeHours: positiveOr(row.max_candidate_age_hours, FALLBACK_FRESHNESS_POLICY.maxCandidateAgeHours),
    maxPublishedAgeHours: positiveOr(row.max_published_age_hours, FALLBACK_FRESHNESS_POLICY.maxPublishedAgeHours),
    maxFutureSkewMinutes: positiveOr(row.max_future_skew_minutes, FALLBACK_FRESHNESS_POLICY.maxFutureSkewMinutes),
  };
}

function positiveOr(value: number | null | undefined, fallback: number): number {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : fallback;
}
