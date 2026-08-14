import { readEnv, type RomeoEnv } from "@romeo/config";

/** Explicitly enables the development identity for API tests only. */
export function testEnv(
  input: Record<string, string | undefined> = {},
): RomeoEnv {
  return readEnv({ DEV_SEEDED_LOGIN: "true", ...input });
}
