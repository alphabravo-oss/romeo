import type { AuthSubject } from "@romeo/auth";

import { ApiError } from "../errors";
import {
  webRetrievalConfiguration,
  type CapabilityId,
  type WebRetrievalCapabilityConfiguration,
} from "./capability-definition-registry";
import type { CapabilityService } from "./capability-resolver";
import type { EffectiveCapability } from "./capability-resolution-model";

export function capabilityDeniesOperation(
  effective: Pick<EffectiveCapability, "status">,
): boolean {
  return !["enabled", "required", "normalized"].includes(effective.status);
}

export async function authorizeGenericCapability(
  capabilities: CapabilityService,
  subject: AuthSubject,
  capabilityId: Exclude<CapabilityId, "image_generation">,
  context: {
    workspaceId?: string;
    agentId?: string;
    agentVersionId?: string;
    modelId?: string;
  } = {},
): Promise<void> {
  await capabilities.authorizeOperation({
    subject,
    capabilityId,
    requested: { selected: true },
    ...context,
  });
}

export function singletonWorkspaceContext(workspaceIds: readonly string[]): {
  workspaceId?: string;
} {
  const workspaceId = workspaceIds.length === 1 ? workspaceIds[0] : undefined;
  return workspaceId === undefined ? {} : { workspaceId };
}

export async function authorizeVoiceProcessing(
  capabilities: CapabilityService | undefined,
  subject: AuthSubject,
): Promise<void> {
  await requireCapabilityService(capabilities).authorizeOperation({
    subject,
    capabilityId: "voice_processing",
    requested: { selected: true },
  });
}

export async function authorizeDataExport(
  capabilities: CapabilityService | undefined,
  subject: AuthSubject,
  context: { workspaceId?: string } = {},
): Promise<void> {
  await requireCapabilityService(capabilities).authorizeOperation({
    subject,
    capabilityId: "data_export",
    requested: { selected: true },
    ...(context.workspaceId === undefined
      ? {}
      : { workspaceId: context.workspaceId }),
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
  const effective = await requireCapabilityService(
    capabilities,
  ).authorizeOperation({
    subject,
    capabilityId: "web_retrieval",
    requested: { selected: true, ...requested },
    ...context,
  });
  return webRetrievalConfiguration(effective.effective);
}

function requireCapabilityService(
  capabilities: CapabilityService | undefined,
): CapabilityService {
  if (capabilities !== undefined) return capabilities;
  throw new ApiError(
    "capability_authority_unavailable",
    "Capability authorization is temporarily unavailable.",
    503,
  );
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
