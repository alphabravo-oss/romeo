import { useMemo } from "react";

import type { AgentGalleryItem } from "../features/managed-models";
import type { BaseModel, Provider } from "../features/types";
import { isGenericCustomModelName } from "./chat-enterprise";
import {
  modelMatchesCapabilityFilter,
  modelSupportsTurnRequirements,
  turnRequirementInput,
  type ModelCapabilityFilter,
} from "./composer-model-capability-filter";
import { modelUnitCost } from "./composer-model-picker-options";

export function useComposerModelOptions(input: {
  models: BaseModel[];
  providers: Provider[];
  customModels: AgentGalleryItem[];
  query: string;
  capabilityFilter: ModelCapabilityFilter;
  pinnedIds: Set<string>;
  requiresReasoning: boolean;
  requiresVision: boolean;
  requiresTools?: boolean;
  requiresLocalOnly?: boolean;
  minContextWindow?: number;
}) {
  const enabledProviderIds = useMemo(
    () =>
      new Set(
        input.providers
          .filter((provider) => provider.enabled)
          .map((provider) => provider.id),
      ),
    [input.providers],
  );
  const enabledModels = useMemo(
    () =>
      input.models.filter(
        (model) =>
          model.enabled &&
          model.available !== false &&
          enabledProviderIds.has(model.providerId),
      ),
    [enabledProviderIds, input.models],
  );
  const requirements = turnRequirementInput({
    reasoning: input.requiresReasoning,
    vision: input.requiresVision,
    tools: input.requiresTools,
    localOnly: input.requiresLocalOnly,
    minContextWindow: input.minContextWindow,
  });
  const readyCustomModels = useMemo(
    () =>
      input.customModels.filter(
        (agent) =>
          agent.readinessStatus === "ready" &&
          !isGenericCustomModelName(agent.name),
      ),
    [input.customModels],
  );
  const filteredModels = useMemo(() => {
    const normalizedQuery = input.query.trim().toLowerCase();
    return enabledModels
      .filter((model) => modelSupportsTurnRequirements(model, requirements))
      .filter((model) =>
        modelMatchesCapabilityFilter(model, input.capabilityFilter),
      )
      .filter((model) =>
        `${model.displayName} ${model.name} ${model.providerId}`
          .toLowerCase()
          .includes(normalizedQuery),
      )
      .sort((left, right) => {
        const pinDifference =
          Number(input.pinnedIds.has(right.id)) -
          Number(input.pinnedIds.has(left.id));
        return (
          pinDifference ||
          (input.capabilityFilter === "economy"
            ? modelUnitCost(left) - modelUnitCost(right)
            : left.displayName.localeCompare(right.displayName))
        );
      });
  }, [
    enabledModels,
    input.capabilityFilter,
    input.pinnedIds,
    input.query,
    requirements,
  ]);
  const filteredCustomModels = useMemo(() => {
    const normalizedQuery = input.query.trim().toLowerCase();
    return readyCustomModels.filter((agent) => {
      const base = enabledModels.find((model) => model.id === agent.baseModelId);
      if (!modelSupportsTurnRequirements(base, requirements)) return false;
      if (!modelMatchesCapabilityFilter(base, input.capabilityFilter))
        return false;
      return `${agent.name} ${agent.description ?? ""} ${base?.displayName ?? ""}`
        .toLowerCase()
        .includes(normalizedQuery);
    });
  }, [
    enabledModels,
    input.capabilityFilter,
    input.query,
    readyCustomModels,
    requirements,
  ]);
  return {
    enabledModels,
    filteredCustomModels,
    filteredModels,
    readyCustomModels,
  };
}
