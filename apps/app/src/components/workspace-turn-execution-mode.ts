import { reasoningPolicyForComposerMode } from "./composer-reasoning-policy";
import type { ComposerReasoningMode } from "./composer-reasoning-policy";

export function workspaceTurnExecutionMode(options: {
  reasoningMode: ComposerReasoningMode;
  researchMode: "standard" | "deep";
  routingMode: "selected" | "economy";
}) {
  const reasoningPolicy = reasoningPolicyForComposerMode(options.reasoningMode);
  return {
    ...(options.routingMode === "economy"
      ? { routingMode: "economy" as const }
      : {}),
    ...(options.researchMode === "deep"
      ? { researchMode: "deep" as const }
      : {}),
    ...(reasoningPolicy === undefined ? {} : { reasoningPolicy }),
  };
}
