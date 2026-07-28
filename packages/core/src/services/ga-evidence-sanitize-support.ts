import { isAbsolute } from "node:path";

export function sanitizeChecklistTargetProfile(
  input: unknown,
): "default-ga" | "full-product-enterprise" | "unknown" {
  return input === "default-ga" || input === "full-product-enterprise"
    ? input
    : "unknown";
}

export function safeEvidencePath(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (isAbsolute(input) || input.includes("..") || input.includes("\\")) {
    return "redacted_path";
  }
  return safeString(input, "redacted_path");
}

export function safeString(input: unknown, fallback: string): string {
  if (typeof input !== "string" || input.length === 0) return fallback;
  if (!/^[A-Za-z0-9 _./:@-]{1,160}$/.test(input)) return fallback;
  return input;
}

export function safeCommand(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) {
    return "redacted_command";
  }
  if (input.length > 1_600 || /[\n\r\0]/.test(input)) {
    return "redacted_command";
  }
  if (hasUnsafeInlineCredentialAssignment(input)) return "redacted_command";
  if (!/^[A-Za-z0-9 _./:@$,=&?|+-]{1,1600}$/.test(input)) {
    return "redacted_command";
  }
  return input;
}

function hasUnsafeInlineCredentialAssignment(value: string): boolean {
  const assignments = value.match(
    /\b[A-Z0-9_]*(?:TOKEN|SECRET|PASSWORD|API_KEY|PRIVATE_KEY)[A-Z0-9_]*=[^\s]+/giu,
  );
  if (assignments === null) return false;
  return assignments.some((assignment) => {
    const [, assigned = ""] = assignment.split("=");
    return !assigned.startsWith("$");
  });
}

export function safeCheckName(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (!/^[A-Za-z0-9:._|/-]{1,180}$/.test(input)) return "redacted_check";
  return input;
}

export function safeOrigin(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  try {
    const origin = new URL(input).origin;
    return safeString(origin, "redacted_origin");
  } catch {
    return input === "invalid_url" ? "invalid_url" : "redacted_origin";
  }
}

export function safeTokens(input: unknown): string[] {
  return asArray(input).map((item) => safeToken(item));
}

export function failurePresenceCodes(input: unknown, code: string): string[] {
  return asArray(input).length === 0 ? [] : [code];
}

export function safeToken(input: unknown): string {
  if (typeof input !== "string" || input.length === 0) return "unknown";
  if (!/^[A-Za-z0-9:._-]{1,160}$/.test(input)) return "redacted_failure";
  return input;
}

export function safeSha256(input: unknown): string {
  return typeof input === "string" && /^[A-Fa-f0-9]{64}$/.test(input)
    ? input.toLowerCase()
    : "redacted_sha256";
}

export function safeCount(input: unknown): number {
  return typeof input === "number" && Number.isSafeInteger(input) && input >= 0
    ? input
    : 0;
}

export function asArray(input: unknown): unknown[] {
  return Array.isArray(input) ? input : [];
}

export function isRecord(input: unknown): input is Record<string, unknown> {
  return typeof input === "object" && input !== null && !Array.isArray(input);
}
