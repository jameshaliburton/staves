
const B32 = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
/** ULID: 48-bit time + 80-bit randomness, Crockford base32, lexically sortable by time. */
export function ulid(now = Date.now()): string {
  let t = "";
  let n = now;
  for (let i = 0; i < 10; i++) { t = B32[n % 32] + t; n = Math.floor(n / 32); }
  const r = new Uint8Array(10); (globalThis.crypto as any).getRandomValues(r);
  let s = "";
  for (let i = 0; i < 16; i++) s += B32[r[i % 10] % 32];
  return t + s;
}
