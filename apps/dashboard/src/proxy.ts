import { NextRequest, NextResponse } from "next/server";
import { verifyShareToken, getTokenTtlSeconds } from "@/lib/share-token";

export async function proxy(request: NextRequest) {
  const accessKey = process.env.APP_ACCESS_KEY;

  // No key configured: open in dev, block in production
  if (!accessKey) {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "Misconfigured", message: "APP_ACCESS_KEY is not set" },
        { status: 503 },
      );
    }
    return NextResponse.next();
  }

  // Allow the login page and login API without auth
  if (
    request.nextUrl.pathname === "/login" ||
    request.nextUrl.pathname === "/api/auth/login"
  ) {
    return NextResponse.next();
  }

  // Check access_key cookie (normal auth)
  const cookieKey = request.cookies.get("access_key")?.value;
  if (cookieKey === accessKey) {
    return NextResponse.next();
  }

  // Check ?token= query param (share link clicked)
  const shareToken = request.nextUrl.searchParams.get("token");
  if (shareToken) {
    const valid = await verifyShareToken(shareToken, accessKey);
    if (valid) {
      // Set a cookie so subsequent navigations don't need the token in the URL.
      // Cookie maxAge matches the token's remaining TTL.
      const response = NextResponse.next();
      response.cookies.set("share_token", shareToken, {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "strict",
        maxAge: getTokenTtlSeconds(shareToken),
        path: "/",
      });
      return response;
    }
    // Invalid/expired token — fall through to redirect
  }

  // Check share_token cookie (from a previous ?token= visit)
  const shareTokenCookie = request.cookies.get("share_token")?.value;
  if (shareTokenCookie) {
    const valid = await verifyShareToken(shareTokenCookie, accessKey);
    if (valid) {
      return NextResponse.next();
    }
    // Expired — clear cookie and redirect
    const response = NextResponse.redirect(new URL("/login", request.url));
    response.cookies.delete("share_token");
    return response;
  }

  // Not authenticated — redirect to login
  return NextResponse.redirect(new URL("/login", request.url));
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico).*)",
  ],
};
