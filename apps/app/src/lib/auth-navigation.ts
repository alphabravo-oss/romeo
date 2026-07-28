export function safeReturnTo(value: string): string {
  return value.startsWith("/") && !value.startsWith("//") ? value : "/";
}
