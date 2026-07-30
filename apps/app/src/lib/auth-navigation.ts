import { safeRelativeReturnPath } from "@romeo/auth/navigation";

export function safeReturnTo(value: string): string {
  return safeRelativeReturnPath(value);
}
