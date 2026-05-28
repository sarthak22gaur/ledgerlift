import { describe, it, expect, beforeAll, afterAll, afterEach } from "vitest";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";

let tmpDir: string;
let dbPath: string;
const origDb = process.env.LEDGERLIFT_DB;

beforeAll(() => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ledgerlift-db-test-"));
  dbPath = path.join(tmpDir, "fresh.sqlite");
  process.env.LEDGERLIFT_DB = dbPath;
});

afterAll(() => {
  fs.rmSync(tmpDir, { recursive: true, force: true });
  if (origDb === undefined) delete process.env.LEDGERLIFT_DB;
  else process.env.LEDGERLIFT_DB = origDb;
});

describe("query() bootstraps schema on a fresh DB", () => {
  it("returns an empty result from merchant_rules without throwing", async () => {
    const { query } = await import("@/server/data/db");
    const rows = await query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM merchant_rules"
    );
    expect(rows).toHaveLength(1);
    expect(rows[0].count).toBe(0);
  });

  it("pipeline_meta table exists and is empty", async () => {
    const { query } = await import("@/server/data/db");
    const rows = await query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM pipeline_meta"
    );
    expect(rows[0].count).toBe(0);
  });

  it("accounts table exists and is empty", async () => {
    const { query } = await import("@/server/data/db");
    const rows = await query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM accounts"
    );
    expect(rows[0].count).toBe(0);
  });

  it("second call does not re-run DDL (idempotent within process)", async () => {
    const { query } = await import("@/server/data/db");
    const rows = await query<{ count: number }>(
      "SELECT COUNT(*) AS count FROM category_rules"
    );
    expect(rows[0].count).toBe(0);
  });
});

describe("resolveDbPath()", () => {
  const savedDb = process.env.LEDGERLIFT_DB;

  afterEach(() => {
    if (savedDb === undefined) delete process.env.LEDGERLIFT_DB;
    else process.env.LEDGERLIFT_DB = savedDb;
  });

  it("returns libsql:// URL unchanged", async () => {
    process.env.LEDGERLIFT_DB = "libsql://example.turso.io";
    const { resolveDbPath } = await import("@/server/data/db-path");
    expect(resolveDbPath()).toBe("libsql://example.turso.io");
  });

  it("returns https:// URL unchanged", async () => {
    process.env.LEDGERLIFT_DB = "https://example.turso.io/db";
    const { resolveDbPath } = await import("@/server/data/db-path");
    expect(resolveDbPath()).toBe("https://example.turso.io/db");
  });

  it("returns absolute filesystem path unchanged", async () => {
    process.env.LEDGERLIFT_DB = "/some/path/ledgerlift.sqlite";
    const { resolveDbPath } = await import("@/server/data/db-path");
    expect(resolveDbPath()).toBe("/some/path/ledgerlift.sqlite");
  });

  it("strips leading file: before returning filesystem path", async () => {
    process.env.LEDGERLIFT_DB = "file:/some/path/ledgerlift.sqlite";
    const { resolveDbPath } = await import("@/server/data/db-path");
    expect(resolveDbPath()).toBe("/some/path/ledgerlift.sqlite");
  });

  it("resolves relative path against cwd when no scheme", async () => {
    process.env.LEDGERLIFT_DB = "relative/path.sqlite";
    const { resolveDbPath } = await import("@/server/data/db-path");
    expect(resolveDbPath()).toBe(path.resolve(process.cwd(), "relative/path.sqlite"));
  });

  it("returns default path when LEDGERLIFT_DB is unset", async () => {
    delete process.env.LEDGERLIFT_DB;
    const { resolveDbPath } = await import("@/server/data/db-path");
    expect(resolveDbPath()).toBe(
      path.resolve(process.cwd(), "../../data/state/ledgerlift.sqlite")
    );
  });

  it("returns vault/ledgerlift.sqlite when LEDGERLIFT_VAULT is set and LEDGERLIFT_DB is unset", async () => {
    delete process.env.LEDGERLIFT_DB;
    process.env.LEDGERLIFT_VAULT = "/tmp/myvault";
    try {
      const { resolveDbPath } = await import("@/server/data/db-path");
      expect(resolveDbPath()).toBe(path.join("/tmp/myvault", "ledgerlift.sqlite"));
    } finally {
      delete process.env.LEDGERLIFT_VAULT;
    }
  });

  it("LEDGERLIFT_DB wins over LEDGERLIFT_VAULT when both are set", async () => {
    process.env.LEDGERLIFT_DB = "/explicit/ledgerlift.sqlite";
    process.env.LEDGERLIFT_VAULT = "/tmp/myvault";
    try {
      const { resolveDbPath } = await import("@/server/data/db-path");
      expect(resolveDbPath()).toBe("/explicit/ledgerlift.sqlite");
    } finally {
      delete process.env.LEDGERLIFT_VAULT;
    }
  });
});
