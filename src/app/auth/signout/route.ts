import { NextResponse, type NextRequest } from "next/server";

import { readSupabaseEnv } from "@/lib/env";
import { getServerSupabase } from "@/lib/supabase/server";

/**
 * Signs the administrator out.
 *
 * POST is the primary method (the account menu posts a form, which avoids a
 * link-prefetcher or an <img> tag ending someone's session). GET is accepted as a
 * convenience for the states that render a plain link, such as the access-denied
 * page.
 */
async function handle(request: NextRequest): Promise<NextResponse> {
  const env = readSupabaseEnv();

  if (env.ok) {
    const supabase = await getServerSupabase();
    if (supabase) {
      // Revokes the refresh token server-side as well as clearing the cookies.
      await supabase.auth.signOut();
    }
  }

  const url = request.nextUrl.clone();
  url.pathname = "/login";
  url.search = "";

  const response = NextResponse.redirect(url, { status: 303 });

  // Belt and braces: expire any auth cookie that survived signOut.
  for (const cookie of request.cookies.getAll()) {
    if (cookie.name.startsWith("sb-")) {
      response.cookies.set(cookie.name, "", { path: "/", maxAge: 0 });
    }
  }

  return response;
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
