/**
 * Not marked `server-only`, on purpose — same reasoning as
 * `features/locations/queries.ts`. This module receives the Supabase client as an
 * argument and never reads cookies or headers itself, and its only contact with
 * server code is a type-only import that is erased at compile time.
 */
import type { ServerSupabaseClient } from "@/lib/supabase/server";
import { toAppError, type AppError } from "@/lib/errors";
import type {
  PrayerCalculationConfigRow,
  PrayerCalculationMethod,
  PrayerConfigScope,
  RecordStatus,
} from "@/lib/types/database";
import {
  SCOPE_TARGET_COLUMN,
  SCOPE_SHORT_LABELS,
  PRAYER_CALCULATION_METHOD_LABELS,
} from "@/lib/validation/prayer-config";
import { getLocationTree, nodeLabel, type LocationTree } from "@/features/locations/queries";
import { PAGE_SIZE, rangeFor, totalPagesFor } from "@/lib/utils/search-params";

/** Columns every read of this table uses, so a select cannot silently drift. */
const CONFIG_COLUMNS = [
  "id",
  "name",
  "scope",
  "division_id",
  "district_id",
  "thana_id",
  "schema_version",
  "engine_key",
  "engine_version",
  "calculation_method",
  "fajr_angle",
  "isha_angle",
  "isha_interval_minutes",
  "asr_madhhab",
  "high_latitude_rule",
  "adjust_fajr",
  "adjust_dhuhr",
  "adjust_asr",
  "adjust_maghrib",
  "adjust_isha",
  "timezone",
  "effective_from",
  "effective_to",
  "source_name",
  "source_url",
  "notes",
  "status",
  "version",
  "reviewed_by",
  "reviewed_at",
  "published_by",
  "published_at",
  "created_at",
  "created_by",
  "updated_at",
  "updated_by",
].join(", ");

/**
 * The location a configuration targets, resolved to a display label and the
 * p-code the Android app uses.
 *
 * The p-code is shown because it is the shared key between this panel and the
 * app's bundled dataset (`BD30`, `BD2015`, `BD20153012`) — an operator comparing
 * the two needs to see it, not a UUID.
 */
export interface ScopeTargetLabel {
  label: string;
  code: string | null;
}

export function scopeTargetLabel(
  tree: LocationTree,
  config: Pick<PrayerCalculationConfigRow, "scope" | "division_id" | "district_id" | "thana_id">,
): ScopeTargetLabel {
  if (config.scope === "global") return { label: "All locations", code: "BD" };

  if (config.scope === "division" && config.division_id) {
    const node = tree.divisionsById.get(config.division_id);
    return { label: nodeLabel(node), code: node?.code ?? null };
  }

  if (config.scope === "district" && config.district_id) {
    const node = tree.districtsById.get(config.district_id);
    return { label: nodeLabel(node), code: node?.code ?? null };
  }

  if (config.scope === "thana" && config.thana_id) {
    const node = tree.thanasById.get(config.thana_id);
    return { label: nodeLabel(node), code: node?.code ?? null };
  }

  // The row claims a scope but has no target, or its target no longer exists. Say
  // so rather than rendering an empty cell that reads like a bug.
  return { label: "Target not recorded", code: null };
}

// --- Administrator labels ----------------------------------------------------

/**
 * Email/full name for a set of administrator ids.
 *
 * `admin_users` is readable by any active administrator, so this is a plain read
 * rather than a privileged one. A missing id renders as "—" instead of a UUID.
 */
export async function getAdminLabels(
  supabase: ServerSupabaseClient,
  ids: string[],
): Promise<{ labels: Map<string, string>; error: AppError | null }> {
  const unique = [...new Set(ids.filter(Boolean))];
  if (unique.length === 0) return { labels: new Map(), error: null };

  const { data, error } = await supabase
    .from("admin_users")
    .select("id, email, full_name")
    .in("id", unique);

  if (error) return { labels: new Map(), error: toAppError(error) };

  return {
    labels: new Map(
      (data ?? []).map((row) => [row.id, row.full_name?.trim() || row.email] as const),
    ),
    error: null,
  };
}

// --- List --------------------------------------------------------------------

export interface PrayerConfigListFilters {
  search: string;
  scope: PrayerConfigScope | "";
  status: RecordStatus | "";
  page: number;
}

export interface PrayerConfigListRow {
  id: string;
  name: string;
  scope: PrayerConfigScope;
  scopeLabel: string;
  targetLabel: string;
  targetCode: string | null;
  engineLabel: string;
  methodLabel: string | null;
  version: number;
  status: RecordStatus;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  updatedAt: string;
  updatedByLabel: string | null;
  publishedByLabel: string | null;
}

export interface PrayerConfigListResult {
  rows: PrayerConfigListRow[];
  total: number;
  page: number;
  totalPages: number;
  error: AppError | null;
}

/** Counts per status for the current filter, used by the summary row. */
export interface PrayerConfigStatusCounts {
  draft: number;
  published: number;
  archived: number;
  error: AppError | null;
}

export async function countPrayerConfigsByStatus(
  supabase: ServerSupabaseClient,
): Promise<PrayerConfigStatusCounts> {
  const statuses: RecordStatus[] = ["draft", "published", "archived"];

  const results = await Promise.all(
    statuses.map((status) =>
      supabase
        .from("prayer_calculation_configs")
        .select("*", { count: "exact", head: true })
        .eq("status", status),
    ),
  );

  const failed = results.find((result) => result.error);
  if (failed?.error) {
    return { draft: 0, published: 0, archived: 0, error: toAppError(failed.error) };
  }

  return {
    draft: results[0]!.count ?? 0,
    published: results[1]!.count ?? 0,
    archived: results[2]!.count ?? 0,
    error: null,
  };
}

/** Escapes a term for a PostgREST `or(...)` filter, as `locations/queries.ts` does. */
function sanitiseSearchTerm(term: string): string {
  return term.replace(/[,()"'\\%]/g, " ").trim();
}

export async function listPrayerConfigs(
  supabase: ServerSupabaseClient,
  tree: LocationTree,
  filters: PrayerConfigListFilters,
): Promise<PrayerConfigListResult> {
  const { from, to } = rangeFor(filters.page, PAGE_SIZE);
  const term = sanitiseSearchTerm(filters.search);

  let query = supabase
    .from("prayer_calculation_configs")
    .select(CONFIG_COLUMNS, { count: "exact" });

  if (term) {
    query = query.or(`name.ilike.%${term}%,source_name.ilike.%${term}%,notes.ilike.%${term}%`);
  }
  if (filters.scope) query = query.eq("scope", filters.scope);
  if (filters.status) query = query.eq("status", filters.status);

  const { data, error, count } = await query
    // Published first, then draft, then archived; newest first within each.
    .order("updated_at", { ascending: false })
    .range(from, to);

  if (error) {
    return {
      rows: [],
      total: 0,
      page: filters.page,
      totalPages: 1,
      error: toAppError(error),
    };
  }

  const rows = (data ?? []) as unknown as PrayerCalculationConfigRow[];

  const adminLabels = await getAdminLabels(supabase, [
    ...rows.map((row) => row.updated_by ?? ""),
    ...rows.map((row) => row.published_by ?? ""),
  ]);

  return {
    rows: rows.map((row) => {
      const target = scopeTargetLabel(tree, row);
      return {
        id: row.id,
        name: row.name,
        scope: row.scope,
        scopeLabel: SCOPE_SHORT_LABELS[row.scope],
        targetLabel: target.label,
        targetCode: target.code,
        engineLabel: `${row.engine_key} ${row.engine_version}`,
        methodLabel: row.calculation_method
          ? PRAYER_CALCULATION_METHOD_LABELS[row.calculation_method]
          : null,
        version: row.version,
        status: row.status,
        effectiveFrom: row.effective_from,
        effectiveTo: row.effective_to,
        updatedAt: row.updated_at,
        updatedByLabel: row.updated_by ? (adminLabels.labels.get(row.updated_by) ?? null) : null,
        publishedByLabel: row.published_by
          ? (adminLabels.labels.get(row.published_by) ?? null)
          : null,
      };
    }),
    total: count ?? 0,
    page: filters.page,
    totalPages: totalPagesFor(count ?? 0),
    error: null,
  };
}

// --- Single row --------------------------------------------------------------

export async function getPrayerConfig(
  supabase: ServerSupabaseClient,
  id: string,
): Promise<{ config: PrayerCalculationConfigRow | null; error: AppError | null }> {
  const { data, error } = await supabase
    .from("prayer_calculation_configs")
    .select(CONFIG_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (error) return { config: null, error: toAppError(error) };
  if (!data) return { config: null, error: null };
  return { config: data as unknown as PrayerCalculationConfigRow, error: null };
}

// --- Published sibling and history -------------------------------------------

export interface PrayerConfigHistory {
  /** The configuration currently live for this scope target, if any. */
  published: PrayerCalculationConfigRow | null;
  /** Every other version sharing this scope target, newest first. */
  versions: PrayerCalculationConfigRow[];
  error: AppError | null;
}

/**
 * The live configuration for the same scope target, plus the version history.
 *
 * "Same scope target" is the only meaningful grouping: a thana override and the
 * global row are different targets, so a version of one is not a version of the
 * other. Newest version first, so the list reads as a history.
 */
export async function getPrayerConfigHistory(
  supabase: ServerSupabaseClient,
  config: PrayerCalculationConfigRow,
): Promise<PrayerConfigHistory> {
  let query = supabase
    .from("prayer_calculation_configs")
    .select(CONFIG_COLUMNS)
    .eq("scope", config.scope)
    .neq("id", config.id);

  // `is null` for global (all three target columns are null), otherwise the exact
  // target. `is not distinct from` is not expressible through PostgREST, so the
  // three columns are matched explicitly.
  for (const column of ["division_id", "district_id", "thana_id"] as const) {
    const value = config[column];
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }

  const { data, error } = await query.order("version", { ascending: false });

  if (error) return { published: null, versions: [], error: toAppError(error) };

  const rows = (data ?? []) as unknown as PrayerCalculationConfigRow[];

  return {
    published: rows.find((row) => row.status === "published") ?? null,
    versions: rows,
    error: null,
  };
}

/** The configuration that replaces this one, if this row is the live one. */
export async function getPublishedSibling(
  supabase: ServerSupabaseClient,
  config: Pick<
    PrayerCalculationConfigRow,
    "id" | "scope" | "division_id" | "district_id" | "thana_id"
  >,
): Promise<{ config: PrayerCalculationConfigRow | null; error: AppError | null }> {
  let query = supabase
    .from("prayer_calculation_configs")
    .select(CONFIG_COLUMNS)
    .eq("scope", config.scope)
    .eq("status", "published")
    .neq("id", config.id);

  for (const column of ["division_id", "district_id", "thana_id"] as const) {
    const value = config[column];
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }

  const { data, error } = await query.maybeSingle();

  if (error) return { config: null, error: toAppError(error) };
  return { config: (data as unknown as PrayerCalculationConfigRow) ?? null, error: null };
}

// --- Effective configuration -------------------------------------------------

export interface ResolvedPrayerConfig {
  id: string;
  name: string;
  scope: PrayerConfigScope;
  matchedBy: string;
  calculationMethod: PrayerCalculationMethod | null;
  engineKey: string;
  engineVersion: string;
  version: number;
  effectiveFrom: string | null;
  effectiveTo: string | null;
  publishedAt: string | null;
}

/**
 * Asks the database which configuration wins for one location on one date.
 *
 * Delegated to `public.resolve_prayer_config()` rather than reimplemented here, so
 * the precedence the operator is shown is the same precedence the SQL rule
 * expresses. A second implementation in TypeScript is exactly the kind of
 * divergence this feature is supposed to prevent.
 */
export async function resolveEffectiveConfig(
  supabase: ServerSupabaseClient,
  input: {
    divisionId?: string | null;
    districtId?: string | null;
    thanaId?: string | null;
    onDate: string;
  },
): Promise<{ resolved: ResolvedPrayerConfig | null; error: AppError | null }> {
  const { data, error } = await supabase.rpc("resolve_prayer_config", {
    p_division_id: input.divisionId ?? null,
    p_district_id: input.districtId ?? null,
    p_thana_id: input.thanaId ?? null,
    p_on_date: input.onDate,
  });

  if (error) return { resolved: null, error: toAppError(error) };

  const row = (data ?? [])[0];
  if (!row) return { resolved: null, error: null };

  return {
    resolved: {
      id: row.id,
      name: row.name,
      scope: row.scope,
      matchedBy: row.matched_by,
      calculationMethod: row.calculation_method,
      engineKey: row.engine_key,
      engineVersion: row.engine_version,
      version: row.version,
      effectiveFrom: row.effective_from,
      effectiveTo: row.effective_to,
      publishedAt: row.published_at,
    },
    error: null,
  };
}

// --- Public contract preview -------------------------------------------------

export interface PublicContractRow {
  id: string;
  name: string;
  scope: PrayerConfigScope;
  scopeCode: string;
  schemaVersion: number;
  calculationMethod: PrayerCalculationMethod;
  version: number;
  publishedAt: string | null;
}

/**
 * Exactly what the Android app's read endpoint currently returns.
 *
 * Calls the same SECURITY DEFINER function `anon` calls, so the panel cannot show a
 * prettier version of the payload than the one the app would actually receive.
 */
export async function getPublicContractRows(
  supabase: ServerSupabaseClient,
): Promise<{ rows: PublicContractRow[]; error: AppError | null }> {
  const { data, error } = await supabase.rpc("public_prayer_configs");

  if (error) return { rows: [], error: toAppError(error) };

  return {
    rows: (data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      scope: row.scope,
      scopeCode: row.scope_code,
      schemaVersion: row.schema_version,
      calculationMethod: row.calculation_method,
      version: row.version,
      publishedAt: row.published_at,
    })),
    error: null,
  };
}

/** The whole tree, re-exported so pages need one import for both. */
export { getLocationTree };
export type { LocationTree };

/** Which target column a scope uses — re-exported for the form component. */
export { SCOPE_TARGET_COLUMN };
