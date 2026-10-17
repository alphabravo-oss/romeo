const defaultMaximumReturnPathLength = 500;
const navigationBaseOrigin = "https://romeo.invalid";

// Backslashes, ASCII control characters and whitespace are normalised away by
// browsers when resolving URLs, so `/\evil.com` or `/\t/evil.com` would
// otherwise navigate to another origin.
const unsafeReturnPathCharacters =
  /[\\\u0000-\u0020\u007f-\u009f\u2028\u2029]/u;

export function isSafeRelativeReturnPath(
  value: string,
  maximumLength = defaultMaximumReturnPathLength,
): boolean {
  if (
    value.length === 0 ||
    value.length > maximumLength ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    unsafeReturnPathCharacters.test(value)
  ) {
    return false;
  }
  let resolved: URL;
  try {
    resolved = new URL(value, navigationBaseOrigin);
  } catch {
    return false;
  }
  return (
    resolved.origin === navigationBaseOrigin &&
    resolved.pathname.startsWith("/") &&
    !resolved.pathname.startsWith("//")
  );
}

export function safeRelativeReturnPath(
  value: string | undefined,
  fallback = "/",
): string {
  return value !== undefined && isSafeRelativeReturnPath(value)
    ? value
    : fallback;
}

export function normalizeWebOrigin(value: string): string {
  const url = new URL(value);
  return `${url.protocol}//${url.host}`;
}
