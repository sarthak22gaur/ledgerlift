import { NextRequest, NextResponse } from "next/server";
import { hasFullAuth } from "@/server/auth/has-full-auth";
import { accountMappingEntrySchema } from "@/lib/schemas";
import {
  upsertAccount,
  deleteAccount,
} from "@/server/rules/repository";

export async function POST(request: NextRequest) {
  if (!(await hasFullAuth())) {
    return new Response(null, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = accountMappingEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const accounts = await upsertAccount(parsed.data);
  return NextResponse.json({ accounts });
}

export async function DELETE(request: NextRequest) {
  if (!(await hasFullAuth())) {
    return new Response(null, { status: 403 });
  }

  const institution = request.nextUrl.searchParams.get("institution");
  const account = request.nextUrl.searchParams.get("account");
  if (!institution || !account) {
    return NextResponse.json(
      { error: "Missing institution or account query param" },
      { status: 400 }
    );
  }
  const last4 = request.nextUrl.searchParams.get("last4") ?? undefined;

  const accounts = await deleteAccount(institution, account, last4);
  return NextResponse.json({ accounts });
}
