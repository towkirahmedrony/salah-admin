import type { Json } from "@/lib/types/database";

/**
 * JSON handling for `app_configs.value`.
 *
 * The editor is deliberately blunt about what it accepts: a value must parse to
 * a JSON *object*. An array or a bare string at the top level cannot be patched
 * by key later, and consuming an unpredictable shape is what turns a
 * configuration table into a source of runtime surprises in the Android app.
 */

export const MAX_JSON_BYTES = 16_384;

export type JsonParseResult =
  | { ok: true; value: Json }
  | { ok: false; error: string };

export function parseJsonObject(text: string): JsonParseResult {
  const trimmed = text.trim();

  if (trimmed.length === 0) {
    return { ok: false, error: "The value cannot be empty. Use {} for an empty object." };
  }

  if (new TextEncoder().encode(trimmed).length > MAX_JSON_BYTES) {
    return {
      ok: false,
      error: `The value is larger than ${Math.floor(MAX_JSON_BYTES / 1024)} KB, which is larger than a configuration value should be.`,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid JSON";
    return { ok: false, error: `Invalid JSON: ${message}` };
  }

  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {
      ok: false,
      error: "The top-level value must be a JSON object, for example {\"enabled\": true}.",
    };
  }

  return { ok: true, value: parsed as Json };
}

export function stringifyJson(value: Json | null | undefined): string {
  if (value === null || value === undefined) return "{}";
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return "{}";
  }
}

/** Top-level keys, for the summary shown in the list view. */
export function jsonKeySummary(value: Json | null | undefined): string {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "—";
  const keys = Object.keys(value);
  if (keys.length === 0) return "no keys";
  if (keys.length <= 3) return keys.join(", ");
  return `${keys.slice(0, 3).join(", ")} +${keys.length - 3}`;
}
