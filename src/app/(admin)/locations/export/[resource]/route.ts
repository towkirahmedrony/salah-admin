import { getAdminSession } from "@/lib/auth/session";
import { getServerSupabase } from "@/lib/supabase/server";
import { roleCan } from "@/lib/permissions/permissions";
import { isLocationResourceKey, LOCATION_RESOURCES } from "@/features/locations/definitions";
import { getLocationTree, nodeLabel } from "@/features/locations/queries";
import { UTF8_BOM, csvFilename, toCsv } from "@/lib/utils/csv";
import { readEnum, readString } from "@/lib/utils/search-params";
import type { VerificationStatus } from "@/lib/types/database";

export const dynamic = "force-dynamic";

/**
 * Bounds the export so a runaway table cannot exhaust memory. The full dataset is
 * 579 official records plus localities; anything past this cap is reported to the
 * operator rather than silently dropped.
 */
const EXPORT_LIMIT = 10_000;

/**
 * CSV export for one location level.
 *
 * Export is what this version provides instead of bulk import: an operator can
 * pull the dataset, review it off-line, and hand it back as a reviewable change.
 * The exported columns are the reviewable facts — never internal ids, which would
 * invite an importer to depend on them.
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ resource: string }> },
): Promise<Response> {
  const session = await getAdminSession();

  if (session.kind !== "authenticated" || !roleCan(session.admin.role, "manage_locations")) {
    return new Response("Not authorised.", { status: 403 });
  }

  const { resource } = await context.params;
  if (!isLocationResourceKey(resource)) {
    return new Response("Unknown resource.", { status: 404 });
  }

  const supabase = await getServerSupabase();
  if (!supabase) return new Response("Database not configured.", { status: 503 });

  const url = new URL(request.url);
  const params: Record<string, string> = {};
  for (const [key, value] of url.searchParams.entries()) params[key] = value;

  const search = readString(params, "q").slice(0, 120).replace(/[,()"'\\%]/g, " ").trim();
  const active = readEnum(params, "active", ["all", "active", "inactive"] as const, "all") || "all";
  const parentId = readString(params, "parent");
  const thanaId = readString(params, "thana");
  const verification = readEnum(
    params,
    "verification",
    ["unverified", "verified", "rejected"] as const,
    "",
  ) as VerificationStatus | "";

  const tree = await getLocationTree(supabase);

  const columns = [
    { key: "code", header: "code", value: (row: ExportRow) => row.code },
    { key: "name_en", header: "name_en", value: (row: ExportRow) => row.name_en },
    { key: "name_bn", header: "name_bn", value: (row: ExportRow) => row.name_bn },
    { key: "parent", header: "parent", value: (row: ExportRow) => row.parent },
    { key: "latitude", header: "latitude", value: (row: ExportRow) => row.latitude },
    { key: "longitude", header: "longitude", value: (row: ExportRow) => row.longitude },
    { key: "alternative_names", header: "alternative_names", value: (row: ExportRow) => row.alternative_names },
    { key: "verification_status", header: "verification_status", value: (row: ExportRow) => row.verification_status },
    { key: "source_name", header: "source_name", value: (row: ExportRow) => row.source_name },
    { key: "source_url", header: "source_url", value: (row: ExportRow) => row.source_url },
    { key: "is_active", header: "is_active", value: (row: ExportRow) => row.is_active },
    { key: "updated_at", header: "updated_at", value: (row: ExportRow) => row.updated_at },
  ];

  let rows: ExportRow[] = [];
  let truncated = false;

  if (resource === "divisions") {
    let query = supabase
      .from("divisions")
      .select("code, name_en, name_bn, is_active, updated_at")
      .limit(EXPORT_LIMIT);
    if (search) query = query.or(`name_en.ilike.%${search}%,name_bn.ilike.%${search}%,code.ilike.%${search}%`);
    if (active !== "all") query = query.eq("is_active", active === "active");

    const { data, error } = await query.order("name_en");
    if (error) return new Response("Export failed.", { status: 500 });

    rows = (data ?? []).map((row) => ({
      ...blankExportRow(),
      code: row.code,
      name_en: row.name_en,
      name_bn: row.name_bn,
      parent: "",
      is_active: row.is_active,
      updated_at: row.updated_at,
    }));
  } else if (resource === "districts") {
    let query = supabase
      .from("districts")
      .select("division_id, code, name_en, name_bn, is_active, updated_at")
      .limit(EXPORT_LIMIT);
    if (search) query = query.or(`name_en.ilike.%${search}%,name_bn.ilike.%${search}%,code.ilike.%${search}%`);
    if (active !== "all") query = query.eq("is_active", active === "active");
    if (parentId) query = query.eq("division_id", parentId);

    const { data, error } = await query.order("name_en");
    if (error) return new Response("Export failed.", { status: 500 });

    rows = (data ?? []).map((row) => ({
      ...blankExportRow(),
      code: row.code,
      name_en: row.name_en,
      name_bn: row.name_bn,
      parent: tree.divisionsById.get(row.division_id)?.name_en ?? "",
      is_active: row.is_active,
      updated_at: row.updated_at,
    }));
  } else if (resource === "thanas") {
    let query = supabase
      .from("thanas")
      .select("district_id, code, name_en, name_bn, latitude, longitude, is_active, updated_at")
      .limit(EXPORT_LIMIT);
    if (search) query = query.or(`name_en.ilike.%${search}%,name_bn.ilike.%${search}%,code.ilike.%${search}%`);
    if (active !== "all") query = query.eq("is_active", active === "active");
    if (parentId) query = query.eq("district_id", parentId);

    const { data, error } = await query.order("name_en");
    if (error) return new Response("Export failed.", { status: 500 });

    rows = (data ?? []).map((row) => ({
      ...blankExportRow(),
      code: row.code,
      name_en: row.name_en,
      name_bn: row.name_bn,
      parent: tree.districtsById.get(row.district_id)?.name_en ?? "",
      latitude: row.latitude === null ? "" : String(row.latitude),
      longitude: row.longitude === null ? "" : String(row.longitude),
      is_active: row.is_active,
      updated_at: row.updated_at,
    }));
  } else {
    let query = supabase
      .from("localities")
      .select(
        "thana_id, district_id, code, name_en, name_bn, alternative_names, latitude, longitude, source_name, source_url, verification_status, is_active, updated_at",
      )
      .limit(EXPORT_LIMIT + 1);

    if (search) query = query.or(`name_en.ilike.%${search}%,name_bn.ilike.%${search}%,code.ilike.%${search}%`);
    if (active !== "all") query = query.eq("is_active", active === "active");
    if (verification) query = query.eq("verification_status", verification);
    if (thanaId) query = query.eq("thana_id", thanaId);
    else if (parentId) query = query.eq("district_id", parentId);

    const { data, error } = await query.order("name_en");
    if (error) return new Response("Export failed.", { status: 500 });

    const limited = (data ?? []).slice(0, EXPORT_LIMIT);
    truncated = (data ?? []).length > EXPORT_LIMIT;

    rows = limited.map((row) => ({
      ...blankExportRow(),
      code: row.code ?? "",
      name_en: row.name_en,
      name_bn: row.name_bn,
      parent: row.thana_id
        ? nodeLabel(tree.thanasById.get(row.thana_id))
        : row.district_id
          ? nodeLabel(tree.districtsById.get(row.district_id))
          : "",
      latitude: row.latitude === null ? "" : String(row.latitude),
      longitude: row.longitude === null ? "" : String(row.longitude),
      alternative_names: row.alternative_names.join(" | "),
      verification_status: row.verification_status,
      source_name: row.source_name ?? "",
      source_url: row.source_url ?? "",
      is_active: row.is_active,
      updated_at: row.updated_at,
    }));
  }

  const csv = toCsv(rows, columns);

  return new Response(`${UTF8_BOM}${csv}`, {
    status: 200,
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${csvFilename(`salah-${LOCATION_RESOURCES[resource].key}`)}"`,
      // Never let a proxy or the browser reuse one operator's export.
      "Cache-Control": "no-store, max-age=0",
      ...(truncated ? { "X-Export-Truncated": "true" } : {}),
    },
  });
}

interface ExportRow {
  code: string | null;
  name_en: string;
  name_bn: string | null;
  parent: string | null;
  latitude: string | null;
  longitude: string | null;
  alternative_names: string | null;
  verification_status: string | null;
  source_name: string | null;
  source_url: string | null;
  is_active: boolean;
  updated_at: string;
}

function blankExportRow(): ExportRow {
  return {
    code: null,
    name_en: "",
    name_bn: null,
    parent: null,
    latitude: null,
    longitude: null,
    alternative_names: null,
    verification_status: null,
    source_name: null,
    source_url: null,
    is_active: true,
    updated_at: "",
  };
}
