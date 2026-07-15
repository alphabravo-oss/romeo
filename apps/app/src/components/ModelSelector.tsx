import Check from "lucide-react/dist/esm/icons/check.mjs";
import ChevronDown from "lucide-react/dist/esm/icons/chevron-down.mjs";
import Plus from "lucide-react/dist/esm/icons/plus.mjs";
import { useEffect, useRef, useState } from "react";

import type { Agent } from "../api/types";

/**
 * Open WebUI-style model selector: the trigger is the top-bar assistant name;
 * clicking it opens a dropdown listing agents to switch between. Agents are
 * Romeo's equivalent of OWUI's custom models.
 */
export function ModelSelector({
  activeAgentId,
  activeAgentName,
  agents,
  isCloning,
  onCloneAgent,
  onSelectAgent,
  workspaceName,
}: {
  activeAgentId: string | undefined;
  activeAgentName: string;
  agents: Agent[];
  isCloning: boolean;
  onCloneAgent: () => void;
  onSelectAgent: (agentId: string) => void;
  workspaceName: string;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (event: MouseEvent) => {
      if (!ref.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  return (
    <div className="rm-model-selector" ref={ref}>
      <button
        aria-expanded={open}
        aria-haspopup="listbox"
        className="rm-model-select"
        onClick={() => setOpen((o) => !o)}
        type="button"
      >
        <span>
          {activeAgentName}
          <ChevronDown aria-hidden="true" size={12} strokeWidth={2.5} />
        </span>
        <small>{workspaceName}</small>
      </button>

      {open ? (
        <div className="rm-model-menu" role="listbox">
          {agents.map((agent) => (
            <button
              aria-selected={agent.id === activeAgentId}
              className="rm-model-option"
              key={agent.id}
              onClick={() => {
                onSelectAgent(agent.id);
                setOpen(false);
              }}
              role="option"
              type="button"
            >
              <span className="truncate">{agent.name}</span>
              {agent.id === activeAgentId ? (
                <Check aria-hidden="true" size={16} />
              ) : null}
            </button>
          ))}
          <div className="rm-model-menu-divider" />
          <button
            className="rm-model-option"
            disabled={agents.length === 0 || isCloning}
            onClick={() => onCloneAgent()}
            type="button"
          >
            <Plus aria-hidden="true" size={16} />
            <span>{isCloning ? "Cloning agent…" : "Clone current agent"}</span>
          </button>
        </div>
      ) : null}
    </div>
  );
}
