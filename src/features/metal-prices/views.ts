import { priceDirection, rateKey, type PriceDirection } from "@/features/metal-prices/definitions";
import { assessProviderTimestamp, assessPublishedAge, type FreshnessAssessment } from "@/features/metal-prices/policy";
import type { MetalPriceSnapshot } from "@/features/metal-prices/queries";
import type { MetalPriceRow, MetalPurity, MetalType } from "@/lib/types/database";

/**
 * Turns the stored rows into the facts a reviewer needs, on the server.
 *
 * The freshness assessments are computed here rather than in the component that
 * renders them, for two reasons: `new Date()` during a client render would make
 * the server and client markup disagree, and the thresholds come from the database
 * — so the page reads them once and passes the conclusion down.
 */

export interface CandidateView {
  candidate: MetalPriceRow;
  metal: MetalType;
  purity: MetalPurity;
  /** The rate that would be replaced, if anything is published for this identity. */
  current: MetalPriceRow | null;
  /** True when the current rate was activated as an administrator's manual override. */
  replacesOverride: boolean;
  currentFreshness: FreshnessAssessment | null;
  candidateFreshness: FreshnessAssessment;
  direction: PriceDirection;
  /** True when publishing needs the stale acknowledgement, whether or not it replaces anything. */
  needsAcknowledgement: boolean;
  /** True when the candidate's timestamp is untrustworthy and publication is refused outright. */
  blocked: boolean;
}

export function buildCandidateViews(snapshot: MetalPriceSnapshot, now: Date = new Date()): CandidateView[] {
  return snapshot.candidates
    .map((candidate) => {
      const current = snapshot.published.get(rateKey(candidate.metal_type, candidate.purity)) ?? null;
      const candidateFreshness = assessProviderTimestamp(candidate.provider_last_update, snapshot.policy, now);

      return {
        candidate,
        metal: candidate.metal_type,
        purity: candidate.purity,
        current,
        replacesOverride: Boolean(current?.override_active),
        currentFreshness: current ? assessPublishedAge(current, snapshot.policy, now) : null,
        candidateFreshness,
        direction: priceDirection(current?.price_per_gram ?? null, candidate.price_per_gram),
        needsAcknowledgement: candidateFreshness.requiresAcknowledgement,
        blocked: candidateFreshness.refusesPublication,
      };
    })
    .sort((a, b) => `${a.metal}:${a.purity}`.localeCompare(`${b.metal}:${b.purity}`));
}

export interface SupersededRateView {
  rate: MetalPriceRow;
  freshness: FreshnessAssessment;
}

/**
 * Previously published, verified rates — the pool a deactivated override can fall
 * back to. Only ever offered as an explicit choice: nothing restores one on its own.
 */
export function buildSupersededViews(snapshot: MetalPriceSnapshot, now: Date = new Date()): SupersededRateView[] {
  return snapshot.superseded
    .map((rate) => ({ rate, freshness: assessProviderTimestamp(rate.provider_last_update, snapshot.policy, now) }))
    .sort((a, b) => b.rate.updated_at.localeCompare(a.rate.updated_at));
}

/** The live override for a rate identity, if there is one. */
export function liveOverrides(snapshot: MetalPriceSnapshot): MetalPriceRow[] {
  return [...snapshot.published.values()].filter((rate) => rate.override_active);
}
