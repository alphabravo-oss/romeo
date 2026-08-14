export function isPrivacySafeMetadataKey(key: string): boolean {
  return (
    key.length > 0 &&
    key.length <= 100 &&
    isPrivacySafeString(key) &&
    !/^(?:prompt|promptText|promptContent|output|outputText|outputContent|responseBody|requestBody|media|mediaBytes|sourceText|sourceContent|sourceUrl|secret|secretValue|accessToken|refreshToken|password|credentialValue|errorMessage|errorText|stack)$/iu.test(
      key,
    )
  );
}

export function isPrivacySafeMetadataValue(value: unknown, depth = 0): boolean {
  if (value === undefined || value === null) return true;
  return isPrivacySafeScalar(value) || isPrivacySafeSummary(value, depth);
}

export function isPrivacySafeString(value: string): boolean {
  return (
    value.length <= 500 &&
    !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/u.test(value) &&
    !/(?:bearer\s+[a-z0-9._-]+|-----BEGIN [A-Z ]+PRIVATE KEY-----|(?:postgres|mysql|redis):\/\/[^\s]+@|\bsk-[a-z0-9_-]{12,})/iu.test(
      value,
    )
  );
}

function isPrivacySafeScalar(value: unknown): boolean {
  if (typeof value === "boolean") return true;
  if (typeof value === "number") return Number.isFinite(value);
  return typeof value === "string" && isPrivacySafeString(value);
}

function isPrivacySafeSummary(value: unknown, depth: number): boolean {
  if (depth > 4 || typeof value !== "object" || value === null) return false;
  if (Array.isArray(value))
    return (
      value.length <= 100 &&
      value.every((item) => isPrivacySafeMetadataValue(item, depth + 1))
    );
  const prototype = Object.getPrototypeOf(value);
  if (prototype !== Object.prototype && prototype !== null) return false;
  const entries = Object.entries(value);
  return (
    entries.length <= 50 &&
    entries.every(
      ([key, item]) =>
        isPrivacySafeMetadataKey(key) &&
        isPrivacySafeMetadataValue(item, depth + 1),
    )
  );
}
