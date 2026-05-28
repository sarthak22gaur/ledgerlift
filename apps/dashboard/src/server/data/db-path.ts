import path from "node:path";

const REMOTE_SCHEME = /^(libsql|https?|wss?):\/\//;

export function resolveDbPath(): string {
  const fromDb = process.env.LEDGERLIFT_DB;
  if (fromDb) {
    if (REMOTE_SCHEME.test(fromDb)) return fromDb;
    const stripped = fromDb.startsWith("file:") ? fromDb.slice(5) : fromDb;
    return path.isAbsolute(stripped)
      ? stripped
      : path.resolve(process.cwd(), stripped);
  }

  const fromVault = process.env.LEDGERLIFT_VAULT;
  if (fromVault) {
    return path.join(fromVault, "ledgerlift.sqlite");
  }

  return path.resolve(process.cwd(), "../../data/state/ledgerlift.sqlite");
}
