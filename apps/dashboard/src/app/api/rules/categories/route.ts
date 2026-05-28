import { NextRequest, NextResponse } from "next/server";
import { hasFullAuth } from "@/server/auth/has-full-auth";
import { categoryRuleEntrySchema } from "@/lib/schemas";
import {
  insertCategoryRule,
  updateCategoryRule,
  deleteCategoryRule,
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

  const parsed = categoryRuleEntrySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: parsed.error.message }, { status: 400 });
  }

  const { rule_id, ...entry } = parsed.data;
  const rules = rule_id != null
    ? await updateCategoryRule(rule_id, entry)
    : await insertCategoryRule(entry);
  return NextResponse.json({ rules });
}

export async function DELETE(request: NextRequest) {
  if (!(await hasFullAuth())) {
    return new Response(null, { status: 403 });
  }

  const ruleIdParam = request.nextUrl.searchParams.get("rule_id");
  if (!ruleIdParam) {
    return NextResponse.json({ error: "Missing rule_id query param" }, { status: 400 });
  }
  const ruleId = parseInt(ruleIdParam, 10);
  if (isNaN(ruleId)) {
    return NextResponse.json({ error: "rule_id must be an integer" }, { status: 400 });
  }

  const result = await deleteCategoryRule(ruleId);
  return NextResponse.json(result);
}
