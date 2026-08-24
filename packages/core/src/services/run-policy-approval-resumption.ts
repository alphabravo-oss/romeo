import type { ChatMessage } from "@romeo/providers";

import type { BackgroundJob, RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import {
  createProviderRoutePlan,
  type ProviderRoutingPolicy,
} from "./provider-routing";
import type { RunAccessService } from "./run-access-service";
import type { RunExecutionStateService } from "./run-execution-state-service";
import type { RunStreamingExecutionInput } from "./run-streaming-execution-service";

export async function resumeContentPolicyApprovedRun(input: {
  repository: RomeoRepository;
  executionState: RunExecutionStateService;
  access: RunAccessService;
  routingPolicy: ProviderRoutingPolicy;
  execute: (execution: RunStreamingExecutionInput) => void;
  job: BackgroundJob;
  run: RunRecord;
}): Promise<void> {
  const checkpoint = await input.executionState.readCheckpoint(input.job);
  if (input.run.status !== "running" || checkpoint === undefined) return;
  const [model, provider] = await Promise.all([
    input.repository.getModel(input.run.modelId),
    input.repository.getProvider(input.run.providerId),
  ]);
  if (model === undefined || provider === undefined) return;
  const subject = await input.access.subjectFromSnapshot({
    orgId: input.run.orgId,
    workspaceId: input.run.workspaceId,
    principalId: checkpoint.principalId,
    principalType: checkpoint.principalType,
    scopeSnapshot: checkpoint.scopeSnapshot,
  });
  const routePlan = await createProviderRoutePlan(
    input.repository,
    input.routingPolicy,
    { model, provider },
  );
  const messages: ChatMessage[] =
    checkpoint.assistantContent.length === 0
      ? checkpoint.messages
      : [
          ...checkpoint.messages,
          { role: "assistant", content: checkpoint.assistantContent },
        ];
  input.execute({
    run: input.run,
    messages,
    provider,
    model,
    citations: checkpoint.citations,
    routePlan,
    providerTools: checkpoint.providerTools,
    subject,
    assistantContentPrefix: checkpoint.assistantContent,
    emitRunStarted: false,
    ...(checkpoint.sampling === undefined
      ? {}
      : { sampling: checkpoint.sampling }),
    ...(checkpoint.reasoning === undefined
      ? {}
      : { reasoning: checkpoint.reasoning }),
    ...(checkpoint.reasoningPolicy === undefined
      ? {}
      : { reasoningPolicy: checkpoint.reasoningPolicy }),
    ...(checkpoint.structuredOutput === undefined
      ? {}
      : { structuredOutput: checkpoint.structuredOutput }),
  });
}
