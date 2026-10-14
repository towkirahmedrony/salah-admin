import type { ReactNode } from "react";

import { requireAdmin } from "@/lib/auth/session";
import { AppShell } from "@/components/layout/app-shell";

export const dynamic = "force-dynamic";

/**
 * Guarded shell for every management page.
 *
 * `requireAdmin()` resolves the session *and* the active `admin_users` row, so a
 * signed-in stranger is redirected to the forbidden state before any page below
 * renders. Individual pages add their own capability requirement.
 */
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const admin = await requireAdmin();

  return <AppShell admin={admin}>{children}</AppShell>;
}
