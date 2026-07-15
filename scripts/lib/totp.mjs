import { createHmac } from "node:crypto";

const base32Alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

export function generateTotpCode(secret, options = {}) {
  const digits = options.digits ?? 6;
  const periodSeconds = options.periodSeconds ?? 30;
  const timestamp = options.timestamp ?? Date.now();
  const counter = Math.floor(timestamp / 1000 / periodSeconds);
  const key = decodeBase32Secret(secret);
  const message = Buffer.alloc(8);
  message.writeBigUInt64BE(BigInt(counter));

  const digest = createHmac(options.algorithm ?? "sha1", key)
    .update(message)
    .digest();
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** digits).padStart(digits, "0");
}

export function decodeBase32Secret(secret) {
  const normalized = secret.replace(/[\s=]/gu, "").toUpperCase();
  if (normalized.length === 0) throw new Error("TOTP secret is empty.");

  let bits = 0;
  let value = 0;
  const bytes = [];
  for (const char of normalized) {
    const index = base32Alphabet.indexOf(char);
    if (index < 0) throw new Error("TOTP secret is not RFC4648 base32.");
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}
