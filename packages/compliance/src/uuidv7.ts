// UUIDv7 generator (RFC 9562 §5.7). Time-sortable; monotonic within a
// millisecond using a 12-bit sub-ms counter. No external deps.

let lastMs = -1;
let counter = 0;

export function uuidv7(now: number = Date.now()): string {
  let ms = now;
  if (ms === lastMs) {
    counter += 1;
    if (counter > 0xfff) {
      ms += 1;
      lastMs = ms;
      counter = 0;
    }
  } else {
    lastMs = ms;
    counter = 0;
  }

  // Compose the 128-bit value as a 16-byte buffer.
  const b = new Uint8Array(16);

  // 48-bit big-endian unix-millis timestamp into bytes 0..5.
  // ms <= 2^48 - 1 (well below Number.MAX_SAFE_INTEGER for the next 8000+ years).
  const high = Math.floor(ms / 0x100000000); // top 16 bits of the 48-bit field
  const low = ms >>> 0; // low 32 bits
  b[0] = (high >>> 8) & 0xff;
  b[1] = high & 0xff;
  b[2] = (low >>> 24) & 0xff;
  b[3] = (low >>> 16) & 0xff;
  b[4] = (low >>> 8) & 0xff;
  b[5] = low & 0xff;

  // 4-bit version (7) + 12-bit counter into bytes 6..7.
  b[6] = 0x70 | ((counter >>> 8) & 0x0f);
  b[7] = counter & 0xff;

  // 62 random bits into bytes 8..15 with the top 2 bits set to RFC 4122 variant 10.
  const rand = new Uint8Array(8);
  crypto.getRandomValues(rand);
  rand[0] = ((rand[0] ?? 0) & 0x3f) | 0x80;
  for (let i = 0; i < 8; i++) b[8 + i] = rand[i] ?? 0;

  const hex: string[] = [];
  for (const x of b) hex.push(x.toString(16).padStart(2, "0"));
  const s = hex.join("");
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20, 32)}`;
}
