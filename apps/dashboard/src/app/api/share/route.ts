import { NextRequest, NextResponse } from "next/server";
import { createShareToken, DEFAULT_TTL_MINUTES, TTL_OPTIONS } from "@/lib/share-token";

/** POST /api/share — Generate a share link token with configurable TTL. */
export async function POST(request: NextRequest) {
  const secret = process.env.APP_ACCESS_KEY;
  if (!secret) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
  }

  let ttlMinutes = DEFAULT_TTL_MINUTES;
  try {
    const body = await request.json();
    if (typeof body.ttlMinutes === "number" && body.ttlMinutes > 0) {
      // Clamp to max allowed option
      const maxTtl = Math.max(...TTL_OPTIONS.map((o) => o.minutes));
      ttlMinutes = Math.min(body.ttlMinutes, maxTtl);
    }
  } catch {
    // No body or invalid JSON — use default
  }

  const { token, expiresAt } = await createShareToken(secret, ttlMinutes);
  return NextResponse.json({ token, expiresAt, ttlMinutes });
}
