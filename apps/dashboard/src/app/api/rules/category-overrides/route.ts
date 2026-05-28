import { NextRequest, NextResponse } from "next/server";
import { hasFullAuth } from "@/server/auth/has-full-auth";
import { overrideEntrySchema } from "@/lib/schemas";
import {
  upsertCategoryOverride,
  deleteCategoryOverride,
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

  const parsed = overrideEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const overrides = await upsertCategoryOverride(parsed.data);
  return NextResponse.json({ overrides });
}

export async function DELETE(request: NextRequest) {
  if (!(await hasFullAuth())) {
    return new Response(null, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id query param" }, { status: 400 });
  }

  const overrides = await deleteCategoryOverride(id);
  return NextResponse.json({ overrides });
}
