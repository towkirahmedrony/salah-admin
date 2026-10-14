/**
 * Environment configuration.
 *
 * Only two variables exist, and both are browser-safe by design. Nothing
 * privileged is read anywhere in this codebase: there is no service-role key,
 * no database URL and no secret API key, so there is nothing that could leak
 * into a client bundle.
 *
 * The functions here never throw. A missing variable produces a described
 * configuration state that the UI renders as a setup screen, because crashing
 * on `undefined` inside a client constructor is exactly the unpredictable
 * failure mode this project is meant to avoid.
 */

export const SUPABASE_URL_VAR = "NEXT_PUBLIC_SUPABASE_URL";
export const SUPABASE_KEY_VAR = "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY";

export interface SupabaseEnv {
  url: string;
  publishableKey: string;
}

export type EnvReadResult =
  | { ok: true; env: SupabaseEnv }
  | { ok: false; missing: string[]; reason: string };

function readVar(name: string): string {
  // Static property access keeps Next.js able to inline NEXT_PUBLIC_* values
  // into the client bundle; a dynamic lookup would silently become undefined.
  const raw =
    name === SUPABASE_URL_VAR
      ? process.env.NEXT_PUBLIC_SUPABASE_URL
      : process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;

  return typeof raw === "string" && raw.trim().length > 0 ? raw.trim() : "";
}

/**
 * Reads the Supabase configuration.
 *
 * Returns a discriminated result so callers must acknowledge the missing
 * configuration branch — a bare `string | undefined` is easy to forget.
 */
export function readSupabaseEnv(): EnvReadResult {
  const url = readVar(SUPABASE_URL_VAR);
  const publishableKey = readVar(SUPABASE_KEY_VAR);

  const missing: string[] = [];
  if (!url) missing.push(SUPABASE_URL_VAR);
  if (!publishableKey) missing.push(SUPABASE_KEY_VAR);

  if (missing.length > 0) {
    return {
      ok: false,
      missing,
      reason:
        `The application is not connected to a database yet. Set ${missing.join(
          " and ",
        )} in your environment (see README § Configuration) and restart the server.`,
    };
  }

  if (!/^https?:\/\//i.test(url)) {
    return {
      ok: false,
      missing: [],
      reason: `${SUPABASE_URL_VAR} must be a full URL, for example https://your-project.supabase.co.`,
    };
  }

  return { ok: true, env: { url, publishableKey } };
}

export function isSupabaseConfigured(): boolean {
  return readSupabaseEnv().ok;
}
