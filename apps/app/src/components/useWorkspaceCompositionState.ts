import { useQuery } from "@tanstack/react-query";
import { useState } from "react";

import { agenticRagSettingsQueryOptions } from "../features/knowledge";
import type { SpeechArtifact } from "../features/types";
import type { ComposerReasoningMode } from "./composer-reasoning-policy";

export function useWorkspaceCompositionState(requestedAgentId?: string) {
  const [activeAgentId, setActiveAgentId] = useState<string | undefined>(
    requestedAgentId,
  );
  const [activeChatId, setActiveChatId] = useState<string | undefined>();
  const [isDraftingNewChat, setIsDraftingNewChat] = useState(false);
  const [webSearchEnabled, setWebSearchEnabled] = useState(false);
  const [routingMode, setRoutingMode] = useState<"selected" | "economy">(
    "selected",
  );
  const [researchMode, setResearchMode] = useState<"standard" | "deep">(
    "standard",
  );
  const [reasoningMode, setReasoningMode] =
    useState<ComposerReasoningMode>("default");
  const [agenticRagRequested, setAgenticRagRequested] = useState(false);
  const agenticSettingsQuery = useQuery(agenticRagSettingsQueryOptions());
  const agenticRagAvailable = agenticSettingsQuery.data?.enabled === true;
  const agenticRagForced =
    agenticRagAvailable && agenticSettingsQuery.data?.userMode === "required";
  const [knowledgeBaseIdsOverride, setKnowledgeBaseIdsOverride] = useState<
    string[] | undefined
  >();
  const [attachedUrls, setAttachedUrls] = useState<string[]>([]);
  const [temporaryNextChat, setTemporaryNextChat] = useState(false);
  const [modelOverrideId, setModelOverrideId] = useState<string>();
  const [speechArtifacts, setSpeechArtifacts] = useState<
    Record<string, SpeechArtifact>
  >({});

  return {
    activeAgentId,
    activeChatId,
    agenticRagAvailable,
    agenticRagEnabled: agenticRagForced || agenticRagRequested,
    agenticRagForced,
    attachedUrls,
    isDraftingNewChat,
    knowledgeBaseIdsOverride,
    modelOverrideId,
    reasoningMode,
    researchMode,
    routingMode,
    setActiveAgentId,
    setActiveChatId,
    setAgenticRagRequested,
    setAttachedUrls,
    setIsDraftingNewChat,
    setKnowledgeBaseIdsOverride,
    setModelOverrideId,
    setReasoningMode,
    setResearchMode,
    setRoutingMode,
    setSpeechArtifacts,
    setTemporaryNextChat,
    setWebSearchEnabled,
    speechArtifacts,
    temporaryNextChat,
    webSearchEnabled,
  };
}
