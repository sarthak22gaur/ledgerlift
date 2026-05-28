import { describe, it, expect, vi, beforeAll, afterAll } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { createClient } from "@libsql/client";
import { NextRequest } from "next/server";

vi.mock("next/headers", () => ({ cookies: vi.fn() }));
vi.mock("@/server/auth/has-full-auth", () => ({ hasFullAuth: vi.fn() }));

import { hasFullAuth } from "@/server/auth/has-full-auth";

let tmpDir: string;
let dbPath: string;
const origDb = process.env.LEDGERLIFT_DB;

const SCHEMA_SQL = `
CREATE TABLE IF NOT EXISTS pipeline_meta (
  key   TEXT PRIMARY KEY,
  value TEXT
);
CREATE TABLE IF NOT EXISTS schema_versions (
  version INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS merchant_rules (
  rule_id           INTEGER PRIMARY KEY AUTOINCREMENT,
  id                TEXT NOT NULL,
  priority          INTEGER NOT NULL,
  match_type        TEXT NOT NULL,
  match_pattern     TEXT NOT NULL,
  canonical_merchant TEXT NOT NULL,
  category          TEXT,
  subcategory       TEXT,
  source            TEXT NOT NULL DEFAULT 'user' CHECK(source IN ('base', 'user'))
);
`;

beforeAll(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerlift-route-test-"));
  dbPath = path.join(tmpDir, "test.sqlite");
  process.env.LEDGERLIFT_DB = dbPath;

  const seed = createClient({ url: `file:${dbPath}` });
  for (const stmt of SCHEMA_SQL.split(";").map((s) => s.trim()).filter(Boolean)) {
    await seed.execute(stmt);
  }
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (origDb === undefined) delete process.env.LEDGERLIFT_DB;
  else process.env.LEDGERLIFT_DB = origDb;
});

let POST: (req: NextRequest) => Promise<Response>;
let DELETE: (req: NextRequest) => Promise<Response>;

beforeAll(async () => {
  const mod = await import("./route");
  POST = mod.POST;
  DELETE = mod.DELETE;
});

function makePostRequest(body: unknown): NextRequest {
  return new NextRequest("http://localhost/api/rules/merchants", {
    method: "POST",
    body: JSON.stringify(body),
    headers: { "Content-Type": "application/json" },
  });
}

function makeDeleteRequest(ruleId: number): NextRequest {
  return new NextRequest(
    `http://localhost/api/rules/merchants?rule_id=${ruleId}`,
    { method: "DELETE" }
  );
}

const validEntry = {
  id: "test_amazon",
  priority: 100,
  match: { type: "contains", pattern: "amazon" },
  canonical_merchant: "Amazon",
  category: "Shopping",
};

describe("POST /api/rules/merchants — auth guard", () => {
  it("returns 403 when hasFullAuth returns false", async () => {
    vi.mocked(hasFullAuth).mockResolvedValue(false);
    const res = await POST(makePostRequest(validEntry));
    expect(res.status).toBe(403);
  });
});

describe("DELETE /api/rules/merchants — auth guard", () => {
  it("returns 403 when hasFullAuth returns false", async () => {
    vi.mocked(hasFullAuth).mockResolvedValue(false);
    const res = await DELETE(makeDeleteRequest(1));
    expect(res.status).toBe(403);
  });
});

describe("POST /api/rules/merchants — happy path", () => {
  beforeAll(() => {
    vi.mocked(hasFullAuth).mockResolvedValue(true);
  });

  it("inserts the entry and returns updated rules list", async () => {
    const res = await POST(makePostRequest(validEntry));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { rules: Array<{ id: string; rule_id: number }> };
    expect(Array.isArray(body.rules)).toBe(true);
    expect(body.rules.some((r) => r.id === "test_amazon")).toBe(true);
    const inserted = body.rules.find((r) => r.id === "test_amazon");
    expect(typeof inserted?.rule_id).toBe("number");
  });

  it("returns 400 for invalid entry (missing id)", async () => {
    const res = await POST(
      makePostRequest({
        priority: 100,
        match: { type: "contains", pattern: "foo" },
        canonical_merchant: "Foo",
      })
    );
    expect(res.status).toBe(400);
  });

  it("accepts a regex pattern that JS RegExp would reject", async () => {
    const res = await POST(
      makePostRequest({
        ...validEntry,
        id: "test_python_only_regex",
        match: { type: "regex", pattern: "(?<=foo)bar" },
      })
    );
    expect(res.status).toBe(200);
  });

  it("flips enrichment_dirty to 1 after insert", async () => {
    const db = createClient({ url: `file:${dbPath}` });
    const result = await db.execute(
      "SELECT value FROM pipeline_meta WHERE key = 'enrichment_dirty' LIMIT 1"
    );
    const value = result.rows[0]?.[0];
    expect(value).toBe("1");
  });

  it("POST without rule_id inserts new row; same id can coexist", async () => {
    const res1 = await POST(makePostRequest({ ...validEntry, id: "dup_test" }));
    const res2 = await POST(makePostRequest({ ...validEntry, id: "dup_test", priority: 50 }));
    expect(res1.status).toBe(200);
    expect(res2.status).toBe(200);

    const db = createClient({ url: `file:${dbPath}` });
    const result = await db.execute({
      sql: "SELECT rule_id FROM merchant_rules WHERE id = ? AND source = 'user'",
      args: ["dup_test"],
    });
    expect(result.rows.length).toBe(2);
    const ruleIds = result.rows.map((r) => r[0]);
    expect(new Set(ruleIds).size).toBe(2);
  });

  it("POST with rule_id updates existing row", async () => {
    const insertRes = await POST(makePostRequest({ ...validEntry, id: "update_test" }));
    const body = (await insertRes.json()) as { rules: Array<{ id: string; rule_id: number }> };
    const inserted = body.rules.find((r) => r.id === "update_test");
    expect(inserted).toBeDefined();
    const ruleId = inserted!.rule_id;

    const updateRes = await POST(
      makePostRequest({ rule_id: ruleId, ...validEntry, id: "update_test", priority: 500 })
    );
    expect(updateRes.status).toBe(200);
    const updateBody = (await updateRes.json()) as { rules: Array<{ id: string; rule_id: number; priority: number }> };
    const updated = updateBody.rules.find((r) => r.rule_id === ruleId);
    expect(updated?.priority).toBe(500);
  });
});

describe("DELETE /api/rules/merchants — happy path", () => {
  let insertedRuleId: number;

  beforeAll(async () => {
    vi.mocked(hasFullAuth).mockResolvedValue(true);
    const res = await POST(makePostRequest({ ...validEntry, id: "delete_test" }));
    const body = (await res.json()) as { rules: Array<{ id: string; rule_id: number }> };
    const found = body.rules.find((r) => r.id === "delete_test");
    insertedRuleId = found!.rule_id;
  });

  it("deletes the entry by rule_id and returns updated rules", async () => {
    const res = await DELETE(makeDeleteRequest(insertedRuleId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean; rules: Array<{ rule_id: number }> };
    expect(body.deleted).toBe(true);
    expect(body.rules.some((r) => r.rule_id === insertedRuleId)).toBe(false);
  });

  it("returns 400 when rule_id query param is missing", async () => {
    const res = await DELETE(
      new NextRequest("http://localhost/api/rules/merchants", { method: "DELETE" })
    );
    expect(res.status).toBe(400);
  });

  it("returns deleted=false for a non-existent rule_id", async () => {
    const res = await DELETE(makeDeleteRequest(999999));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean };
    expect(body.deleted).toBe(false);
  });
});

describe("Additive base/user semantics", () => {
  const baseRuleId_label = "zelle_base_test";

  beforeAll(async () => {
    vi.mocked(hasFullAuth).mockResolvedValue(true);
    const db = createClient({ url: `file:${dbPath}` });
    await db.execute({
      sql: "INSERT INTO merchant_rules(id, priority, match_type, match_pattern, canonical_merchant, source) VALUES(?, ?, ?, ?, ?, 'base')",
      args: [baseRuleId_label, 100, "contains", "zelle", "Zelle"],
    });
  });

  it("POST a rule matching a base id inserts a new user row (both coexist)", async () => {
    const res = await POST(makePostRequest({
      id: baseRuleId_label,
      priority: 200,
      match: { type: "contains", pattern: "zelle" },
      canonical_merchant: "Zelle Modified",
    }));
    expect(res.status).toBe(200);

    const db = createClient({ url: `file:${dbPath}` });
    const result = await db.execute({
      sql: "SELECT source, rule_id FROM merchant_rules WHERE id = ? ORDER BY source",
      args: [baseRuleId_label],
    });
    const sources = result.rows.map((r) => r[0]);
    expect(sources).toContain("base");
    expect(sources).toContain("user");
    expect(sources).toHaveLength(2);
  });

  it("DELETE user row by rule_id leaves base row intact in listing", async () => {
    const db = createClient({ url: `file:${dbPath}` });
    const userRow = await db.execute({
      sql: "SELECT rule_id FROM merchant_rules WHERE id = ? AND source = 'user'",
      args: [baseRuleId_label],
    });
    const userRuleId = userRow.rows[0]?.[0] as number;

    const res = await DELETE(makeDeleteRequest(userRuleId));
    expect(res.status).toBe(200);
    const body = (await res.json()) as { deleted: boolean; rules: Array<{ id: string; source: string }> };
    expect(body.deleted).toBe(true);

    const baseInListing = body.rules.find((r) => r.id === baseRuleId_label);
    expect(baseInListing).toBeDefined();
    expect(baseInListing?.source).toBe("base");
  });
});
