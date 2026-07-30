import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import { Button, DropdownMenuPrimitive } from "@romeo/ui";
import { lazy, Suspense } from "react";

import type { AgentGalleryItem } from "../features/managed-models";
import { useLocale } from "../lib/i18n";

const ModelSelectorMenu = lazy(() => import("./ModelSelectorMenu"));

/** Governed managed-model selector backed by Radix menu semantics. */
export function ModelSelector({
  activeAgentId,
  activeAgentName,
  agents,
  onSelectAgent,
  workspaceId,
}: {
  activeAgentId: string | undefined;
  activeAgentName: string;
  agents: AgentGalleryItem[];
  onSelectAgent: (agentId: string) => void;
  workspaceId: string | undefined;
}) {
  const { t } = useLocale();

  return (
    <DropdownMenuPrimitive.Root>
      <DropdownMenuPrimitive.Trigger asChild>
        <Button className="rm-model-select" variant="ghost">
          <span>{activeAgentName}</span>
          <ChevronDown aria-hidden="true" size={12} strokeWidth={2.5} />
        </Button>
      </DropdownMenuPrimitive.Trigger>
      <DropdownMenuPrimitive.Portal>
        <DropdownMenuPrimitive.Content
          align="start"
          aria-label={t("shellSwitchAgent")}
          className="rm-ui-menu rm-model-menu rm-assistant-menu"
        >
          <Suspense fallback={null}>
            <ModelSelectorMenu
              activeAgentId={activeAgentId}
              agents={agents}
              onSelectAgent={onSelectAgent}
              workspaceId={workspaceId}
            />
          </Suspense>
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
