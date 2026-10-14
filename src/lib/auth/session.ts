import "server-only";

import { cache } from "react";
import { redirect } from "next/navigation";

import { readSupabaseEnv } from "@/lib/env";
import { getServerSupabase } from "@/lib/supabase/server";
import type { AdminRole } from "@/lib/types/database";
import { roleCan, type Capability } from "@/lib/permissions/permissions";

export interface AuthenticatedAdmin {
  id: string;
  email: string;
  fullName: string | null;
  role: AdminRole;
  isActive: true;
}

export type AdminSession =
  /**
   * No Supabase configuration. Distinct from "signed out": the fix is a
   * deployment step, not a password.
   */
  | { kind: "unconfigured"; reason: string }
  /** No session cookie, or the cookie was rejected. */
  | { kind: "anonymous" }
  /**
   * A valid Supabase session whose user has no active `admin_users` row. A
   * session is proof of identity only — it grants nothing on its own.
   */
  | { kind: "not_admin"; email: string | null; userId: string }
  | { kind: "authenticated"; admin: AuthenticatedAdmin }
  /** The database is reachable but the roster could not be read. */
  | { kind: "error"; error: unknown };

/**
 * Resolves the current administrator.
 *
 * Wrapped in React `cache()` so a page, its layout and every nested server
 * component share one lookup per request rather than one query per component.
 */
export const getAdminSession = cache(async (): Promise<AdminSession> => {
  const env = readSupabaseEnv();
  if (!env.ok) {
    return { kind: "unconfigured", reason: env.reason };
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return { kind: "unconfigured", reason: "The server Supabase client is unavailable." };
  }

  const {
    data: { user },
    error: userError,
  } = await supabase.auth.getUser();

  if (userError || !user) {
    // An expired or tampered cookie simply means "not signed in". It is not an
    // operational error worth surfacing as a fault.
    return { kind: "anonymous" };
  }

  const { data, error } = await supabase
    .from("admin_users")
    .select("id, email, full_name, role, is_active")
    .eq("id", user.id)
    .maybeSingle();

  if (error) {
    return { kind: "error", error };
  }

  if (!data || !data.is_active) {
    return { kind: "not_admin", email: user.email ?? null, userId: user.id };
  }

  return {
    kind: "authenticated",
    admin: {
      id: data.id,
      email: data.email,
      fullName: data.full_name,
      role: data.role,
      isActive: true,
    },
  };
});

/**
 * Session for a page that requires an administrator.
 *
 * Redirects rather than throwing so every guarded page fails closed with a
 * rendered state: a setup screen when there is no configuration, the sign-in
 * form when there is no session, and a forbidden page when the session belongs
 * to a non-administrator.
 */
export async function requireAdmin(capability?: Capability): Promise<AuthenticatedAdmin> {
  const session = await getAdminSession();

  switch (session.kind) {
    case "unconfigured":
      redirect("/setup?reason=unconfigured");
    case "anonymous":
      redirect("/login");
    case "not_admin":
      redirect("/access-denied?reason=no-admin-record");
    case "error":
      redirect("/setup?reason=database");
    case "authenticated":
      break;
  }

  if (capability && !roleCan(session.admin.role, capability)) {
    redirect(`/access-denied?reason=capability&capability=${encodeURIComponent(capability)}`);
  }

  return session.admin;
}

/**
 * Session for a page that renders differently when signed in but must not
 * redirect (the sign-in page itself, the setup page).
 */
export async function peekAdminSession(): Promise<AdminSession> {
  return getAdminSession();
}
