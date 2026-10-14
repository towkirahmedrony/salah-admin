/**
 * Not marked `server-only`, on purpose.
 *
 * This module is a query builder: it receives the Supabase client as an argument
 * and never reads cookies, headers or any secret itself, and its only contact
 * with server code is a type-only import that is erased at compile time. Client
 * components legitimately need `nodeLabel` and the tree types from here, and the
 * `server-only` marker would break that boundary rather than protect it — the
 * marker that matters sits on `lib/supabase/server.ts`, where the cookie access
 * actually happens.
 */
import { cache } from "react";

import type { ServerSupabaseClient } from "@/lib/supabase/server";
import { toAppError, type AppError } from "@/lib/errors";
import type {
  DistrictRow,
  DivisionRow,
  LocalityRow,
  ThanaRow,
  VerificationStatus,
} from "@/lib/types/database";
import {
  LOCATION_RESOURCES,
  type LocationResourceKey,
} from "@/features/locations/definitions";
import { rangeFor, totalPagesFor, PAGE_SIZE } from "@/lib/utils/search-params";

/**
 * The whole location hierarchy in memory.
 *
 * 8 divisions, 64 districts and ~507 thanas is a few hundred small rows, and
 * loading them once per request means every cascading select, filter dropdown
 * and parent label is resolved without an N+1 pattern or an embedded join. The
 * `cache()` wrapper makes it one query per request regardless of how many
 * components ask for it.
 */
export interface LocationTreeNode {
  id: string;
  code: string;
  name_en: string;
  name_bn: string | null;
  is_active: boolean;
}

export interface LocationTreeDistrict extends LocationTreeNode {
  division_id: string;
}

export interface LocationTreeThana extends LocationTreeNode {
  district_id: string;
}

export interface LocationTree {
  divisions: LocationTreeNode[];
  districts: LocationTreeDistrict[];
  thanas: LocationTreeThana[];
  divisionsById: Map<string, LocationTreeNode>;
  districtsById: Map<string, LocationTreeDistrict>;
  thanasById: Map<string, LocationTreeThana>;
  error: AppError | null;
}

const EMPTY_TREE: LocationTree = {
  divisions: [],
  districts: [],
  thanas: [],
  divisionsById: new Map(),
  districtsById: new Map(),
  thanasById: new Map(),
  error: null,
};

export const getLocationTree = cache(
  async (supabase: ServerSupabaseClient): Promise<LocationTree> => {
    const [divisionsResult, districtsResult, thanasResult] = await Promise.all([
      supabase.from("divisions").select("id, code, name_en, name_bn, is_active").order("name_en"),
      supabase
        .from("districts")
        .select("id, division_id, code, name_en, name_bn, is_active")
        .order("name_en"),
      supabase
        .from("thanas")
        .select("id, district_id, code, name_en, name_bn, is_active")
        .order("name_en"),
    ]);

    const firstError =
      divisionsResult.error ?? districtsResult.error ?? thanasResult.error ?? null;

    if (firstError) {
      return { ...EMPTY_TREE, error: toAppError(firstError) };
    }

    const divisions = (divisionsResult.data ?? []) as DivisionRow[];
    const districts = (districtsResult.data ?? []) as DistrictRow[];
    const thanas = (thanasResult.data ?? []) as ThanaRow[];

    return {
      divisions: divisions.map(toNode),
      districts: districts.map((row) => ({ ...toNode(row), division_id: row.division_id })),
      thanas: thanas.map((row) => ({ ...toNode(row), district_id: row.district_id })),
      divisionsById: new Map(divisions.map((row) => [row.id, toNode(row)])),
      districtsById: new Map(
        districts.map((row) => [row.id, { ...toNode(row), division_id: row.division_id }]),
      ),
      thanasById: new Map(
        thanas.map((row) => [row.id, { ...toNode(row), district_id: row.district_id }]),
      ),
      error: null,
    };
  },
);

function toNode(row: DivisionRow | DistrictRow | ThanaRow): LocationTreeNode {
  return {
    id: row.id,
    code: row.code,
    name_en: row.name_en,
    name_bn: row.name_bn,
    is_active: row.is_active,
  };
}

/** Display label: "English — Bangla", falling back to whichever exists. */
export function nodeLabel(node: LocationTreeNode | undefined): string {
  if (!node) return "—";
  if (node.name_bn) return `${node.name_en} — ${node.name_bn}`;
  return node.name_en;
}

// --- List --------------------------------------------------------------------

export interface LocationListFilters {
  search: string;
  isActive: "all" | "active" | "inactive";
  /** Division for districts, district for thanas and localities. */
  parentId: string;
  /** Thana filter, localities only. Takes precedence over `parentId`. */
  thanaId: string;
  verification: VerificationStatus | "";
  page: number;
}

export interface LocationListRow {
  id: string;
  code: string | null;
  name_en: string;
  name_bn: string | null;
  is_active: boolean;
  parentLabel: string | null;
  /** Level-specific facts rendered in the table, already formatted. */
  facts: Array<{ label: string; value: string; tone?: "brand" | "amber" | "red" | "neutral" }>;
  createdAt: string;
  updatedAt: string;
  /** Raw values, used to seed the edit form. */
  values: Record<string, string | boolean | null>;
}

export interface LocationListResult {
  rows: LocationListRow[];
  total: number;
  page: number;
  totalPages: number;
  error: AppError | null;
}

/**
 * Escapes a term for use inside a PostgREST `or(...)` filter.
 *
 * A comma, parenthesis or quote in the search box would otherwise change the
 * meaning of the filter expression rather than being searched for.
 */
function sanitiseSearchTerm(term: string): string {
  return term.replace(/[,()"'\\%]/g, " ").trim();
}

export async function listLocationResource(
  supabase: ServerSupabaseClient,
  tree: LocationTree,
  resource: LocationResourceKey,
  filters: LocationListFilters,
): Promise<LocationListResult> {
  const definition = LOCATION_RESOURCES[resource];
  const { from, to } = rangeFor(filters.page, PAGE_SIZE);

  const term = sanitiseSearchTerm(filters.search);

  if (resource === "divisions") {
    let query = supabase
      .from("divisions")
      .select("id, code, name_en, name_bn, is_active, created_at, updated_at", { count: "exact" });

    if (term) {
      query = query.or(
        `name_en.ilike.%${term}%,name_bn.ilike.%${term}%,code.ilike.%${term}%`,
      );
    }
    if (filters.isActive !== "all") {
      query = query.eq("is_active", filters.isActive === "active");
    }

    const { data, error, count } = await query
      .order(definition.orderColumn, { ascending: definition.orderAscending })
      .order("code", { ascending: true })
      .range(from, to);

    if (error) return failedList(filters, error);

    return {
      rows: (data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        name_en: row.name_en,
        name_bn: row.name_bn,
        is_active: row.is_active,
        // A division has no parent, so this column reports what it contains —
        // the number an operator actually needs before deactivating one.
        parentLabel: `${tree.districts.filter((district) => district.division_id === row.id).length} districts`,
        facts: [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        values: rowToValues(row),
      })),
      total: count ?? 0,
      page: filters.page,
      totalPages: totalPagesFor(count ?? 0),
      error: null,
    };
  }

  if (resource === "districts") {
    let query = supabase
      .from("districts")
      .select("id, division_id, code, name_en, name_bn, is_active, created_at, updated_at", {
        count: "exact",
      });

    if (term) {
      query = query.or(
        `name_en.ilike.%${term}%,name_bn.ilike.%${term}%,code.ilike.%${term}%`,
      );
    }
    if (filters.isActive !== "all") {
      query = query.eq("is_active", filters.isActive === "active");
    }
    if (filters.parentId) {
      query = query.eq("division_id", filters.parentId);
    }

    const { data, error, count } = await query
      .order(definition.orderColumn, { ascending: definition.orderAscending })
      .order("code", { ascending: true })
      .range(from, to);

    if (error) return failedList(filters, error);

    return {
      rows: (data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        name_en: row.name_en,
        name_bn: row.name_bn,
        is_active: row.is_active,
        parentLabel: `${nodeLabel(tree.divisionsById.get(row.division_id))} · ${
          tree.thanas.filter((thana) => thana.district_id === row.id).length
        } thanas`,
        facts: [],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        values: rowToValues(row),
      })),
      total: count ?? 0,
      page: filters.page,
      totalPages: totalPagesFor(count ?? 0),
      error: null,
    };
  }

  if (resource === "thanas") {
    let query = supabase
      .from("thanas")
      .select(
        "id, district_id, code, name_en, name_bn, latitude, longitude, is_active, created_at, updated_at",
        { count: "exact" },
      );

    if (term) {
      query = query.or(
        `name_en.ilike.%${term}%,name_bn.ilike.%${term}%,code.ilike.%${term}%`,
      );
    }
    if (filters.isActive !== "all") {
      query = query.eq("is_active", filters.isActive === "active");
    }
    if (filters.parentId) {
      query = query.eq("district_id", filters.parentId);
    }

    const { data, error, count } = await query
      .order(definition.orderColumn, { ascending: definition.orderAscending })
      .order("code", { ascending: true })
      .range(from, to);

    if (error) return failedList(filters, error);

    return {
      rows: (data ?? []).map((row) => ({
        id: row.id,
        code: row.code,
        name_en: row.name_en,
        name_bn: row.name_bn,
        is_active: row.is_active,
        parentLabel: nodeLabel(tree.districtsById.get(row.district_id)),
        facts:
          row.latitude === null || row.longitude === null
            ? [{ label: "Coordinates", value: "Not recorded", tone: "amber" as const }]
            : [
                {
                  label: "Coordinates",
                  value: `${Number(row.latitude).toFixed(5)}, ${Number(row.longitude).toFixed(5)}`,
                },
              ],
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        values: rowToValues(row),
      })),
      total: count ?? 0,
      page: filters.page,
      totalPages: totalPagesFor(count ?? 0),
      error: null,
    };
  }

  // localities
  let query = supabase
    .from("localities")
    .select(
      "id, thana_id, district_id, code, name_en, name_bn, alternative_names, latitude, longitude, source_name, source_url, verification_status, notes, is_active, created_at, updated_at",
      { count: "exact" },
    );

  if (term) {
    query = query.or(`name_en.ilike.%${term}%,name_bn.ilike.%${term}%,code.ilike.%${term}%`);
  }
  if (filters.isActive !== "all") {
    query = query.eq("is_active", filters.isActive === "active");
  }
  if (filters.verification) {
    query = query.eq("verification_status", filters.verification);
  }
  // A thana filter is narrower than a district filter, and a locality's district
  // and thana are separate columns — so the thana wins when both are supplied
  // rather than the two being treated as interchangeable.
  if (filters.thanaId) {
    query = query.eq("thana_id", filters.thanaId);
  } else if (filters.parentId) {
    query = query.eq("district_id", filters.parentId);
  }

  const { data, error, count } = await query
    .order(definition.orderColumn, { ascending: definition.orderAscending })
    .range(from, to);

  if (error) return failedList(filters, error);

  return {
    rows: (data ?? []).map((row) => {
      const locality = row as LocalityRow;

      const parent = locality.thana_id
        ? `Thana: ${nodeLabel(tree.thanasById.get(locality.thana_id))}`
        : locality.district_id
          ? `District: ${nodeLabel(tree.districtsById.get(locality.district_id))}`
          : null;

      const facts: LocationListRow["facts"] = [
        {
          label: "Verification",
          value:
            locality.verification_status === "verified"
              ? "Verified"
              : locality.verification_status === "rejected"
                ? "Rejected"
                : "Unverified",
          tone:
            locality.verification_status === "verified"
              ? ("brand" as const)
              : locality.verification_status === "rejected"
                ? ("red" as const)
                : ("neutral" as const),
        },
      ];

      if (locality.source_name) {
        facts.push({ label: "Source", value: locality.source_name });
      }

      return {
        id: locality.id,
        code: locality.code,
        name_en: locality.name_en,
        name_bn: locality.name_bn,
        is_active: locality.is_active,
        parentLabel: parent,
        facts,
        createdAt: locality.created_at,
        updatedAt: locality.updated_at,
        values: {
          ...rowToValues(locality),
          alternative_names: locality.alternative_names.join(", "),
        },
      };
    }),
    total: count ?? 0,
    page: filters.page,
    totalPages: totalPagesFor(count ?? 0),
    error: null,
  };
}

function failedList(filters: LocationListFilters, error: unknown): LocationListResult {
  return {
    rows: [],
    total: 0,
    page: filters.page,
    totalPages: 1,
    error: toAppError(error),
  };
}

function rowToValues(row: Record<string, unknown>): Record<string, string | boolean | null> {
  const values: Record<string, string | boolean | null> = {};

  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) {
      values[key] = null;
    } else if (typeof value === "boolean") {
      values[key] = value;
    } else if (typeof value === "number") {
      values[key] = String(value);
    } else if (Array.isArray(value)) {
      values[key] = value.join(", ");
    } else {
      values[key] = String(value);
    }
  }

  return values;
}

/**
 * Loads one record for the edit form, so a stale row in the table cannot be used
 * to overwrite a newer value.
 */
export async function getLocationResourceRow(
  supabase: ServerSupabaseClient,
  resource: LocationResourceKey,
  id: string,
): Promise<{ values: Record<string, string | boolean | null> | null; error: AppError | null }> {
  const selectColumns: Record<LocationResourceKey, string> = {
    divisions: "id, code, name_en, name_bn, is_active",
    districts: "id, division_id, code, name_en, name_bn, is_active",
    thanas: "id, district_id, code, name_en, name_bn, latitude, longitude, is_active",
    localities:
      "id, thana_id, district_id, code, name_en, name_bn, alternative_names, latitude, longitude, source_name, source_url, verification_status, notes, is_active",
  };

  const table = LOCATION_RESOURCES[resource].table;

  const response =
    table === "divisions"
      ? await supabase.from("divisions").select(selectColumns.divisions).eq("id", id).maybeSingle()
      : table === "districts"
        ? await supabase.from("districts").select(selectColumns.districts).eq("id", id).maybeSingle()
        : table === "thanas"
          ? await supabase.from("thanas").select(selectColumns.thanas).eq("id", id).maybeSingle()
          : await supabase
              .from("localities")
              .select(selectColumns.localities)
              .eq("id", id)
              .maybeSingle();

  if (response.error) return { values: null, error: toAppError(response.error) };
  if (!response.data) return { values: null, error: null };

  const values = rowToValues(response.data as unknown as Record<string, unknown>);
  return { values, error: null };
}
