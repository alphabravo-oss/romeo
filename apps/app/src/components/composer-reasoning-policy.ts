import type { ReasoningPolicyV1 } from "@romeo/api-client/generated/sdk";

import type { BaseModel } from "../features/types";

export type ComposerReasoningMode =
  | "default"
  | "off"
  | "automatic"
  | "low"
  | "medium"
  | "high";

export function reasoningPolicyForComposerMode(
  mode: ComposerReasoningMode,
): ReasoningPolicyV1 | undefined {
  if (mode === "default") return undefined;
  if (mode === "off") return { mode: "off", schemaVersion: 1 };
  if (mode === "automatic") return { mode: "auto", schemaVersion: 1 };
  return {
    effort: mode,
    mode: "auto",
    schemaVersion: 1,
  };
}

export function selectedModelSupportsReasoning(
  models: readonly BaseModel[],
  selectedModelId: string | undefined,
): boolean {
  const model = models.find((candidate) => candidate.id === selectedModelId);
  return (
    model?.enabled === true &&
    model.available !== false &&
    model.capabilities.reasoning === true
  );
}

export function reasoningModeFromPolicy(
  policy: ReasoningPolicyV1 | undefined,
): ComposerReasoningMode {
  if (policy === undefined) return "default";
  if (policy.mode === "off") return "off";
  if (policy.effort === undefined) return "automatic";
  return policy.effort;
}
