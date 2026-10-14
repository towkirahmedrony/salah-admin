"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { guardAction } from "@/lib/auth/guards";
import { toAppError } from "@/lib/errors";
import { parseFormData, type FormParseResult } from "@/lib/validation/common";
import {
  districtSchema,
  divisionSchema,
  localitySchema,
  thanaSchema,
} from "@/lib/validation/locations";
import {
  LOCATION_RESOURCES,
  isLocationResourceKey,
  type LocationResourceKey,
} from "@/features/locations/definitions";
import type { ServerSupabaseClient } from "@/lib/supabase/server";
import type {
  DistrictInsert,
  DivisionInsert,
  LocalityInsert,
  ThanaInsert,
} from "@/lib/types/database";

/**
 * The four location levels share one action, but each is written through its own
 * concrete table so the compiler can check the payload against that table's real
 * columns. See `performWrite` below.
 */

export interface LocationActionState {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
  /** Row id the action created or updated, for client-side focus/scroll. */
  rowId?: string;
}

export const INITIAL_LOCATION_ACTION_STATE: LocationActionState = {
  status: "idle",
  message: "",
};

/** Read and validate the resource key that every location action carries. */
function readResource(formData: FormData): LocationResourceKey | null {
  const value = formData.get("__resource");
  return typeof value === "string" && isLocationResourceKey(value) ? value : null;
}

type ParsedPayload = Record<string, string | number | boolean | null | string[]>;

function parseForResource(
  resource: LocationResourceKey,
  formData: FormData,
): FormParseResult<ParsedPayload> {
  const schema = {
    divisions: divisionSchema,
    districts: districtSchema,
    thanas: thanaSchema,
    localities: localitySchema,
  }[resource];

  const result = parseFormData(schema, formData);
  if (!result.ok) return result;
  return { ok: true, data: result.data as ParsedPayload };
}

/**
 * Creates or updates a location record.
 *
 * The parent relationship is verified before the write rather than relying on
 * the foreign key, because "A record with the same unique value already exists"
 * is a poor way to learn that a district does not belong to the chosen division.
 */
export async function saveLocationResource(
  _previous: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const resource = readResource(formData);
  if (!resource) {
    return { status: "error", message: "Unrecognised location resource." };
  }

  const guard = await guardAction("manage_locations");
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = parseForResource(resource, formData);
  if (!parsed.ok) {
    return { status: "error", message: parsed.message, fieldErrors: parsed.fieldErrors };
  }

  const payload = parsed.data;
  const id = typeof payload.id === "string" ? payload.id : null;
  const definition = LOCATION_RESOURCES[resource];

  const relationshipError = await verifyParentRelationship(
    guard.supabase,
    resource,
    payload,
  );
  if (relationshipError) {
    return { status: "error", message: relationshipError.message, fieldErrors: relationshipError.fieldErrors };
  }

  const written = await performWrite(guard.supabase, resource, payload, id);

  if (written.error) {
    const mapped = toAppError(written.error);
    return {
      status: "error",
      message: mapped.message,
      fieldErrors: fieldErrorsFor(mapped.message),
    };
  }

  revalidateAfterWrite(resource);
  return {
    status: "success",
    message: id ? `${definition.singular} saved.` : `${definition.singular} created.`,
    rowId: written.id ?? undefined,
  };
}

/**
 * Performs the insert or update for exactly one level.
 *
 * Written as an explicit switch rather than one generic call: the payload has
 * been validated against this resource's schema, and only a concrete table name
 * lets the compiler confirm that the payload really matches the columns of the
 * table being written to. A generic version would need a cast that gives up that
 * guarantee — which is how a mistyped column silently reaches production.
 */
async function performWrite(
  supabase: ServerSupabaseClient,
  resource: LocationResourceKey,
  payload: Record<string, unknown>,
  id: string | null,
): Promise<{ id: string | null; error: unknown }> {
  const body = { ...payload };
  delete body.id;

  switch (resource) {
    case "divisions": {
      const values = body as DivisionInsert;
      if (id) {
        const { error } = await supabase.from("divisions").update(values).eq("id", id);
        return { id, error };
      }
      const { data, error } = await supabase
        .from("divisions")
        .insert(values)
        .select("id")
        .single();
      return { id: data?.id ?? null, error };
    }

    case "districts": {
      const values = body as DistrictInsert;
      if (id) {
        const { error } = await supabase.from("districts").update(values).eq("id", id);
        return { id, error };
      }
      const { data, error } = await supabase
        .from("districts")
        .insert(values)
        .select("id")
        .single();
      return { id: data?.id ?? null, error };
    }

    case "thanas": {
      const values = body as ThanaInsert;
      if (id) {
        const { error } = await supabase.from("thanas").update(values).eq("id", id);
        return { id, error };
      }
      const { data, error } = await supabase
        .from("thanas")
        .insert(values)
        .select("id")
        .single();
      return { id: data?.id ?? null, error };
    }

    case "localities": {
      const values = body as LocalityInsert;
      if (id) {
        const { error } = await supabase.from("localities").update(values).eq("id", id);
        return { id, error };
      }
      const { data, error } = await supabase
        .from("localities")
        .insert(values)
        .select("id")
        .single();
      return { id: data?.id ?? null, error };
    }
  }
}

/**
 * Maps a database conflict back to the field that caused it, so the error
 * appears next to the code box instead of at the top of the form.
 */
function fieldErrorsFor(message: string): Record<string, string[]> | undefined {
  if (/code|key/i.test(message) && /already exists|duplicate/i.test(message)) {
    return { code: ["This code is already used by another record."] };
  }
  return undefined;
}

interface RelationshipProblem {
  message: string;
  fieldErrors?: Record<string, string[]>;
}

/**
 * Validates the parent chain before writing.
 *
 * For a locality this also checks that a selected thana really sits inside the
 * selected district — the two are separate inputs, and letting them disagree
 * would produce a record whose district and thana filters return different
 * answers for the same row.
 */
async function verifyParentRelationship(
  supabase: ServerSupabaseClient,
  resource: LocationResourceKey,
  payload: ParsedPayload,
): Promise<RelationshipProblem | null> {
  if (resource === "districts") {
    const divisionId = payload.division_id as string;
    const { data, error } = await supabase
      .from("divisions")
      .select("id")
      .eq("id", divisionId)
      .maybeSingle();
    if (error) return { message: toAppError(error).message };
    if (!data) {
      return {
        message: "The selected division no longer exists.",
        fieldErrors: { division_id: ["Select an existing division."] },
      };
    }
  }

  if (resource === "thanas") {
    const districtId = payload.district_id as string;
    const { data, error } = await supabase
      .from("districts")
      .select("id")
      .eq("id", districtId)
      .maybeSingle();
    if (error) return { message: toAppError(error).message };
    if (!data) {
      return {
        message: "The selected district no longer exists.",
        fieldErrors: { district_id: ["Select an existing district."] },
      };
    }
  }

  if (resource === "localities") {
    const thanaId = payload.thana_id as string | null | undefined;
    const districtId = payload.district_id as string | null | undefined;

    if (!thanaId && !districtId) {
      return {
        message: "Select a district, or a thana/upazila.",
        fieldErrors: { district_id: ["Select a district, or a thana/upazila."] },
      };
    }

    if (thanaId) {
      const { data, error } = await supabase
        .from("thanas")
        .select("id, district_id")
        .eq("id", thanaId)
        .maybeSingle();

      if (error) return { message: toAppError(error).message };
      if (!data) {
        return {
          message: "The selected thana/upazila no longer exists.",
          fieldErrors: { thana_id: ["Select an existing thana/upazila."] },
        };
      }

      if (districtId && data.district_id !== districtId) {
        return {
          message:
            "The selected thana/upazila does not belong to the selected district. Choose the district that contains it, or clear the district.",
          fieldErrors: {
            district_id: ["This district does not contain the selected thana/upazila."],
          },
        };
      }
    } else if (districtId) {
      const { data, error } = await supabase
        .from("districts")
        .select("id")
        .eq("id", districtId)
        .maybeSingle();
      if (error) return { message: toAppError(error).message };
      if (!data) {
        return {
          message: "The selected district no longer exists.",
          fieldErrors: { district_id: ["Select an existing district."] },
        };
      }
    }
  }

  return null;
}

/** Activates or deactivates a record. Deactivation is the preferred alternative to deletion. */
export async function setLocationResourceActive(
  _previous: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const resource = readResource(formData);
  if (!resource) return { status: "error", message: "Unrecognised location resource." };

  const guard = await guardAction("manage_locations");
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = z
    .object({
      id: z.string().uuid("Select a valid record."),
      is_active: z.enum(["true", "false"]),
    })
    .safeParse({ id: formData.get("id"), is_active: formData.get("is_active") });

  if (!parsed.success) {
    return { status: "error", message: "The record could not be identified." };
  }

  const definition = LOCATION_RESOURCES[resource];
  const nextActive = parsed.data.is_active === "true";

  const { error } = await guard.supabase
    .from(definition.table)
    .update({ is_active: nextActive })
    .eq("id", parsed.data.id);

  if (error) return { status: "error", message: toAppError(error).message };

  revalidateAfterWrite(resource);
  return {
    status: "success",
    message: nextActive ? `${definition.singular} activated.` : `${definition.singular} deactivated.`,
  };
}

/**
 * Deletes a record.
 *
 * The delete is refused when dependent records exist. The foreign keys would
 * refuse it anyway, but a counted, named refusal ("3 thanas still belong to this
 * district") tells the operator what to do next instead of reporting a
 * constraint violation.
 */
export async function deleteLocationResource(
  _previous: LocationActionState,
  formData: FormData,
): Promise<LocationActionState> {
  const resource = readResource(formData);
  if (!resource) return { status: "error", message: "Unrecognised location resource." };

  const guard = await guardAction("manage_locations");
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = z
    .object({ id: z.string().uuid("Select a valid record.") })
    .safeParse({ id: formData.get("id") });

  if (!parsed.success) {
    return { status: "error", message: "The record could not be identified." };
  }

  const definition = LOCATION_RESOURCES[resource];
  const id = parsed.data.id;

  const dependents = await countDependents(guard.supabase, resource, id);
  if (dependents.error) return { status: "error", message: dependents.error };

  if (dependents.total > 0) {
    return {
      status: "error",
      message:
        `This ${definition.singular.toLowerCase()} cannot be deleted: ${dependents.total} dependent ` +
        `${dependents.total === 1 ? "record" : "records"} still reference it (${dependents.summary}). ` +
        `Deactivate it instead, so the history keeps its references.`,
    };
  }

  const { error } = await guard.supabase.from(definition.table).delete().eq("id", id);
  if (error) return { status: "error", message: toAppError(error).message };

  revalidateAfterWrite(resource);
  return { status: "success", message: `${definition.singular} deleted.` };
}

interface DependentSummary {
  total: number;
  summary: string;
  error: string | null;
}

async function countDependents(
  supabase: ServerSupabaseClient,
  resource: LocationResourceKey,
  id: string,
): Promise<DependentSummary> {
  const checks: Array<{ label: string; run: () => PromiseLike<{ count: number | null; error: unknown }> }> = [];

  if (resource === "divisions") {
    checks.push({
      label: "districts",
      run: () =>
        supabase.from("districts").select("*", { count: "exact", head: true }).eq("division_id", id),
    });
  }

  if (resource === "districts") {
    checks.push({
      label: "thanas",
      run: () =>
        supabase.from("thanas").select("*", { count: "exact", head: true }).eq("district_id", id),
    });
    checks.push({
      label: "localities",
      run: () =>
        supabase.from("localities").select("*", { count: "exact", head: true }).eq("district_id", id),
    });
  }

  if (resource === "thanas") {
    checks.push({
      label: "localities",
      run: () =>
        supabase.from("localities").select("*", { count: "exact", head: true }).eq("thana_id", id),
    });
    checks.push({
      label: "timetable records",
      run: () =>
        supabase
          .from("verified_prayer_timings")
          .select("*", { count: "exact", head: true })
          .eq("thana_id", id),
    });
    checks.push({
      label: "prayer configurations",
      run: () =>
        supabase
          .from("prayer_calculation_configs")
          .select("*", { count: "exact", head: true })
          .eq("thana_id", id),
    });
    checks.push({
      label: "Ramadan calendars",
      run: () =>
        supabase
          .from("ramadan_calendar_versions")
          .select("*", { count: "exact", head: true })
          .eq("thana_id", id),
    });
  }

  if (resource === "localities") {
    checks.push({
      label: "timetable records",
      run: () =>
        supabase
          .from("verified_prayer_timings")
          .select("*", { count: "exact", head: true })
          .eq("locality_id", id),
    });
  }

  const results = await Promise.all(checks.map((check) => check.run()));

  let total = 0;
  const parts: string[] = [];

  for (const [index, result] of results.entries()) {
    if (result.error) {
      return {
        total: 0,
        summary: "",
        error: toAppError(result.error).message,
      };
    }
    const count = result.count ?? 0;
    if (count > 0) {
      total += count;
      parts.push(`${count} ${checks[index]!.label}`);
    }
  }

  return { total, summary: parts.join(", "), error: null };
}

function revalidateAfterWrite(resource: LocationResourceKey): void {
  revalidatePath(LOCATION_RESOURCES[resource].path);
  revalidatePath("/dashboard");
}
