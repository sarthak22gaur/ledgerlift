import { createClient, type Client } from "@libsql/client";
import fs from "node:fs";
import path from "node:path";
import { resolveDbPath } from "./db-path";

function resolveSchemaPath(): string {
  return path.resolve(process.cwd(), "../../src/ledgerlift/schema.sql");
}

let client: Client | null = null;
let schemaEnsured = false;

const EXPECTED_SCHEMA_VERSION = 3;

async function ensureSchema(c: Client): Promise<void> {
  if (schemaEnsured) return;
  const sql = fs.readFileSync(resolveSchemaPath(), "utf8");
  await c.executeMultiple(sql);
  schemaEnsured = true;

  try {
    const result = await c.execute("SELECT version FROM schema_versions LIMIT 1");
    const version = result.rows[0]?.[0];
    if (version !== EXPECTED_SCHEMA_VERSION) {
      console.warn(
        `[db] Schema version mismatch: expected ${EXPECTED_SCHEMA_VERSION}, got ${version}. ` +
        "Run `ledgerlift e2e --force` to upgrade."
      );
    }
  } catch {
    // schema_versions table may not exist in test environments seeded without Python init_db
  }
}

function getClient(): Client {
  if (!client) {
    const dbPath = resolveDbPath();
    const hasScheme = /^(libsql|https?|wss?):\/\//.test(dbPath);
    const url = hasScheme ? dbPath : `file:${dbPath}`;
    const authToken = process.env.LIBSQL_AUTH_TOKEN;
    client = createClient(authToken ? { url, authToken } : { url });
  }
  return client;
}

function normalize(value: unknown): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "bigint") return Number(value);
  if (value instanceof Date) {
    const iso = value.toISOString();
    return iso.endsWith("T00:00:00.000Z") ? iso.slice(0, 10) : iso;
  }
  if (Array.isArray(value)) return value.map(normalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = normalize(v);
    }
    return out;
  }
  return value;
}

export async function query<T>(
  sql: string,
  params: unknown[] = []
): Promise<T[]> {
  const c = getClient();
  await ensureSchema(c);
  const result = await c.execute({ sql, args: params as never });
  const { rows, columns } = result;
  return rows.map((row) => {
    const obj: Record<string, unknown> = {};
    for (let i = 0; i < columns.length; i++) {
      obj[columns[i]] = normalize(row[i]);
    }
    return obj as T;
  });
}
