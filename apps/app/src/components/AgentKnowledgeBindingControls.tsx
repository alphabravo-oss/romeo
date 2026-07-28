import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useMemo, useState } from "react";
import { Button } from "@romeo/ui";

import {
  listAgentKnowledgeBindings,
  updateAgentKnowledgeBinding,
} from "../features/managed-models";
import type { KnowledgeBase } from "../features/types";
import type { Agent } from "../features/managed-models";
import { useLocale } from "../lib/i18n";

interface AgentKnowledgeBindingControlsProps {
  activeAgent: Agent | undefined;
  activeKnowledgeBase: KnowledgeBase | undefined;
}

export function AgentKnowledgeBindingControls({
  activeAgent,
  activeKnowledgeBase,
}: AgentKnowledgeBindingControlsProps) {
  const { t } = useLocale();
  const queryClient = useQueryClient();
  const [notice, setNotice] = useState<string>();
  const bindingsQuery = useQuery({
    queryKey: ["agentKnowledgeBindings", activeAgent?.id],
    queryFn: () => listAgentKnowledgeBindings(activeAgent!.id),
    enabled: activeAgent !== undefined,
  });
  const bindings = useMemo(
    () => bindingsQuery.data ?? [],
    [bindingsQuery.data],
  );
  const activeBinding = bindings.find(
    (binding) => binding.knowledgeBaseId === activeKnowledgeBase?.id,
  );
  const updateMutation = useMutation({
    mutationFn: updateAgentKnowledgeBinding,
  });

  async function handleToggle() {
    if (!activeAgent || !activeKnowledgeBase) return;
    const enabled = activeBinding?.enabled !== true;
    const binding = await updateMutation.mutateAsync({
      agentId: activeAgent.id,
      knowledgeBaseId: activeKnowledgeBase.id,
      enabled,
    });
    setNotice(
      t(binding.enabled ? "knowledgeBoundNotice" : "knowledgeDisabledNotice"),
    );
    await queryClient.invalidateQueries({
      queryKey: ["agentKnowledgeBindings", activeAgent.id],
    });
  }

  return (
    <div className="mt-4 grid gap-2 border-t border-border pt-4 text-sm">
      <div className="text-muted">{t("knowledgeAgentBinding")}</div>
      <div className="grid gap-1">
        <span className="break-words">
          {activeAgent?.name ?? t("knowledgeNoAgent")}
        </span>
        <span className="text-muted">
          {t(bindingStateKey(activeBinding?.enabled))}
        </span>
      </div>
      <Button
        disabled={
          !activeAgent || !activeKnowledgeBase || updateMutation.isPending
        }
        onClick={() => void handleToggle()}
        pending={updateMutation.isPending}
      >
        {t(
          activeBinding?.enabled === true
            ? "knowledgeDisableAgent"
            : "knowledgeBindAgent",
        )}
      </Button>
      {notice ? <div className="text-muted">{notice}</div> : null}
    </div>
  );
}

function bindingStateKey(
  enabled: boolean | undefined,
): "knowledgeDisabled" | "knowledgeEnabled" | "knowledgeNotBound" {
  if (enabled === true) return "knowledgeEnabled";
  if (enabled === false) return "knowledgeDisabled";
  return "knowledgeNotBound";
}
