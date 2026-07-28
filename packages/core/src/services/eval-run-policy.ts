import type { AuthSubject } from "@romeo/auth";

import type { EvalCase, ProviderInstance } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { consumeQuota } from "./consume-quota";
import type { QuotaCoordinator } from "./quota-coordination";
import type { WebhookEmitter } from "./webhook-service";

export async function assertEvalRunAllowed(input: {
  repository: RomeoRepository;
  subject: AuthSubject;
  agent: { id: string; workspaceId: string };
  provider: ProviderInstance;
  cases: EvalCase[];
  quotaCoordinator?: QuotaCoordinator;
  webhooks?: WebhookEmitter;
}): Promise<void> {
  await assertAbuseControlsAllow(input.repository, input.subject, {
    action: "eval.run",
    agentId: input.agent.id,
    providerId: input.provider.id,
    workspaceId: input.agent.workspaceId,
  });
  await consumeQuota(
    input.repository,
    input.subject,
    {
      agentId: input.agent.id,
      metric: "run.started",
      providerId: input.provider.id,
      quantity: input.cases.length,
      workspaceId: input.agent.workspaceId,
    },
    {
      quotaCoordinator: input.quotaCoordinator,
      webhooks: input.webhooks,
    },
  );
}
