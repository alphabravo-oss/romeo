import {
  translateProviderChatParameters,
  type TranslatedProviderChatParameters,
} from "@romeo/providers";

import type {
  ExecuteRunInput,
  ProviderFallbackTarget,
} from "./run-executor-types";

export function resolveRunProviderChatParameters(
  input: ExecuteRunInput,
  target: ProviderFallbackTarget,
): TranslatedProviderChatParameters {
  return translateProviderChatParameters({
    kind: target.adapter.kind,
    model: target.model,
    provider: target.provider,
    ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
    ...(input.reasoningPolicy === undefined
      ? {}
      : { reasoningPolicy: input.reasoningPolicy }),
    ...(input.sampling === undefined ? {} : { sampling: input.sampling }),
    ...(input.structuredOutput === undefined
      ? {}
      : { structuredOutput: input.structuredOutput }),
    ...(input.tools === undefined ? {} : { tools: input.tools }),
  });
}

export async function resolveRunProviderChatParametersAtAttempt(
  input: ExecuteRunInput,
  target: ProviderFallbackTarget,
): Promise<TranslatedProviderChatParameters> {
  const reasoningPolicy =
    input.reasoningPolicyResolver === undefined
      ? input.reasoningPolicy
      : await input.reasoningPolicyResolver(target);
  return translateProviderChatParameters({
    kind: target.adapter.kind,
    model: target.model,
    provider: target.provider,
    ...(input.reasoning === undefined ? {} : { reasoning: input.reasoning }),
    ...(reasoningPolicy === undefined ? {} : { reasoningPolicy }),
    ...(input.sampling === undefined ? {} : { sampling: input.sampling }),
    ...(input.structuredOutput === undefined
      ? {}
      : { structuredOutput: input.structuredOutput }),
    ...(input.tools === undefined ? {} : { tools: input.tools }),
  });
}
