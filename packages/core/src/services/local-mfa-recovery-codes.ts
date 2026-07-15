import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

const recoveryCodeCount = 10;
const recoveryCodePattern =
  /^rmfa-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/u;

export interface LocalMfaRecoveryCodeEnvelope {
  version: 1;
  generatedAt: string;
  codes: LocalMfaRecoveryCodeHash[];
}

interface LocalMfaRecoveryCodeHash {
  id: string;
  salt: string;
  hash: string;
  usedAt?: string;
}

export interface GeneratedLocalMfaRecoveryCodes {
  codes: string[];
  envelope: LocalMfaRecoveryCodeEnvelope;
}

export function generateLocalMfaRecoveryCodes(
  generatedAt: string,
): GeneratedLocalMfaRecoveryCodes {
  const codes = Array.from({ length: recoveryCodeCount }, () =>
    formatRecoveryCode(randomBytes(8).toString("hex")),
  );
  return {
    codes,
    envelope: {
      version: 1,
      generatedAt,
      codes: codes.map((code) => {
        const salt = randomBytes(16).toString("base64url");
        return {
          id: randomBytes(8).toString("base64url"),
          salt,
          hash: hashRecoveryCode(code, salt),
        };
      }),
    },
  };
}

export function serializeLocalMfaRecoveryCodeEnvelope(
  envelope: LocalMfaRecoveryCodeEnvelope,
): string {
  return JSON.stringify(envelope);
}

export function parseLocalMfaRecoveryCodeEnvelope(
  value: string,
): LocalMfaRecoveryCodeEnvelope {
  const parsed = JSON.parse(value) as Partial<LocalMfaRecoveryCodeEnvelope>;
  if (
    parsed.version !== 1 ||
    typeof parsed.generatedAt !== "string" ||
    !Array.isArray(parsed.codes)
  ) {
    throw new Error("Invalid recovery-code envelope.");
  }
  return {
    version: 1,
    generatedAt: parsed.generatedAt,
    codes: parsed.codes.filter(isRecoveryCodeHash).map((code) => ({ ...code })),
  };
}

export function localMfaRecoveryCodeRemainingCount(
  envelope: LocalMfaRecoveryCodeEnvelope,
): number {
  return envelope.codes.filter((code) => code.usedAt === undefined).length;
}

export function consumeLocalMfaRecoveryCode(
  envelope: LocalMfaRecoveryCodeEnvelope,
  inputCode: string,
  usedAt: string,
): { consumed: boolean; envelope: LocalMfaRecoveryCodeEnvelope } {
  const normalized = normalizeLocalMfaRecoveryCode(inputCode);
  let consumed = false;
  const nextCodes = envelope.codes.map((code) => {
    if (consumed || code.usedAt !== undefined) return { ...code };
    if (!recoveryCodeHashMatches(normalized, code)) return { ...code };
    consumed = true;
    return { ...code, usedAt };
  });
  return { consumed, envelope: { ...envelope, codes: nextCodes } };
}

export function normalizeLocalMfaRecoveryCode(value: string): string {
  return value.trim().toLowerCase();
}

export function isLocalMfaRecoveryCodeShape(value: string): boolean {
  return recoveryCodePattern.test(normalizeLocalMfaRecoveryCode(value));
}

function formatRecoveryCode(hex: string): string {
  return `rmfa-${hex.slice(0, 4)}-${hex.slice(4, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}`;
}

function hashRecoveryCode(code: string, salt: string): string {
  return createHash("sha256")
    .update(salt)
    .update(":")
    .update(normalizeLocalMfaRecoveryCode(code))
    .digest("base64url");
}

function recoveryCodeHashMatches(
  code: string,
  expected: LocalMfaRecoveryCodeHash,
): boolean {
  const actualHash = Buffer.from(hashRecoveryCode(code, expected.salt));
  const expectedHash = Buffer.from(expected.hash);
  return (
    actualHash.byteLength === expectedHash.byteLength &&
    timingSafeEqual(actualHash, expectedHash)
  );
}

function isRecoveryCodeHash(value: unknown): value is LocalMfaRecoveryCodeHash {
  if (typeof value !== "object" || value === null) return false;
  const record = value as Record<string, unknown>;
  return (
    typeof record.id === "string" &&
    typeof record.salt === "string" &&
    typeof record.hash === "string" &&
    (record.usedAt === undefined || typeof record.usedAt === "string")
  );
}
