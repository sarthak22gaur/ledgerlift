import { NextRequest, NextResponse } from "next/server";
import { hasFullAuth } from "@/server/auth/has-full-auth";
import { z } from "zod";
import {
  upsertCounterparty,
  deleteCounterparty,
} from "@/server/rules/repository";

const counterpartyBodySchema = z.object({
  name: z.string().min(1),
});

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

  const parsed = counterpartyBodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const counterparties = await upsertCounterparty(parsed.data.name);
  return NextResponse.json({ counterparties });
}

export async function DELETE(request: NextRequest) {
  if (!(await hasFullAuth())) {
    return new Response(null, { status: 403 });
  }

  const name = request.nextUrl.searchParams.get("name");
  if (!name) {
    return NextResponse.json({ error: "Missing name query param" }, { status: 400 });
  }

  const counterparties = await deleteCounterparty(name);
  return NextResponse.json({ counterparties });
}
