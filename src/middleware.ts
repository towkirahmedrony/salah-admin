import type { NextRequest } from "next/server";

import { updateSession } from "@/lib/supabase/middleware";

/**
 * Runs on every matched request to refresh the Supabase session cookie and to
 * keep signed-out visitors away from the dashboard.
 *
 * This is not the authorization boundary. Authorization is the `admin_users`
 * lookup in the dashboard layout plus the RLS policies beneath it, so a request
 * that somehow bypasses the middleware still sees nothing.
 */
export async function middleware(request: NextRequest) {
  return updateSession(request);
}

export const config = {
  matcher: [
    /*
     * Everything except Next.js internals and static files, so session refresh
     * is not wasted on assets.
     */
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico|txt|xml|webmanifest)$).*)",
  ],
};
