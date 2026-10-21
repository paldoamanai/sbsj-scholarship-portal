import { createServerClient, type CookieOptions } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { normalizeSupabaseUrl } from "./url";
import { isAdminRole } from "@/lib/settings";

const protectedRoutes = ["/student-dashboard", "/admin"];
const authRoutes = ["/login", "/register", "/forgot-password"];
// Endpoints that return or change the signed-in person's data.
const protectedApis = ["/api/applications", "/api/admin"];

export async function updateSession(request: NextRequest) {
  const path = request.nextUrl.pathname;

  // Public pages need no auth check, so skip the round trip to Supabase. The browser client
  // keeps the session refreshed on its own.
  if (![...protectedRoutes, ...authRoutes, ...protectedApis].some((route) => path.startsWith(route))) {
    return NextResponse.next({ request });
  }

  let supabaseResponse = NextResponse.next({ request });

  const supabase = createServerClient(
    normalizeSupabaseUrl(process.env.NEXT_PUBLIC_SUPABASE_URL),
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options?: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value)
          );
          supabaseResponse = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          );
        },
      },
    }
  );

  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Two-factor: a password-only session for an account with a verified factor may not go past the
  // login page until the code is entered.
  let needsSecondStep = false;
  if (user) {
    const { data: aal } = await supabase.auth.mfa.getAuthenticatorAssuranceLevel();
    needsSecondStep = !!aal && aal.nextLevel === "aal2" && aal.currentLevel !== "aal2";
  }

  if (needsSecondStep) {
    if (protectedRoutes.some((route) => path.startsWith(route))) {
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      return NextResponse.redirect(url);
    }
    if (protectedApis.some((route) => path.startsWith(route))) {
      return NextResponse.json({ error: "Two-factor verification required" }, { status: 401 });
    }
  }

  if (!user && protectedRoutes.some((route) => path.startsWith(route))) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    return NextResponse.redirect(url);
  }

  const onAuthRoute = authRoutes.some((route) => path.startsWith(route));
  const onAdmin = path.startsWith("/admin");
  const onStudent = path.startsWith("/student-dashboard");
  const onStudentApi = protectedApis.some((route) => path.startsWith(route)) && !path.startsWith("/api/admin");
  if (user && !needsSecondStep && (onAuthRoute || onAdmin || onStudent || onStudentApi)) {
    const [{ data: roleData }, { data: profile }] = await Promise.all([
      supabase.from("user_roles").select("role").eq("user_id", user.id).single(),
      supabase.from("profiles").select("is_active").eq("id", user.id).maybeSingle(),
    ]);

    const userRole = (roleData as { role?: string } | null)?.role || "student";
    const home = isAdminRole(userRole) ? "/admin" : "/student-dashboard";

    // A deactivated student is signed out wherever they are. New sign-ins are refused by Supabase Auth
    // (/api/admin/students bans the login); this catches sessions from before, and older deactivations.
    if (!isAdminRole(userRole) && (profile as { is_active?: boolean } | null)?.is_active === false) {
      await supabase.auth.signOut();
      if (onStudentApi) {
        const res = NextResponse.json({ error: "This account has been deactivated" }, { status: 403 });
        supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
        return res;
      }
      const url = request.nextUrl.clone();
      url.pathname = "/login";
      url.search = "?error=inactive";
      const res = NextResponse.redirect(url);
      supabaseResponse.cookies.getAll().forEach((c) => res.cookies.set(c));
      return res;
    }

    // Signed-in people skip the login pages, and each role stays on its own dashboard.
    if (onAuthRoute || (onAdmin && home !== "/admin") || (onStudent && home !== "/student-dashboard")) {
      const url = request.nextUrl.clone();
      url.pathname = home;
      return NextResponse.redirect(url);
    }
  }

  return supabaseResponse;
}
