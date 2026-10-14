import "server-only";

import { getAdminSession, type AuthenticatedAdmin } from "@/lib/auth/session";
import { getServerSupabase, type ServerSupabaseClient } from "@/lib/supabase/server";
import { roleCan, type Capability } from "@/lib/permissions/permissions";

/**
 * Server-side authorization for mutations.
 *
 * Every server action calls this before touching the database. Two reasons it
 * returns a result instead of redirecting:
 *
 *   * an action that refuses must leave the form open with a readable message,
 *     not bounce the user to a forbidden page and lose what they typed;
 *   * a `redirect()` thrown inside an action is indistinguishable from a failed
 *     action to the calling form.
 *
 * This is still the *second* line of defence. Row level security is the first,
 * and it is the one that holds even if this check were ever bypassed.
 */
export type ActionGuard =
  | { ok: true; admin: AuthenticatedAdmin; supabase: ServerSupabaseClient }
  | { ok: false; message: string };

export async function guardAction(capability: Capability): Promise<ActionGuard> {
  const session = await getAdminSession();

  switch (session.kind) {
    case "unconfigured":
      return {
        ok: false,
        message: "The database is not configured, so this change could not be saved.",
      };
    case "anonymous":
      return {
        ok: false,
        message: "Your session has ended. Sign in again to continue.",
      };
    case "not_admin":
      return {
        ok: false,
        message: "This account is not an active administrator.",
      };
    case "error":
      return {
        ok: false,
        message: "Your administrator record could not be read. Try again in a moment.",
      };
    case "authenticated":
      break;
  }

  if (!roleCan(session.admin.role, capability)) {
    return {
      ok: false,
      message: `Your role does not include "${capability.replace(/_/g, " ")}". Ask a super admin if you need it.`,
    };
  }

  const supabase = await getServerSupabase();
  if (!supabase) {
    return { ok: false, message: "The database client could not be created." };
  }

  return { ok: true, admin: session.admin, supabase };
}

/**
 * Optional capability check for a page that renders differently per role rather
 * than redirecting. Returns null when the capability is present.
 */
export async function capabilityDeniedMessage(capability: Capability): Promise<string | null> {
  const session = await getAdminSession();
  if (session.kind === "authenticated" && roleCan(session.admin.role, capability)) {
    return null;
  }
  return `Your role does not include "${capability.replace(/_/g, " ")}".`;
}
