import { redirect } from "next/navigation";

import { readSupabaseEnv } from "@/lib/env";

export const dynamic = "force-dynamic";

/**
 * Entry point.
 *
 * Sends configured deployments straight to the dashboard; the dashboard layout
 * and the middleware decide whether the visitor is actually allowed in. An
 * unconfigured deployment goes to the setup screen rather than showing a bare
 * error.
 */
export default function RootPage() {
  const env = readSupabaseEnv();

  if (!env.ok) {
    redirect("/setup?reason=unconfigured");
  }

  redirect("/dashboard");
}
