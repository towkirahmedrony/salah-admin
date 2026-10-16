"use server";

import { revalidatePath } from "next/cache";

import { guardAction } from "@/lib/auth/guards";
import { isPermissionIssue, toAppError } from "@/lib/errors";
import { parseFormData } from "@/lib/validation/common";
import {
  deactivateOverrideSchema,
  effectiveDateToTimestamp,
  metalPriceOverrideSchema,
  publishRateSchema,
  rejectCandidateSchema,
} from "@/lib/validation/metal-prices";
import type { ServerSupabaseClient } from "@/lib/supabase/server";
import type { MetalPriceRow, MetalPurity, MetalType } from "@/lib/types/database";
import { PROVIDER, fetchProviderPrices, type ProviderReadResult } from "@/features/metal-prices/provider";
import { getFreshnessPolicy } from "@/features/metal-prices/queries";
import { rateLabel } from "@/features/metal-prices/definitions";
import { formatPricePerGram } from "@/lib/utils/format";

/**
 * Server actions for gold and silver reference prices.
 *
 * Division of responsibility, because it matters here more than usual:
 *
 *   * This file is the only place the provider is contacted. It runs on the
 *     server, it is reached only through an authenticated session, and the
 *     capability is re-checked before anything happens.
 *   * The *decisions* are the database's. Recording a candidate, publishing one,
 *     rejecting one, and activating an override are all SECURITY DEFINER
 *     functions that re-check the same capability, so a bug in this file cannot
 *     publish an unverified price or displace an active override.
 *   * Nothing here publishes. A fetch produces candidates and stops.
 */

export interface MetalPriceActionState {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
}

export const INITIAL_METAL_PRICE_ACTION_STATE: MetalPriceActionState = {
  status: "idle",
  message: "",
};

export interface MetalSyncOutcome {
  metal: MetalType;
  status: "succeeded" | "failed" | "skipped";
  /** Categories stored as candidates awaiting review. */
  recorded: Array<{ purity: MetalPurity; pricePerGram: string }>;
  /** Categories the provider published that the panel would not store, with reasons. */
  rejected: Array<{ purity: MetalPurity; reason: string }>;
  notices: string[];
  error?: string;
}

export interface MetalPriceSyncState {
  status: "idle" | "success" | "partial" | "error";
  message: string;
  outcomes?: MetalSyncOutcome[];
  totals?: {
    goldCandidates: number;
    silverCandidates: number;
    pending: number;
    rejected: number;
    overridesPreserved: number;
  };
}

export const INITIAL_METAL_PRICE_SYNC_STATE: MetalPriceSyncState = { status: "idle", message: "" };

function revalidateMetalPricePaths(): void {
  revalidatePath("/metal-prices");
  revalidatePath("/dashboard");
}

/** How recently a run must have started for a second one to be refused as a duplicate. */
const DUPLICATE_SYNC_WINDOW_MS = 90_000;

/**
 * Fetches the provider's current documents and stores them as candidates.
 *
 * Gold and silver are fetched and judged separately: a submission answering one
 * of them and timing out on the other is reported as a partial success, and the
 * metal that answered still produces candidates. Nothing is published — a
 * candidate exists precisely so an administrator can look at it first.
 */
export async function synchronizeMetalPrices(
  _previous: MetalPriceSyncState,
  _formData: FormData,
): Promise<MetalPriceSyncState> {
  const guard = await guardAction("manage_metal_prices");
  if (!guard.ok) return { status: "error", message: guard.message };
  const { supabase } = guard;

  // A second submission while the first is still running would double the work and
  // race the candidate upsert for nothing. The window is short, so a run that died
  // does not lock the page for long.
  const { data: running, error: runningError } = await supabase
    .from("metal_price_sync_logs")
    .select("id, started_at")
    .eq("status", "running")
    .gte("started_at", new Date(Date.now() - DUPLICATE_SYNC_WINDOW_MS).toISOString())
    .limit(1);

  if (runningError) {
    return { status: "error", message: toAppError(runningError).message };
  }
  if (running && running.length > 0) {
    return {
      status: "error",
      message:
        "A synchronization started less than two minutes ago is still running. Wait for it to finish before starting another.",
    };
  }

  const policy = await getFreshnessPolicy(supabase);

  const { data: syncId, error: startError } = await supabase.rpc("start_metal_price_sync", {
    p_provider: PROVIDER.name,
  });

  if (startError || !syncId) {
    const mapped = toAppError(startError);
    return {
      status: "error",
      message: isPermissionIssue(startError)
        ? "Synchronizing reference prices requires the reference-price capability. Ask a super admin if you need it."
        : mapped.message,
    };
  }

  const overridesBefore = await activeOverrideIdentities(supabase);

  // Both metals, independently. `Promise.allSettled` is not used: the two calls
  // cannot reject — `fetchProviderPrices` turns every failure into a value — and
  // running them together is simply two independent requests.
  const [goldRead, silverRead] = await Promise.all([
    fetchProviderPrices("gold", { policy: policy.value }),
    fetchProviderPrices("silver", { policy: policy.value }),
  ]);

  const outcomes: MetalSyncOutcome[] = [
    await storeOutcome(supabase, syncId, "gold", goldRead),
    await storeOutcome(supabase, syncId, "silver", silverRead),
  ];

  const goldOutcome = outcomes[0]!;
  const silverOutcome = outcomes[1]!;
  const goldCandidates = goldOutcome.recorded.length;
  const silverCandidates = silverOutcome.recorded.length;
  const rejected = goldOutcome.rejected.length + silverOutcome.rejected.length;
  const pending = goldCandidates + silverCandidates;
  const overridesPreserved = overridesBefore.filter((identity) =>
    outcomes.some((outcome) => outcome.metal === identity.metal),
  ).length;

  const attempted = outcomes.filter((outcome) => outcome.status !== "skipped");
  const succeeded = attempted.filter((outcome) => outcome.status === "succeeded");
  const status: "succeeded" | "partial" | "failed" =
    succeeded.length === 0 ? "failed" : succeeded.length === attempted.length ? "succeeded" : "partial";

  const failureSummary = attempted
    .filter((outcome) => outcome.status === "failed")
    .map((outcome) => `${outcome.metal}: ${outcome.error ?? "the request failed"}`)
    .join(" ");

  const { error: finishError } = await supabase.rpc("finish_metal_price_sync", {
    p_sync_id: syncId,
    p_status: status,
    p_gold_status: goldOutcome.status,
    p_silver_status: silverOutcome.status,
    p_gold_candidates: goldCandidates,
    p_silver_candidates: silverCandidates,
    p_pending_candidates: pending,
    p_rejected_candidates: rejected,
    p_overrides_preserved: overridesPreserved,
    p_error_message: failureSummary || null,
  });

  revalidateMetalPricePaths();

  if (finishError) {
    return {
      status: "error",
      message: `${toAppError(finishError).message} The prices that were fetched are already stored as candidates and are visible below.`,
      outcomes,
    };
  }

  return {
    status: status === "failed" ? "error" : status === "partial" ? "partial" : "success",
    message: summarizeSync(status, outcomes, pending, overridesPreserved),
    outcomes,
    totals: {
      goldCandidates,
      silverCandidates,
      pending,
      rejected,
      overridesPreserved,
    },
  };
}

/**
 * Stores one metal's outcome.
 *
 * Every category is recorded through the database function, which is where the
 * price is validated a second time, where the candidate is marked pending, and
 * where an active override is left alone. A category the database refuses is
 * reported as rejected rather than failing the metal, so one unusable category
 * does not discard the others.
 */
async function storeOutcome(
  supabase: ServerSupabaseClient,
  syncId: string,
  metal: MetalType,
  read: ProviderReadResult,
): Promise<MetalSyncOutcome> {
  if (!read.ok) {
    return { metal, status: "failed", recorded: [], rejected: [], notices: [], error: read.message };
  }

  const recorded: Array<{ purity: MetalPurity; pricePerGram: string }> = [];
  const rejected: Array<{ purity: MetalPurity; reason: string }> = [...read.rejected];

  for (const rate of read.accepted) {
    const { error } = await supabase.rpc("record_metal_price_candidate", {
      p_sync_id: syncId,
      p_metal_type: metal,
      p_purity: rate.purity,
      // The provider's digits, as a string. A JSON number here would be parsed as
      // a double before PostgreSQL ever saw it.
      p_price_per_gram: rate.pricePerGram,
      p_currency: read.currency,
      p_source: read.source,
      p_source_url: read.sourceUrl,
      p_provider_last_update: read.lastUpdate,
      p_fetched_at: new Date().toISOString(),
    });

    if (error) {
      rejected.push({ purity: rate.purity, reason: toAppError(error).message });
      continue;
    }

    recorded.push({ purity: rate.purity, pricePerGram: rate.pricePerGram });
  }

  if (recorded.length === 0) {
    return {
      metal,
      status: "failed",
      recorded,
      rejected,
      notices: read.notices,
      error: `Nothing usable was stored for ${metal}. ${rejected.map((entry) => `${entry.purity}: ${entry.reason}`).join(" ")}`.trim(),
    };
  }

  return { metal, status: "succeeded", recorded, rejected, notices: read.notices };
}

function summarizeSync(
  status: "succeeded" | "partial" | "failed",
  outcomes: MetalSyncOutcome[],
  pending: number,
  overridesPreserved: number,
): string {
  const parts: string[] = [];

  if (status === "succeeded") {
    parts.push("Both metals were fetched and validated.");
  } else if (status === "partial") {
    parts.push("One metal could not be fetched or validated; the other was.");
  } else {
    parts.push("Neither metal could be fetched or validated.");
  }

  parts.push(
    pending === 0
      ? "No price was stored, so there is nothing new to review."
      : `${pending} price${pending === 1 ? "" : "s"} stored as candidates awaiting your review. Nothing has been published.`,
  );

  if (overridesPreserved > 0) {
    parts.push(
      `${overridesPreserved} active manual override${overridesPreserved === 1 ? " was" : "s were"} preserved: a synchronization never replaces one.`,
    );
  }

  const rejected = outcomes.flatMap((outcome) => outcome.rejected);
  if (rejected.length > 0) {
    parts.push(`${rejected.length} categor${rejected.length === 1 ? "y was" : "ies were"} refused.`);
  }

  return parts.join(" ");
}

async function activeOverrideIdentities(
  supabase: ServerSupabaseClient,
): Promise<Array<{ metal: MetalType; purity: MetalPurity }>> {
  const { data } = await supabase
    .from("metal_prices")
    .select("metal_type, purity")
    .eq("is_active", true)
    .eq("override_active", true);

  return (data ?? []).map((row) => ({ metal: row.metal_type, purity: row.purity }));
}

/**
 * Publishes a reviewed rate.
 *
 * The administrator has looked at the source and the timestamps; this records
 * that decision. Everything else — refusing a rejected candidate, refusing an
 * implausible timestamp, requiring the stale acknowledgement, refusing to
 * displace an active override, and deactivating the incumbent in the same
 * transaction — happens inside `publish_metal_price_rate()`.
 */
export async function publishMetalPriceRate(
  _previous: MetalPriceActionState,
  formData: FormData,
): Promise<MetalPriceActionState> {
  const guard = await guardAction("manage_metal_prices");
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = parseFormData(publishRateSchema, formData);
  if (!parsed.ok) return { status: "error", message: parsed.message, fieldErrors: parsed.fieldErrors };

  // Read the incumbent first so the confirmation can say what is being replaced.
  const previous = await incumbentFor(guard.supabase, parsed.data.id);

  const { data, error } = await guard.supabase.rpc("publish_metal_price_rate", {
    p_id: parsed.data.id,
    p_effective_at: parsed.data.effective_at ? effectiveDateToTimestamp(parsed.data.effective_at) : null,
    p_acknowledge_stale: parsed.data.acknowledge_stale,
  });

  if (error) {
    return { status: "error", message: publishErrorMessage(error) };
  }

  revalidateMetalPricePaths();

  const published = data as MetalPriceRow;
  const label = rateLabel(published.metal_type, published.purity);
  const replaced = previous.rate
    ? ` ${rateLabel(previous.rate.metal_type, previous.rate.purity)} was ${formatPricePerGram(previous.rate.price_per_gram)} BDT per gram and is retained, no longer live.`
    : "";

  return {
    status: "success",
    message: `${label} published at ${formatPricePerGram(published.price_per_gram)} BDT per gram.${replaced}${
      published.effective_at ? "" : " No effective date was recorded, because none could be established."
    }`,
  };
}

function publishErrorMessage(error: unknown): string {
  if (isPermissionIssue(error)) {
    return "Publishing a reference price requires the reference-price capability. Ask a super admin if you need it.";
  }
  return toAppError(error).message;
}

async function incumbentFor(
  supabase: ServerSupabaseClient,
  candidateId: string,
): Promise<{ rate: MetalPriceRow | null }> {
  const { data: candidate } = await supabase
    .from("metal_prices")
    .select("metal_type, purity, currency")
    .eq("id", candidateId)
    .maybeSingle();

  if (!candidate) return { rate: null };

  const { data } = await supabase
    .from("metal_prices")
    .select("*")
    .eq("metal_type", candidate.metal_type)
    .eq("purity", candidate.purity)
    .eq("currency", candidate.currency)
    .eq("is_active", true)
    .maybeSingle();

  return { rate: (data as MetalPriceRow | null) ?? null };
}

/** Records a rejection. Terminal for that candidate; a later fetch creates a new one. */
export async function rejectMetalPriceCandidate(
  _previous: MetalPriceActionState,
  formData: FormData,
): Promise<MetalPriceActionState> {
  const guard = await guardAction("manage_metal_prices");
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = parseFormData(rejectCandidateSchema, formData);
  if (!parsed.ok) return { status: "error", message: parsed.message, fieldErrors: parsed.fieldErrors };

  const { data, error } = await guard.supabase.rpc("reject_metal_price_candidate", {
    p_id: parsed.data.id,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return {
      status: "error",
      message: isPermissionIssue(error)
        ? "Rejecting a candidate requires the reference-price capability. Ask a super admin if you need it."
        : toAppError(error).message,
    };
  }

  revalidateMetalPricePaths();

  const rejected = data as MetalPriceRow;
  return {
    status: "success",
    message: `${rateLabel(rejected.metal_type, rejected.purity)} candidate rejected.${
      parsed.data.reason ? " The reason is recorded with it." : " No reason was recorded."
    } Nothing was published, and the live rate is unchanged.`,
  };
}

/**
 * Records and activates an administrator's own reference price.
 *
 * The entered value is the panel's reference price for that metal and purity, not
 * a market quote and not a claim about any particular item. It is marked as an
 * override, so the next synchronization will fetch a candidate for comparison and
 * leave it in place.
 */
export async function saveMetalPriceOverride(
  _previous: MetalPriceActionState,
  formData: FormData,
): Promise<MetalPriceActionState> {
  const guard = await guardAction("manage_metal_prices");
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = parseFormData(metalPriceOverrideSchema, formData);
  if (!parsed.ok) return { status: "error", message: parsed.message, fieldErrors: parsed.fieldErrors };

  const { data, error } = await guard.supabase.rpc("create_metal_price_override", {
    p_metal_type: parsed.data.metal_type,
    p_purity: parsed.data.purity,
    p_price_per_gram: parsed.data.price_per_gram,
    p_currency: "BDT",
    p_source: parsed.data.source,
    p_source_url: parsed.data.source_url,
    p_effective_at: parsed.data.effective_at ? effectiveDateToTimestamp(parsed.data.effective_at) : null,
    p_reason: parsed.data.reason,
  });

  if (error) {
    return { status: "error", message: overrideErrorMessage(error) };
  }

  revalidateMetalPricePaths();

  const saved = data as MetalPriceRow;
  return {
    status: "success",
    message: `${rateLabel(saved.metal_type, saved.purity)} override activated at ${formatPricePerGram(saved.price_per_gram)} BDT per gram. This is an administrative reference price, and synchronization will not replace it until it is deactivated.`,
  };
}

function overrideErrorMessage(error: unknown): string {
  if (isPermissionIssue(error)) {
    return "Setting a manual reference price requires the reference-price capability. Ask a super admin if you need it.";
  }
  return toAppError(error).message;
}

/**
 * Deactivates an override.
 *
 * Deliberately does not promote anything on the way past: without an explicitly
 * chosen verified replacement, the rate becomes unavailable and the panel says so.
 * That is the honest outcome — a rate nobody has verified should not become live
 * because an override ended.
 */
export async function deactivateMetalPriceOverride(
  _previous: MetalPriceActionState,
  formData: FormData,
): Promise<MetalPriceActionState> {
  const guard = await guardAction("manage_metal_prices");
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = parseFormData(deactivateOverrideSchema, formData);
  if (!parsed.ok) return { status: "error", message: parsed.message, fieldErrors: parsed.fieldErrors };

  const { data, error } = await guard.supabase.rpc("deactivate_metal_price_override", {
    p_id: parsed.data.id,
    p_restore_id: parsed.data.restore_id ?? null,
    p_acknowledge_stale: parsed.data.acknowledge_stale,
  });

  if (error) {
    return {
      status: "error",
      message: isPermissionIssue(error)
        ? "Deactivating an override requires the reference-price capability. Ask a super admin if you need it."
        : toAppError(error).message,
    };
  }

  revalidateMetalPricePaths();

  const result = data as MetalPriceRow;
  const label = rateLabel(result.metal_type, result.purity);

  if (result.is_active) {
    return {
      status: "success",
      message: `${label} override deactivated and the verified rate at ${formatPricePerGram(result.price_per_gram)} BDT per gram restored.`,
    };
  }

  return {
    status: "success",
    message: `${label} override deactivated. No verified rate was restored, so ${label} is now unpublished: the Android app will fall back to manual price entry for it until a reviewed rate is published.`,
  };
}
