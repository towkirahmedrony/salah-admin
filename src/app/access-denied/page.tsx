import type { Metadata } from "next";

import { peekAdminSession } from "@/lib/auth/session";
import { ROLE_LABELS } from "@/lib/permissions/permissions";
import { PermissionDenied } from "@/components/ui/states";
import { readString, type RawSearchParams } from "@/lib/utils/search-params";

export const metadata: Metadata = { title: "Access denied" };
export const dynamic = "force-dynamic";

/**
 * Forbidden state.
 *
 * Reads the reason from the query string that `requireAdmin` produced, so the
 * message explains the actual obstacle — no session, no roster row, or a role
 * that lacks the capability — rather than a generic 403.
 */
export default async function AccessDeniedPage({
  searchParams,
}: {
  searchParams: Promise<RawSearchParams>;
}) {
  const params = await searchParams;
  const reason = readString(params, "reason", "capability");
  const capability = readString(params, "capability");

  const session = await peekAdminSession();
  const roleLabel = session.kind === "authenticated" ? ROLE_LABELS[session.admin.role] : undefined;

  return (
    <div className="flex min-h-screen items-center justify-center px-4 py-12">
      <PermissionDenied
        reason={reason}
        capability={capability || undefined}
        roleLabel={roleLabel}
      />
    </div>
  );
}
