import type { Context } from "hono";
import type { AppBindings } from "./context";

export function shouldSecureCookie(context: Context<AppBindings>): boolean {
  return context.get("secureCookie") === true;
}
