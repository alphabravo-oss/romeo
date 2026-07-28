import { createHash } from "node:crypto";

import type { AuthProviderId } from "../domain/auth-providers";

export function oauth2UserId(
  providerId: AuthProviderId,
  providerAccountId: string,
): string {
  return `user_oauth2_${providerId}_${createHash("sha256")
    .update(`${providerId}\0${providerAccountId}`)
    .digest("hex")
    .slice(0, 24)}`;
}
