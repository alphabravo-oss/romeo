import type { AuthSubject } from "@romeo/auth";
import type { CapabilityFlagId } from "@romeo/contracts";

import { ApiError } from "../errors";
import type { OrganizationCapabilityFlagService } from "./organization-capability-flag-service";

export async function assertCapabilityFlagEnabled(
  flags: OrganizationCapabilityFlagService | undefined,
  subject: AuthSubject,
  flagId: CapabilityFlagId,
): Promise<void> {
  // A security gate with no policy source is an unresolvable decision, not an
  // approval. ServiceRegistry types capabilityFlags as required, so this only
  // fires for partial registries and test doubles -- which is exactly the case
  // that used to silently downgrade a 403 into an allow.
  if (flags === undefined) {
    throw new ApiError(
      "capability_not_allowed",
      "The requested capability is not available.",
      403,
      { flagId, reasonCode: "capability_flag_service_unavailable" },
    );
  }
  const resolved = await flags.resolve(subject, flagId);
  if (resolved.effectiveState === "enabled") return;
  throw new ApiError(
    resolved.reasonCode === "platform_disabled"
      ? "capability_platform_disabled"
      : "capability_not_allowed",
    "The requested capability is not available.",
    403,
    { flagId, reasonCode: resolved.reasonCode },
  );
}
