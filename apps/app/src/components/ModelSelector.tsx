import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import { Button, DropdownMenuPrimitive } from "@romeo/ui";

import type { Agent } from "../features/managed-models";
import { useLocale } from "../lib/i18n";

/** Governed managed-model selector backed by Radix menu semantics. */
export function ModelSelector({
  activeAgentId,
  activeAgentName,
  agents,
  canClone,
  isCloning,
  onCloneAgent,
  onSelectAgent,
}: {
  activeAgentId: string | undefined;
  activeAgentName: string;
  agents: Agent[];
  canClone: boolean;
  isCloning: boolean;
  onCloneAgent: () => void;
  onSelectAgent: (agentId: string) => void;
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
          className="rm-ui-menu rm-model-menu"
        >
          <DropdownMenuPrimitive.RadioGroup
            onValueChange={onSelectAgent}
            {...(activeAgentId ? { value: activeAgentId } : {})}
          >
            {agents.map((agent) => (
              <DropdownMenuPrimitive.RadioItem
                className="rm-ui-menu__item rm-model-option"
                key={agent.id}
                value={agent.id}
              >
                <span className="truncate">{agent.name}</span>
                <DropdownMenuPrimitive.ItemIndicator>
                  <Check aria-hidden="true" size={16} />
                </DropdownMenuPrimitive.ItemIndicator>
              </DropdownMenuPrimitive.RadioItem>
            ))}
          </DropdownMenuPrimitive.RadioGroup>
          {canClone ? (
            <>
              <DropdownMenuPrimitive.Separator className="rm-ui-separator" />
              <DropdownMenuPrimitive.Item
                className="rm-ui-menu__item rm-model-option"
                disabled={agents.length === 0 || isCloning}
                onSelect={onCloneAgent}
              >
                <Plus aria-hidden="true" size={16} />
                <span>
                  {isCloning
                    ? t("shellCloningAgent")
                    : t("shellCloneCurrentAgent")}
                </span>
              </DropdownMenuPrimitive.Item>
            </>
          ) : null}
        </DropdownMenuPrimitive.Content>
      </DropdownMenuPrimitive.Portal>
    </DropdownMenuPrimitive.Root>
  );
}
