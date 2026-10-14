/**
 * Redaction for anything an untrusted caller can influence — chiefly
 * `feedback_reports.diagnostic_metadata`.
 *
 * The database function already strips credential-looking keys on the way in
 * (`public.submit_feedback`). This is the second layer, applied on the way out,
 * because rows can also predate the filter or arrive by another path.
 *
 * The list is intentionally over-inclusive: dropping a harmless diagnostic key
 * costs a support admin nothing, while leaking a session token into a browser
 * costs the user their account.
 */

const SENSITIVE_KEY_PATTERN =
  /(secret|token|password|passwd|credential|api[_-]?key|private[_-]?key|authorization|auth[_-]?header|bearer|cookie|session|jwt|refresh|access[_-]?key|signature|salt|hash|otp|pin)\b/i;

const SENSITIVE_VALUE_PATTERN =
  /\b(eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}|sk_[A-Za-z0-9]{16,}|sbp_[A-Za-z0-9]{16,}|service_role)\b/;

export const REDACTED = "[redacted]";

const MAX_DEPTH = 6;
const MAX_STRING_LENGTH = 2000;

function redactString(value: string): string {
  if (SENSITIVE_VALUE_PATTERN.test(value)) return REDACTED;
  return value.length > MAX_STRING_LENGTH
    ? `${value.slice(0, MAX_STRING_LENGTH)}… (truncated)`
    : value;
}

/**
 * Returns a display-safe copy. Never mutates the input, so the same value can
 * still be logged or persisted unchanged if that ever becomes necessary.
 */
export function redactForDisplay(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) return value;

  if (typeof value === "string") return redactString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;

  if (depth >= MAX_DEPTH) return "[truncated: nesting too deep]";

  if (Array.isArray(value)) {
    return value.map((entry) => redactForDisplay(entry, depth + 1));
  }

  if (typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
      result[key] = SENSITIVE_KEY_PATTERN.test(key)
        ? REDACTED
        : redactForDisplay(entry, depth + 1);
    }
    return result;
  }

  return REDACTED;
}

/** Pretty-prints redacted JSON for the feedback detail view. */
export function redactedJsonPreview(value: unknown): string {
  if (value === null || value === undefined) return "";
  try {
    return JSON.stringify(redactForDisplay(value), null, 2);
  } catch {
    return REDACTED;
  }
}
