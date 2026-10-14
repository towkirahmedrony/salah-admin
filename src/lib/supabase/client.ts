"use client";

import { createBrowserClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";

import { readSupabaseEnv } from "@/lib/env";
import type { Database } from "@/lib/types/database";

export type BrowserSupabaseClient = SupabaseClient<Database>;

let cached: BrowserSupabaseClient | null = null;

/**
 * Browser Supabase client.
 *
 * Uses the publishable key only. Every table it can reach is protected by row
 * level security, so a tampered browser request is refused by the database
 * rather than by anything this client is trusted to enforce.
 *
 * Returns `null` when the environment is not configured; callers render a setup
 * state instead of failing.
 */
export function getBrowserSupabase(): BrowserSupabaseClient | null {
  const result = readSupabaseEnv();
  if (!result.ok) return null;

  if (!cached) {
    cached = createBrowserClient<Database>(result.env.url, result.env.publishableKey);
  }

  return cached;
}
