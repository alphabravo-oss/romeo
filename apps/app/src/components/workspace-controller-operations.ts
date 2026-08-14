import type { QueryClient } from "@tanstack/react-query";

import { createEvalCaseFromMessageFeedback } from "../features/evals";
import { inspectRunContext } from "../features/chat";
import { apiQueryKeys } from "../lib/api-query-options";
import * as appQueryKeys from "../lib/app-query-keys";
import { invalidateCachedResourceExactly } from "../lib/server-mutation-options";
import type { MessageKey } from "../lib/i18n";
import { toast } from "../lib/toast";
import type { ComposerReasoningMode } from "./composer-reasoning-policy";
import { reasoningPolicyForComposerMode } from "./composer-reasoning-policy";

export function inspectWorkspaceRunContext(input: {
  agentId: string;
  agenticRagEnabled: boolean;
  attachedUrls: string[];
  chatId: string;
  content: string;
  fileIds: string[];
  imageCount: number;
  modelId: string | undefined;
  reasoningMode: ComposerReasoningMode;
  researchMode: "standard" | "deep";
  routingMode: "selected" | "economy";
  webSearchEnabled: boolean;
}) {
  const reasoningPolicy = reasoningPolicyForComposerMode(input.reasoningMode);
  return inspectRunContext({
    agentId: input.agentId,
    chatId: input.chatId,
    content: input.content,
    fileIds: input.fileIds,
    imageCount: input.imageCount,
    ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
    ...(input.routingMode === "economy" ? { routingMode: "economy" } : {}),
    ...(input.researchMode === "deep" ? { researchMode: "deep" } : {}),
    ...(reasoningPolicy === undefined ? {} : { reasoningPolicy }),
    ...(input.webSearchEnabled ? { webSearch: true } : {}),
    ...(input.agenticRagEnabled ? { agenticRag: true } : {}),
    ...(input.attachedUrls.length === 0 ? {} : { urls: input.attachedUrls }),
  });
}

export async function refreshWorkspaceUsageControls(queryClient: QueryClient) {
  await Promise.all([
    invalidateCachedResourceExactly(queryClient, appQueryKeys.usageEvents()),
    invalidateCachedResourceExactly(queryClient, appQueryKeys.usageSummary()),
    invalidateCachedResourceExactly(queryClient, appQueryKeys.usageAlerts()),
    invalidateCachedResourceExactly(
      queryClient,
      apiQueryKeys.providerOperationalSummary(),
    ),
    invalidateCachedResourceExactly(queryClient, appQueryKeys.quotas()),
  ]);
}

export async function createFeedbackEvalCase(input: {
  agentId: string;
  chatId: string;
  messageId: string;
  t: (key: MessageKey) => string;
}) {
  try {
    const result = await createEvalCaseFromMessageFeedback(input);
    toast(
      result.created
        ? input.t("feedbackEvalCreated")
        : input.t("feedbackEvalExists"),
      "success",
    );
  } catch {
    toast(input.t("feedbackEvalCreateFailed"), "error");
  }
}
