// Remplaçant local de deno.land/x/djwt (HS256 seulement) pour le banc
const b64u = (buf) => Buffer.from(buf).toString("base64").replace(/=+$/, "").replace(/\+/g, "-").replace(/\//g, "_");
const unb64u = (s) => Buffer.from(s.replace(/-/g, "+").replace(/_/g, "/"), "base64");
export function getNumericDate(n) { return Math.floor(Date.now() / 1000) + n; }
export async function create(header, payload, key) {
  const data = b64u(JSON.stringify(header)) + "." + b64u(JSON.stringify(payload));
  const sig = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(data));
  return data + "." + b64u(new Uint8Array(sig));
}
export async function verify(token, key) {
  const [h, p, s] = String(token).split(".");
  if (!s) throw new Error("jwt");
  const ok = await crypto.subtle.verify("HMAC", key, unb64u(s), new TextEncoder().encode(h + "." + p));
  if (!ok) throw new Error("signature");
  const pl = JSON.parse(unb64u(p).toString());
  if (pl.exp && pl.exp < Date.now() / 1000) throw new Error("exp");
  return pl;
}
