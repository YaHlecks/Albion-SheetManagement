import { NextResponse, type NextRequest } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { env } from "@/lib/env";

export async function GET(request: NextRequest) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/dashboard";

  if (!env.supabaseConfigured) {
    return NextResponse.redirect(`${origin}/login?error=config`);
  }

  let response = NextResponse.redirect(`${origin}/login`);

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        response = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          response.cookies.set(name, value, options)
        );
      },
    },
  });

  if (code) {
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      const target = next.startsWith("/") ? next : "/dashboard";
      // Redirect with the refreshed session cookies attached.
      response.headers.set("Location", `${origin}${target}`);
      return response;
    }
  }

  // Invalid or expired code — send to reset page with an error flag.
  return NextResponse.redirect(`${origin}/reset-password?error=invalid`);
}
