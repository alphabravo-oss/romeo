import type { AuthSubject } from "@romeo/auth";

import { ApiError } from "../errors";
import {
  webRetrievalConfiguration,
  type WebRetrievalCapabilityConfiguration,
} from "./capability-definition-registry";
import type { CapabilityService } from "./capability-resolver";

export async function authorizeVoiceProcessing(
  capabilities: CapabilityService | undefined,
  subject: AuthSubject,
): Promise<void> {
  await capabilities?.authorizeOperation({
    subject,
    capabilityId: "voice_processing",
    requested: { selected: true },
  });
}

export async function authorizeWebRetrieval(
  capabilities: CapabilityService | undefined,
  subject: AuthSubject,
  requested: { maxSearchResults?: number; maxUrlsPerRequest?: number },
  context: {
    workspaceId?: string;
    agentId?: string;
    agentVersionId?: string;
  } = {},
): Promise<WebRetrievalCapabilityConfiguration> {
  if (capabilities === undefined)
    return { maxSearchResults: 10, maxUrlsPerRequest: 5 };
  const effective = await capabilities.authorizeOperation({
    subject,
    capabilityId: "web_retrieval",
    requested: { selected: true, ...requested },
    ...context,
  });
  return webRetrievalConfiguration(effective.effective);
}

export function enforceWebUrlLimit(
  requestedCount: number,
  maximum: number,
): void {
  if (requestedCount <= maximum) return;
  throw new ApiError(
    "capability_requested_value_outside_limit",
    "The requested URL count exceeds the effective capability policy.",
    403,
    {
      capabilityId: "web_retrieval",
      reasonCodes: ["requested_value_outside_limit"],
    },
  );
}
