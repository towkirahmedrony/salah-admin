"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";

import { guardAction } from "@/lib/auth/guards";
import { toAppError, isPermissionIssue } from "@/lib/errors";
import { parseFormData } from "@/lib/validation/common";
import {
  DEFAULT_ENGINE_KEY,
  DEFAULT_ENGINE_VERSION,
  PRAYER_CONFIG_SCHEMA_VERSION,
  prayerCalculationConfigSchema,
} from "@/lib/validation/prayer-config";
import type { ServerSupabaseClient } from "@/lib/supabase/server";
import type {
  PrayerCalculationConfigInsert,
  PrayerCalculationConfigRow,
} from "@/lib/types/database";

/**
 * Server actions for prayer calculation configuration.
 *
 * Every action re-checks the `manage_prayer_config` capability. That check is a
 * convenience for the operator — the boundary is the row level security policy on
 * the table plus, for publishing, the authorization test inside
 * `public.publish_prayer_config()`. If this file were bypassed entirely, the
 * database would still refuse the write.
 */

export interface PrayerConfigActionState {
  status: "idle" | "success" | "error";
  message: string;
  fieldErrors?: Record<string, string[]>;
  /** Row the action created or updated, for client-side focus. */
  rowId?: string;
}

export const INITIAL_PRAYER_CONFIG_ACTION_STATE: PrayerConfigActionState = {
  status: "idle",
  message: "",
};

const idSchema = z.object({ id: z.string().uuid("Select a valid configuration.") });

function revalidatePrayerConfigPaths(id?: string): void {
  revalidatePath("/prayer-config");
  if (id) revalidatePath(`/prayer-config/${id}`);
  revalidatePath("/dashboard");
}

/** The target id columns, in the order the scope check needs them. */
const TARGET_COLUMNS = ["division_id", "district_id", "thana_id"] as const;

/**
 * Turns a validated form payload into a row payload.
 *
 * `status` is never taken from the form. On insert the column default (`draft`)
 * applies and the RLS policy requires it; on update the status transitions go
 * through `publish_prayer_config()` / `archive_prayer_config()` and nowhere else.
 * The derived angle columns are absent too — a trigger computes them from the
 * method, so sending them would be sending a value the database overwrites.
 */
function toRowPayload(
  data: z.infer<typeof prayerCalculationConfigSchema>,
): Omit<PrayerCalculationConfigInsert, "id"> {
  return {
    name: data.name,
    scope: data.scope,
    division_id: data.scope === "division" ? (data.division_id ?? null) : null,
    district_id: data.scope === "district" ? (data.district_id ?? null) : null,
    thana_id: data.scope === "thana" ? (data.thana_id ?? null) : null,
    schema_version: PRAYER_CONFIG_SCHEMA_VERSION,
    engine_key: data.engine_key,
    engine_version: data.engine_version,
    calculation_method: data.calculation_method ?? null,
    asr_madhhab: data.asr_madhhab,
    high_latitude_rule: data.high_latitude_rule,
    adjust_fajr: data.adjust_fajr,
    adjust_dhuhr: data.adjust_dhuhr,
    adjust_asr: data.adjust_asr,
    adjust_maghrib: data.adjust_maghrib,
    adjust_isha: data.adjust_isha,
    timezone: data.timezone,
    effective_from: data.effective_from ?? null,
    effective_to: data.effective_to ?? null,
    source_name: data.source_name ?? null,
    source_url: data.source_url ?? null,
    notes: data.notes ?? null,
  };
}

/** Selects just what the write path needs to decide whether it may proceed. */
const GUARD_COLUMNS = "id, status, version, updated_at, name, scope, division_id, district_id, thana_id";

/**
 * Creates a draft, or updates an existing draft.
 *
 * A published or archived row is not editable. That is enforced by a database
 * trigger as well, but checking here produces a message that names the right remedy
 * ("create a new draft version") instead of reporting a constraint violation.
 */
export async function savePrayerConfig(
  _previous: PrayerConfigActionState,
  formData: FormData,
): Promise<PrayerConfigActionState> {
  const guard = await guardAction("manage_prayer_config");
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = parseFormData(prayerCalculationConfigSchema, formData);
  if (!parsed.ok) {
    return { status: "error", message: parsed.message, fieldErrors: parsed.fieldErrors };
  }

  const payload = toRowPayload(parsed.data);
  const id = parsed.data.id ?? null;

  if (!id) {
    const { data, error } = await guard.supabase
      .from("prayer_calculation_configs")
      .insert(payload)
      .select("id")
      .single();

    if (error) {
      const mapped = toAppError(error);
      return { status: "error", message: mapped.message, fieldErrors: fieldErrorsFor(mapped.message) };
    }

    revalidatePrayerConfigPaths(data?.id);
    return { status: "success", message: "Draft configuration created.", rowId: data?.id };
  }

  // --- update path ----------------------------------------------------------
  const { data: live, error: liveError } = await guard.supabase
    .from("prayer_calculation_configs")
    .select(GUARD_COLUMNS)
    .eq("id", id)
    .maybeSingle();

  if (liveError) return { status: "error", message: toAppError(liveError).message };

  if (!live) {
    return {
      status: "error",
      message: "That configuration no longer exists. It may have been deleted by another administrator.",
    };
  }

  if (live.status !== "draft") {
    return {
      status: "error",
      message:
        live.status === "published"
          ? "A published configuration cannot be edited, because that would rewrite what the app is already using. Create a new draft version instead."
          : "An archived configuration is history and cannot be edited. Create a new draft version from it instead.",
    };
  }

  // --- optimistic concurrency ----------------------------------------------
  // The form carries the `updated_at` it was rendered from. A mismatch means
  // somebody else saved in the meantime, and silently overwriting them would lose
  // their work without either administrator being told.
  const expected = parsed.data.__expected_updated_at;
  if (expected && expected !== live.updated_at) {
    return {
      status: "error",
      message:
        "This configuration was changed by another administrator while you were editing it. Reload the page to see their version, then reapply your changes.",
    };
  }

  const { error } = await guard.supabase
    .from("prayer_calculation_configs")
    .update(payload)
    .eq("id", id);

  if (error) {
    const mapped = toAppError(error);
    return { status: "error", message: mapped.message, fieldErrors: fieldErrorsFor(mapped.message) };
  }

  revalidatePrayerConfigPaths(id);
  return { status: "success", message: "Draft saved.", rowId: id };
}

/**
 * Maps a database constraint back to the field that caused it, so the message
 * appears beside the input rather than only at the top of the form.
 */
function fieldErrorsFor(message: string): Record<string, string[]> | undefined {
  if (/scope_target_agrees|does not match the selected scope/i.test(message)) {
    return {
      thana_id: ["The selected location does not match the chosen scope."],
      district_id: ["The selected location does not match the chosen scope."],
      division_id: ["The selected location does not match the chosen scope."],
    };
  }
  if (/effective_range|effective-to/i.test(message)) {
    return { effective_to: ["The effective-to date cannot be before the effective-from date."] };
  }
  if (/isha/i.test(message)) {
    return { calculation_method: ["The selected method's Isha definition was rejected."] };
  }
  return undefined;
}

/**
 * Publishes a configuration.
 *
 * Delegated to `public.publish_prayer_config()`, which archives the incumbent and
 * publishes this row in one transaction. Doing it as two requests from here would
 * leave a window in which a scope has no live configuration, or two.
 */
export async function publishPrayerConfig(
  _previous: PrayerConfigActionState,
  formData: FormData,
): Promise<PrayerConfigActionState> {
  const guard = await guardAction("manage_prayer_config");
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { status: "error", message: "The configuration could not be identified." };

  const { data, error } = await guard.supabase.rpc("publish_prayer_config", {
    p_id: parsed.data.id,
  });

  if (error) {
    const mapped = toAppError(error);
    return {
      status: "error",
      message: isPermissionIssue(error)
        ? "Publishing requires the prayer configuration capability. Ask a super admin if you need it."
        : mapped.message,
    };
  }

  revalidatePrayerConfigPaths(parsed.data.id);
  return {
    status: "success",
    message: `Published${data ? ` "${data.name}"` : ""}. Any previously published configuration for the same location was archived.`,
    rowId: parsed.data.id,
  };
}

/** Retires a configuration without deleting it. */
export async function archivePrayerConfig(
  _previous: PrayerConfigActionState,
  formData: FormData,
): Promise<PrayerConfigActionState> {
  const guard = await guardAction("manage_prayer_config");
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { status: "error", message: "The configuration could not be identified." };

  const { error } = await guard.supabase.rpc("archive_prayer_config", {
    p_id: parsed.data.id,
  });

  if (error) {
    const mapped = toAppError(error);
    return {
      status: "error",
      message: isPermissionIssue(error)
        ? "Archiving requires the prayer configuration capability. Ask a super admin if you need it."
        : mapped.message,
    };
  }

  revalidatePrayerConfigPaths(parsed.data.id);
  return {
    status: "success",
    message: "Configuration archived. It stays in the history and is not applied as active configuration.",
    rowId: parsed.data.id,
  };
}

/**
 * Deletes a draft.
 *
 * Only drafts. A published configuration is what the app is using, and an archived
 * one is the record of what it used — both are refused by a database trigger too.
 */
export async function deletePrayerConfig(
  _previous: PrayerConfigActionState,
  formData: FormData,
): Promise<PrayerConfigActionState> {
  const guard = await guardAction("manage_prayer_config");
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { status: "error", message: "The configuration could not be identified." };

  const { data: live, error: liveError } = await guard.supabase
    .from("prayer_calculation_configs")
    .select("id, status, name")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (liveError) return { status: "error", message: toAppError(liveError).message };
  if (!live) return { status: "error", message: "That configuration no longer exists." };

  if (live.status !== "draft") {
    return {
      status: "error",
      message: `"${live.name}" is ${live.status}, not a draft, so it cannot be deleted. Archive it instead.`,
    };
  }

  const { error } = await guard.supabase
    .from("prayer_calculation_configs")
    .delete()
    .eq("id", parsed.data.id);

  if (error) return { status: "error", message: toAppError(error).message };

  revalidatePrayerConfigPaths();
  return { status: "success", message: "Draft deleted." };
}

/**
 * Creates a new draft version from an existing configuration.
 *
 * This is the supported way to change a published configuration: the published row
 * is never rewritten, so the app's current configuration and the history of what it
 * used to be both survive. The new draft starts from a copy, so the operator edits a
 * delta rather than retyping every parameter — and the fields they do not touch keep
 * exactly the values they were published with.
 */
export async function createDraftFromPrayerConfig(
  _previous: PrayerConfigActionState,
  formData: FormData,
): Promise<PrayerConfigActionState> {
  const guard = await guardAction("manage_prayer_config");
  if (!guard.ok) return { status: "error", message: guard.message };

  const parsed = idSchema.safeParse({ id: formData.get("id") });
  if (!parsed.success) return { status: "error", message: "The configuration could not be identified." };

  const { data: source, error: sourceError } = await guard.supabase
    .from("prayer_calculation_configs")
    .select("*")
    .eq("id", parsed.data.id)
    .maybeSingle();

  if (sourceError) return { status: "error", message: toAppError(sourceError).message };
  if (!source) return { status: "error", message: "That configuration no longer exists." };

  const nextVersion = await nextVersionFor(guard.supabase, source);

  const payload: PrayerCalculationConfigInsert = {
    name: source.name,
    scope: source.scope,
    division_id: source.division_id,
    district_id: source.district_id,
    thana_id: source.thana_id,
    schema_version: source.schema_version,
    engine_key: source.engine_key,
    engine_version: source.engine_version,
    calculation_method: source.calculation_method,
    asr_madhhab: source.asr_madhhab,
    high_latitude_rule: source.high_latitude_rule,
    adjust_fajr: source.adjust_fajr,
    adjust_dhuhr: source.adjust_dhuhr,
    adjust_asr: source.adjust_asr,
    adjust_maghrib: source.adjust_maghrib,
    adjust_isha: source.adjust_isha,
    timezone: source.timezone,
    effective_from: source.effective_from,
    effective_to: source.effective_to,
    source_name: source.source_name,
    source_url: source.source_url,
    notes: source.notes,
    version: nextVersion,
  };

  const { data, error } = await guard.supabase
    .from("prayer_calculation_configs")
    .insert(payload)
    .select("id")
    .single();

  if (error) {
    const mapped = toAppError(error);
    return { status: "error", message: mapped.message };
  }

  revalidatePrayerConfigPaths(data?.id);
  return {
    status: "success",
    message: `Draft version ${nextVersion} created from "${source.name}". The published configuration is unchanged.`,
    rowId: data?.id,
  };
}

/**
 * The next version number for a scope target.
 *
 * Computed from the group rather than from `source.version + 1`, so copying the
 * same published version twice cannot produce two drafts claiming the same number.
 */
async function nextVersionFor(
  supabase: ServerSupabaseClient,
  source: Pick<PrayerCalculationConfigRow, "scope" | "division_id" | "district_id" | "thana_id">,
): Promise<number> {
  let query = supabase
    .from("prayer_calculation_configs")
    .select("version")
    .eq("scope", source.scope);

  for (const column of TARGET_COLUMNS) {
    const value = source[column];
    query = value === null ? query.is(column, null) : query.eq(column, value);
  }

  const { data } = await query.order("version", { ascending: false }).limit(1);
  const highest = data?.[0]?.version ?? 0;
  return highest + 1;
}

/**
 * The engine the panel targets.
 *
 * Exported so the form can render it rather than hardcoding the string in JSX;
 * there is exactly one engine today, and a second one would be a considered change
 * to `SUPPORTED_ENGINES` and to the check inside `publish_prayer_config()`.
 */
export const TARGET_ENGINE = {
  key: DEFAULT_ENGINE_KEY,
  version: DEFAULT_ENGINE_VERSION,
} as const;
