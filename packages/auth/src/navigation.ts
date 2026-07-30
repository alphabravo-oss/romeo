const defaultMaximumReturnPathLength = 500;

export function isSafeRelativeReturnPath(
  value: string,
  maximumLength = defaultMaximumReturnPathLength,
): boolean {
  return (
    value.length > 0 &&
    value.length <= maximumLength &&
    value.startsWith("/") &&
    !value.startsWith("//") &&
    !/[\r\n]/u.test(value)
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
