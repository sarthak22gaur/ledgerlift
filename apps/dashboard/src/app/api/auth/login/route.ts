import { NextRequest, NextResponse } from "next/server";

export async function POST(request: NextRequest) {
  const body = await request.json();
  const { key } = body as { key?: string };

  const accessKey = process.env.APP_ACCESS_KEY;

  if (!accessKey) {
    return NextResponse.json({ error: "Auth not configured" }, { status: 503 });
  }

  if (!key || key !== accessKey) {
    return NextResponse.json({ error: "Invalid access key" }, { status: 401 });
  }

  const response = NextResponse.json({ ok: true });
  response.cookies.set("access_key", accessKey, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "strict",
    maxAge: 60 * 60 * 12, // 12 hours
    path: "/",
  });

  return response;
}
