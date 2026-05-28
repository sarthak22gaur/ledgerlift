// Token format: base64url(expiresAt_ms) + "." + base64url(hmac_signature), signed with APP_ACCESS_KEY.
export const DEFAULT_TTL_MINUTES = 15;

/** Preset TTL options shown in the share dialog. */
export const TTL_OPTIONS = [
  { label: "1 minute", minutes: 1 },
  { label: "5 minutes", minutes: 5 },
  { label: "15 minutes", minutes: 15 },
  { label: "30 minutes", minutes: 30 },
  { label: "1 hour", minutes: 60 },
] as const;

async function getKey(secret: string): Promise<CryptoKey> {
  const enc = new TextEncoder();
  return crypto.subtle.importKey(
    "raw",
    enc.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

function toBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = "";
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function fromBase64Url(s: string): ArrayBuffer {
  const padded = s.replace(/-/g, "+").replace(/_/g, "/");
  const binary = atob(padded);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes.buffer as ArrayBuffer;
}

/** Create a signed share token with the given TTL (default 15 minutes). */
export async function createShareToken(secret: string, ttlMinutes: number = DEFAULT_TTL_MINUTES): Promise<{ token: string; expiresAt: number }> {
  const expiresAt = Date.now() + ttlMinutes * 60 * 1000;
  const payload = new TextEncoder().encode(String(expiresAt));
  const key = await getKey(secret);
  const sig = await crypto.subtle.sign("HMAC", key, payload);
  const token = toBase64Url(payload) + "." + toBase64Url(sig);
  return { token, expiresAt };
}

/** Extract the remaining TTL in seconds from a token (0 if expired/invalid). */
export function getTokenTtlSeconds(token: string): number {
  try {
    const parts = token.split(".");
    if (parts.length !== 2) return 0;
    const payload = fromBase64Url(parts[0]);
    const expiresAt = parseInt(new TextDecoder().decode(payload), 10);
    if (isNaN(expiresAt)) return 0;
    return Math.max(0, Math.ceil((expiresAt - Date.now()) / 1000));
  } catch {
    return 0;
  }
}

/** Verify a share token: check signature and expiry. */
export async function verifyShareToken(token: string, secret: string): Promise<boolean> {
  const parts = token.split(".");
  if (parts.length !== 2) return false;

  try {
    const payload = fromBase64Url(parts[0]);
    const sig = fromBase64Url(parts[1]);
    const key = await getKey(secret);
    const valid = await crypto.subtle.verify("HMAC", key, sig, payload);
    if (!valid) return false;

    const expiresAt = parseInt(new TextDecoder().decode(payload), 10);
    if (isNaN(expiresAt)) return false;
    return Date.now() < expiresAt;
  } catch {
    return false;
  }
}
