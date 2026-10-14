import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { readSupabaseEnv } from "@/lib/env";

/** Request id forwarded to the database so audit rows correlate with the request. */
export const REQUEST_ID_HEADER = "x-request-id";

/** Routes reachable without a session. Everything else is guarded. */
const PUBLIC_PATHS = ["/login", "/setup", "/api/feedback", "/auth"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

/**
 * Refreshes the Supabase session cookie on every navigation and keeps signed-out
 * visitors away from the dashboard.
 *
 * This is a convenience gate, not the authorization boundary. The real checks
 * are the `admin_users` lookup in the dashboard layout and the RLS policies
 * underneath it — a user who bypasses this middleware still sees nothing.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const requestHeaders = new Headers(request.headers);
  if (!requestHeaders.has(REQUEST_ID_HEADER)) {
    requestHeaders.set(REQUEST_ID_HEADER, crypto.randomUUID());
  }

  const env = readSupabaseEnv();
  const pathname = request.nextUrl.pathname;

  // Without configuration there is no session to refresh. Let the request
  // through so the app can render its setup screen instead of redirect-looping.
  if (!env.ok) {
    return NextResponse.next({ request: { headers: requestHeaders } });
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(env.env.url, env.env.publishableKey, {
    global: { headers: { [REQUEST_ID_HEADER]: requestHeaders.get(REQUEST_ID_HEADER)! } },
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  // Must be called before the response is returned: it is what rotates the
  // refresh token and writes the new cookies.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user && !isPublicPath(pathname)) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.search = "";
    if (pathname !== "/" && pathname !== "/dashboard") {
      const next = `${pathname}${request.nextUrl.search}`;
      url.searchParams.set("next", next);
    }
    return NextResponse.redirect(url);
  }

  return response;
}
