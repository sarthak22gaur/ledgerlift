import { NextRequest, NextResponse } from "next/server";
import { hasFullAuth } from "@/server/auth/has-full-auth";
import { query } from "@/server/data/db";
import { ruleImpactQuery } from "@/server/data/queries";

type SampleRow = {
  description_raw: string;
  transaction_date: string;
  amount: number;
  institution: string;
};

export async function GET(request: NextRequest) {
  if (!(await hasFullAuth())) {
    return new Response(null, { status: 403 });
  }

  const id = request.nextUrl.searchParams.get("id");
  if (!id) {
    return NextResponse.json({ error: "Missing id query param" }, { status: 400 });
  }

  const { sql, params } = ruleImpactQuery("merchant-override", id);
  const rows = await query<{ count: number; sample_json: string | null }>(sql, params);
  const row = rows[0];
  const count = Number(row?.count ?? 0);
  const sample: SampleRow[] = row?.sample_json ? (JSON.parse(row.sample_json) as SampleRow[]) : [];

  return NextResponse.json({ count, sample });
}
