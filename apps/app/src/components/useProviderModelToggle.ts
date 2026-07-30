import { useCallback } from "react";

import type { Agent } from "../features/managed-models/types";
import type { BaseModel } from "../features/providers/types";
import type { MessageKey } from "../lib/i18n";
import type { ConfirmOptions } from "./ConfirmDialog";

export function useProviderModelToggle({
  agents,
  ask,
  onUpdateModel,
  t,
}: {
  agents: Agent[];
  ask: (options: ConfirmOptions) => Promise<boolean>;
  onUpdateModel: (input: {
    modelId: string;
    enabled: boolean;
  }) => Promise<void>;
  t: (
    key: MessageKey,
    values?: Record<string, boolean | number | string>,
  ) => string;
}) {
  return useCallback(
    async (model: BaseModel, enabled: boolean) => {
      const dependents = agents.filter(
        (agent) => agent.baseModelId === model.id,
      );
      if (
        !enabled &&
        dependents.length > 0 &&
        !(await ask({
          title: t("modelDisableImpactTitle"),
          body: t("modelDisableImpactDescription", {
            agents: dependents.length,
            names: dependents
              .slice(0, 5)
              .map((agent) => agent.name)
              .join(", "),
          }),
          confirmLabel: t("disable"),
          tone: "danger",
        }))
      )
        return;
      await onUpdateModel({ modelId: model.id, enabled });
    },
    [agents, ask, onUpdateModel, t],
  );
}
