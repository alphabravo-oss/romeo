import { Button } from "@romeo/ui";
import ScanSearch from "lucide-react/dist/esm/icons/scan-search.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Scale from "lucide-react/dist/esm/icons/scale.mjs";
import Telescope from "lucide-react/dist/esm/icons/telescope.mjs";

import type { BaseModel } from "../features/types";
import { useLocale } from "../lib/i18n";
import type { ComposerReasoningMode } from "./composer-reasoning-policy";
import { selectedModelSupportsReasoning } from "./composer-reasoning-policy";
import { ComposerReasoningControl } from "./ComposerReasoningControl";

export function ComposerTurnModeControls({
  agenticRagAvailable,
  agenticRagEnabled,
  agenticRagForced,
  canSend,
  isStreaming,
  models,
  onAgenticRagChange,
  onReasoningModeChange,
  onResearchModeChange,
  onRoutingModeChange,
  onWebSearchChange,
  reasoningMode,
  researchMode,
  routingMode,
  selectedModelId,
  webSearchEnabled,
}: {
  agenticRagAvailable: boolean;
  agenticRagEnabled: boolean;
  agenticRagForced: boolean;
  canSend: boolean;
  isStreaming: boolean;
  models: readonly BaseModel[];
  onAgenticRagChange: (enabled: boolean) => void;
  onReasoningModeChange: (mode: ComposerReasoningMode) => void;
  onResearchModeChange: (mode: "standard" | "deep") => void;
  onRoutingModeChange: (mode: "selected" | "economy") => void;
  onWebSearchChange: (enabled: boolean) => void;
  reasoningMode: ComposerReasoningMode;
  researchMode: "standard" | "deep";
  routingMode: "selected" | "economy";
  selectedModelId: string | undefined;
  webSearchEnabled: boolean;
}) {
  const { t } = useLocale();
  return (
    <>
      <Button
        aria-pressed={routingMode === "economy"}
        aria-label={t("economyRouting")}
        className={`rm-icon-button ${routingMode === "economy" ? "active" : ""}`}
        disabled={!canSend || isStreaming}
        onClick={() =>
          onRoutingModeChange(
            routingMode === "economy" ? "selected" : "economy",
          )
        }
        title={t("economyRoutingHelp")}
        type="button"
      >
        <Scale aria-hidden="true" size={17} />
      </Button>
      <ComposerReasoningControl
        disabled={!canSend || isStreaming}
        mode={reasoningMode}
        modelSupportsReasoning={selectedModelSupportsReasoning(
          models,
          selectedModelId,
        )}
        onChange={onReasoningModeChange}
      />
      <Button
        aria-pressed={webSearchEnabled}
        aria-label={t("search")}
        className={`rm-icon-button ${webSearchEnabled ? "active" : ""}`}
        disabled={!canSend}
        onClick={() => onWebSearchChange(!webSearchEnabled)}
        title={t("search")}
        type="button"
      >
        <Search aria-hidden="true" size={17} />
      </Button>
      <Button
        aria-pressed={researchMode === "deep"}
        aria-label={t("deepResearch")}
        className={`rm-icon-button ${researchMode === "deep" ? "active" : ""}`}
        disabled={!canSend || isStreaming}
        onClick={() =>
          onResearchModeChange(researchMode === "deep" ? "standard" : "deep")
        }
        title={t("deepResearchHelp")}
        type="button"
      >
        <Telescope aria-hidden="true" size={17} />
      </Button>
      {agenticRagAvailable ? (
        <Button
          aria-pressed={agenticRagEnabled}
          aria-label={t("agenticRag")}
          className={`rm-icon-button ${agenticRagEnabled ? "active" : ""}`}
          disabled={!canSend || agenticRagForced}
          onClick={() => onAgenticRagChange(!agenticRagEnabled)}
          title={
            agenticRagForced ? t("agenticRagForcedHelp") : t("agenticRagHelp")
          }
          type="button"
        >
          <ScanSearch aria-hidden="true" size={17} />
        </Button>
      ) : null}
    </>
  );
}
