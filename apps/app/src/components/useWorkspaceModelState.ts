import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";

import { managedModelPreferencesQueryOptions } from "../features/managed-models";
import type { Agent, BaseModel, Message } from "../features/types";
import {
  lastAssistantModelId,
  resolveChatModelSelection,
} from "./chat-model-selection";

export function useWorkspaceModelState(options: {
  activeAgent: Agent | undefined;
  chatModelId: string | undefined;
  defaultModelId: string | undefined;
  lastModelId: string | undefined;
  messages: Message[];
  modelOverrideId: string | undefined;
  models: BaseModel[];
}) {
  const selectedModelId = resolveChatModelSelection({
    assistantModelId: options.activeAgent?.baseModelId,
    chatModelId: options.chatModelId,
    defaultModelId: options.defaultModelId,
    lastModelId: options.lastModelId,
    overrideModelId: options.modelOverrideId,
  });
  const modelDisplayNames = useMemo(
    () =>
      Object.fromEntries(
        options.models.map((model) => [model.id, model.displayName] as const),
      ),
    [options.models],
  );
  const preferencesQuery = useQuery(
    managedModelPreferencesQueryOptions(options.activeAgent?.id),
  );
  return {
    activeVoiceProfileId:
      preferencesQuery.data?.voiceProfileId ??
      options.activeAgent?.voiceProfileId,
    lastReplyModelId: lastAssistantModelId(options.messages),
    modelDisplayNames,
    selectedModelId,
  };
}
