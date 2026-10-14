import "server-only";

import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";

import { readSupabaseEnv } from "@/lib/env";
import type { Database } from "@/lib/types/database";

export type ServerSupabaseClient = SupabaseClient<Database>;

/**
 * Server Supabase client.
 *
 * Runs as the signed-in administrator: the session cookie is attached and every
 * query is subject to RLS. There is no privileged client in this codebase, so a
 * server action cannot accidentally sidestep authorization.
 *
 * `x-request-id` is forwarded so the database audit trigger can stamp the same
 * correlation id the server action logged (see `request_header()` in
 * `20260101000300_functions_and_triggers.sql`).
 */
export async function getServerSupabase(): Promise<ServerSupabaseClient | null> {
  const result = readSupabaseEnv();
  if (!result.ok) return null;

  const cookieStore = await cookies();
  const requestHeaders = await headers();
  const requestId = requestHeaders.get("x-request-id") ?? crypto.randomUUID();

  return createServerClient<Database>(result.env.url, result.env.publishableKey, {
    global: {
      headers: { "x-request-id": requestId },
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, options);
          }
        } catch {
          // Called from a Server Component, where the cookie store is read-only.
          // The middleware already refreshes the session, so this is safe to
          // ignore rather than crash the render.
        }
      },
    },
  });
}

/**
 * Client with no session attached.
 *
 * Used only for the public surfaces (feedback intake, the provisioning check)
 * and for the sign-in call itself, where there is no cookie yet.
 */
export function getAnonymousSupabase(): ServerSupabaseClient | null {
  const result = readSupabaseEnv();
  if (!result.ok) return null;

  return createServerClient<Database>(result.env.url, result.env.publishableKey, {
    cookies: { getAll: () => [], setAll: () => {} },
  });
}
