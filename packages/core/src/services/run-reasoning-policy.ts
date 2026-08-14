import type {
  BaseModel,
  ProviderReasoningPolicy,
  ProviderReasoningPolicyLayers,
} from "@romeo/providers";
import { providerReasoningPolicyFromUnknown } from "@romeo/providers";

import type { AgentParameters } from "../domain/agent-entities";
import type { RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { CapabilityPlatformPolicy } from "./capability-platform-policy";
import { requestedChatParametersForModel } from "./run-sampling";
import {
  reasoningPolicySettingKey,
  resolveReasoningCapabilityMaximum,
} from "./reasoning-capability-policy";

export { reasoningPolicySettingKey };

export async function requestedChatParametersForStart(
  repository: RomeoRepository,
  input: {
    agentParameters: AgentParameters | Record<string, unknown>;
    model: BaseModel;
    orgId: string;
    workspaceId: string;
    platformPolicy?: CapabilityPlatformPolicy;
    runRequest?: ProviderReasoningPolicy;
  },
) {
  const policy = await reasoningPolicyLayersForStart(repository, input);
  return requestedChatParametersForModel(
    input.model,
    input.agentParameters,
    policy,
  );
}

export async function reasoningPolicyLayersForStart(
  repository: RomeoRepository,
  input: {
    agentParameters: AgentParameters | Record<string, unknown>;
    orgId: string;
    workspaceId: string;
    platformPolicy?: CapabilityPlatformPolicy;
    runRequest?: ProviderReasoningPolicy;
  },
): Promise<ProviderReasoningPolicyLayers | undefined> {
  const organizationMaximum = await resolveReasoningCapabilityMaximum(
    repository,
    input,
  );
  const agentDefault = reasoningPolicyFromUnknown(
    input.agentParameters.reasoningPolicy,
  );
  return compactLayers({
    ...(organizationMaximum === undefined ? {} : { organizationMaximum }),
    ...(agentDefault === undefined ? {} : { agentDefault }),
    ...(input.runRequest === undefined ? {} : { runRequest: input.runRequest }),
  });
}

export async function reasoningPolicyLayersForContinuation(
  repository: RomeoRepository,
  run: RunRecord,
  agentParameters: AgentParameters | Record<string, unknown>,
  platformPolicy?: CapabilityPlatformPolicy,
): Promise<ProviderReasoningPolicyLayers | undefined> {
  const started = (await repository.listRunEvents(run.id)).find(
    (event) => event.type === "run.started",
  );
  const parameterResolution = record(
    record(started?.data)?.parameterResolution,
  );
  const resolution = record(parameterResolution?.reasoningPolicy);
  const source = resolution?.source;
  const runRequest =
    source === "run_request"
      ? reasoningPolicyFromUnknown(resolution?.requested)
      : undefined;
  const organizationMaximum = await resolveReasoningCapabilityMaximum(
    repository,
    {
      orgId: run.orgId,
      workspaceId: run.workspaceId,
      ...(platformPolicy === undefined ? {} : { platformPolicy }),
    },
  );
  const agentDefault = reasoningPolicyFromUnknown(
    agentParameters.reasoningPolicy,
  );
  return compactLayers({
    ...(organizationMaximum === undefined ? {} : { organizationMaximum }),
    ...(agentDefault === undefined ? {} : { agentDefault }),
    ...(runRequest === undefined ? {} : { runRequest }),
  });
}

export async function reasoningPolicyLayersAtDispatch(
  repository: RomeoRepository,
  run: Pick<RunRecord, "orgId" | "workspaceId">,
  layers: ProviderReasoningPolicyLayers,
  platformPolicy?: CapabilityPlatformPolicy,
): Promise<ProviderReasoningPolicyLayers> {
  const organizationMaximum = await resolveReasoningCapabilityMaximum(
    repository,
    {
      orgId: run.orgId,
      workspaceId: run.workspaceId,
      ...(platformPolicy === undefined ? {} : { platformPolicy }),
    },
  );
  return {
    ...(layers.agentDefault === undefined
      ? {}
      : { agentDefault: layers.agentDefault }),
    organizationMaximum,
    ...(layers.runRequest === undefined
      ? {}
      : { runRequest: layers.runRequest }),
  };
}

export function reasoningPolicyFromUnknown(
  value: unknown,
): ProviderReasoningPolicy | undefined {
  return providerReasoningPolicyFromUnknown(value);
}

function compactLayers(
  layers: ProviderReasoningPolicyLayers,
): ProviderReasoningPolicyLayers | undefined {
  return Object.keys(layers).length === 0 ? undefined : layers;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined;
}
