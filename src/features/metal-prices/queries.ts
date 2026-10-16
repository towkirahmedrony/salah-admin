/**
 * Reads for the reference-price screens.
 *
 * Not marked `server-only`, for the same reason as `features/prayer-config/queries.ts`:
 * the module receives the Supabase client as an argument, never reads cookies or
 * headers itself, and its only contact with server code is a type-only import
 * that is erased at compile time.
 */
import type { AppError } from "@/lib/errors";
import { toAppError } from "@/lib/errors";
import type { ServerSupabaseClient } from "@/lib/supabase/server";
import type {
  MetalPriceRow,
  MetalPriceSyncLogRow,
  MetalPurity,
  MetalType,
} from "@/lib/types/database";
import { METAL_PRICES_PAGE_SIZE } from "@/features/metal-prices/constants";
import {
  FALLBACK_FRESHNESS_POLICY,
  policyFromRow,
  type FreshnessPolicy,
} from "@/features/metal-prices/policy";

/** Every column of the table, so a read cannot silently drift from the schema. */
const RATE_COLUMNS = [
  "id",
  "metal_type",
  "purity",
  "price_per_gram",
  "currency",
  "source",
  "source_url",
  "override_active",
  "is_active",
  "verification_status",
  "effective_at",
  "provider_last_update",
  "fetched_at",
  "review_note",
  "reviewed_by",
  "reviewed_at",
  "sync_log_id",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
].join(", ");

const LOG_COLUMNS = [
  "id",
  "provider",
  "status",
  "started_at",
  "completed_at",
  "gold_updated",
  "silver_updated",
  "gold_status",
  "silver_status",
  "gold_candidates",
  "silver_candidates",
  "pending_candidates",
  "rejected_candidates",
  "overrides_preserved",
  "error_message",
  "created_at",
  "created_by",
].join(", ");

export interface MetalPriceSnapshot {
  /** The live rate per metal and purity, keyed `${metal}:${purity}`. */
  published: Map<string, MetalPriceRow>;
  /** Candidates waiting for review, newest fetch first. */
  candidates: MetalPriceRow[];
  /** Rates that have been published before and are not live now, newest first. */
  superseded: MetalPriceRow[];
  /** Rates that have been rejected, newest first. */
  rejected: MetalPriceRow[];
  policy: FreshnessPolicy;
  error: AppError | null;
}

/**
 * Reads the whole table once and divides it in the panel.
 *
 * One query rather than four: the table holds at most a handful of rows per rate
 * (the live one, the candidate, and the history), and splitting it into
 * published/candidate/history queries would mean the three views could be
 * answering from different moments.
 */
export async function getMetalPriceSnapshot(supabase: ServerSupabaseClient): Promise<MetalPriceSnapshot> {
  const policy = await getFreshnessPolicy(supabase);

  const { data, error } = await supabase
    .from("metal_prices")
    .select(RATE_COLUMNS)
    .order("updated_at", { ascending: false })
    .limit(METAL_PRICES_PAGE_SIZE);

  if (error) {
    return {
      published: new Map(),
      candidates: [],
      superseded: [],
      rejected: [],
      policy: policy.value,
      error: toAppError(error),
    };
  }

  // The projection is built from a constant rather than a string literal, so
  // supabase-js cannot infer the row shape; the columns are listed above and the
  // cast is the boundary where that is re-asserted.
  const rows = (data ?? []) as unknown as MetalPriceRow[];

  return {
    published: new Map(
      rows.filter((row) => row.is_active).map((row) => [`${row.metal_type}:${row.purity}`, row] as const),
    ),
    candidates: rows.filter((row) => !row.is_active && row.verification_status === "pending"),
    superseded: rows.filter((row) => !row.is_active && row.verification_status === "verified"),
    rejected: rows.filter((row) => row.verification_status === "rejected"),
    policy: policy.value,
    error: policy.error,
  };
}

/**
 * The freshness policy, from the database.
 *
 * Read rather than duplicated: `publish_metal_price_rate()` refuses a stale
 * candidate without an acknowledgement, and a panel with its own threshold could
 * disagree with the database about a specific price.
 */
export async function getFreshnessPolicy(
  supabase: ServerSupabaseClient,
): Promise<{ value: FreshnessPolicy; error: AppError | null }> {
  const { data, error } = await supabase.rpc("metal_price_freshness_policy");

  if (error) {
    // A missing function means the migration has not been applied. The panel
    // falls back to the documented defaults so it can still describe the state of
    // the rates and say what is wrong.
    return { value: FALLBACK_FRESHNESS_POLICY, error: toAppError(error) };
  }

  const row = Array.isArray(data) ? data[0] : data;
  return { value: policyFromRow(row ?? null), error: null };
}

export interface SyncHistoryResult {
  logs: MetalPriceSyncLogRow[];
  error: AppError | null;
}

/** The most recent synchronization attempts, newest first. */
export async function listSyncLogs(
  supabase: ServerSupabaseClient,
  limit = 8,
): Promise<SyncHistoryResult> {
  const { data, error } = await supabase
    .from("metal_price_sync_logs")
    .select(LOG_COLUMNS)
    .order("started_at", { ascending: false })
    .limit(limit);

  if (error) return { logs: [], error: toAppError(error) };
  return { logs: (data ?? []) as unknown as MetalPriceSyncLogRow[], error: null };
}

/** Finds one rate by id, for the actions that need to describe what they changed. */
export async function getRateById(
  supabase: ServerSupabaseClient,
  id: string,
): Promise<{ rate: MetalPriceRow | null; error: AppError | null }> {
  const { data, error } = await supabase.from("metal_prices").select(RATE_COLUMNS).eq("id", id).maybeSingle();

  if (error) return { rate: null, error: toAppError(error) };
  return { rate: (data as unknown as MetalPriceRow | null) ?? null, error: null };
}

/** Administrator display names for a set of ids, for the review trail. */
export async function getAdminLabels(
  supabase: ServerSupabaseClient,
  ids: string[],
): Promise<Map<string, string>> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return new Map();

  const { data } = await supabase.from("admin_users").select("id, email, full_name").in("id", unique);

  return new Map((data ?? []).map((row) => [row.id, row.full_name?.trim() || row.email] as const));
}

/** True when a rate is currently published with an administrator override behind it. */
export function isLiveOverride(rate: MetalPriceRow | undefined | null): boolean {
  return Boolean(rate && rate.is_active && rate.override_active);
}

export function rateIdentity(metal: MetalType, purity: MetalPurity): string {
  return `${metal}:${purity}`;
}
