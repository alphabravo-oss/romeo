import type { BaseModel } from "../features/types";

export type ModelCapabilityFilter =
  | "all"
  | "economy"
  | "reasoning"
  | "tools"
  | "vision";

export function modelMatchesCapabilityFilter(
  model: BaseModel | undefined,
  filter: ModelCapabilityFilter,
): boolean {
  if (model === undefined) return filter === "all";
  switch (filter) {
    case "economy":
      return model.pricing !== undefined;
    case "reasoning":
      return model.capabilities.reasoning;
    case "tools":
      return model.capabilities.toolCalling;
    case "vision":
      return model.capabilities.vision;
    default:
      return true;
  }
}

export function turnRequirementInput(input: {
  reasoning: boolean;
  vision: boolean;
  tools?: boolean;
  localOnly?: boolean;
  minContextWindow?: number;
}) {
  return {
    reasoning: input.reasoning,
    vision: input.vision,
    ...(input.tools === true ? { tools: true } : {}),
    ...(input.localOnly === true ? { localOnly: true } : {}),
    ...(input.minContextWindow === undefined
      ? {}
      : { minContextWindow: input.minContextWindow }),
  };
}

export function modelSupportsTurnRequirements(
  model: BaseModel | undefined,
  requirements: {
    reasoning: boolean;
    vision: boolean;
    tools?: boolean;
    imageOutput?: boolean;
    localOnly?: boolean;
    minContextWindow?: number;
  },
): boolean {
  return (
    model !== undefined &&
    (!requirements.reasoning || model.capabilities.reasoning) &&
    (!requirements.vision || model.capabilities.vision) &&
    (requirements.tools !== true || model.capabilities.toolCalling) &&
    (requirements.imageOutput !== true ||
      model.capabilities.imageGeneration === true) &&
    (requirements.localOnly !== true ||
      model.capabilities.deployment.mode === "local-runtime") &&
    (requirements.minContextWindow === undefined ||
      model.contextWindow >= requirements.minContextWindow)
  );
}
