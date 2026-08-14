const requestIdPattern = /^[A-Za-z0-9._:-]{1,128}$/u;

export function normalizedRequestId(value: string | undefined): string {
  return value !== undefined && requestIdPattern.test(value)
    ? value
    : crypto.randomUUID();
}
