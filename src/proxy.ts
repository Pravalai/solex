import { NextResponse, type NextRequest } from "next/server";
import { homePathFor, roleMayEnter } from "@/modules/identity/roles";
import { SESSION_COOKIE, verifySession } from "@/modules/identity/token";

/**
 * First line of defence: unauthenticated requests go to /login, and each role is
 * confined to its own surface (internal, /broker or /developer). Pages and
 * server actions re-check permissions and data scope; this is not the only guard.
 */
export async function proxy(request: NextRequest) {
  const { pathname, search } = request.nextUrl;
  const claims = await verifySession(request.cookies.get(SESSION_COOKIE)?.value);

  if (pathname === "/login") {
    // The app found the session's user gone or inactive: drop the cookie rather than
    // redirecting home, which would loop between /login and the home page.
    if (request.nextUrl.searchParams.has("expired")) {
      const res = NextResponse.next();
      res.cookies.delete(SESSION_COOKIE);
      return res;
    }
    if (claims) return NextResponse.redirect(new URL(homePathFor(claims.role), request.url));
    return NextResponse.next();
  }
  if (!claims) {
    const url = new URL("/login", request.url);
    if (pathname !== "/") url.searchParams.set("next", pathname + search);
    return NextResponse.redirect(url);
  }
  if (pathname === "/" || !roleMayEnter(claims.role, pathname)) {
    return NextResponse.redirect(new URL(homePathFor(claims.role), request.url));
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico|api/health|.*\\.(?:svg|png|jpg|ico|webp|woff2?)$).*)"],
};
