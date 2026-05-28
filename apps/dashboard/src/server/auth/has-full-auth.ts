import { cookies } from "next/headers";

/**
 * Returns true iff the current request has full (non-share-token) auth.
 * Full auth = access_key cookie matches APP_ACCESS_KEY env var.
 * When APP_ACCESS_KEY is not configured (dev mode), always returns true.
 */
export async function hasFullAuth(): Promise<boolean> {
  const accessKey = process.env.APP_ACCESS_KEY;
  if (!accessKey) return true; // No auth configured — dev mode
  const cookieStore = await cookies();
  return cookieStore.get("access_key")?.value === accessKey;
}
