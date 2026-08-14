import { Input, Button } from "@romeo/ui";
import { useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useStore } from "@tanstack/react-store";
import Bot from "lucide-react/dist/esm/icons/bot.mjs";
import FileText from "lucide-react/dist/esm/icons/file-text.mjs";
import Keyboard from "lucide-react/dist/esm/icons/keyboard.mjs";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid.mjs";
import Library from "lucide-react/dist/esm/icons/library.mjs";
import MessageSquare from "lucide-react/dist/esm/icons/message-square.mjs";
import Monitor from "lucide-react/dist/esm/icons/monitor.mjs";
import Moon from "lucide-react/dist/esm/icons/moon.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Settings from "lucide-react/dist/esm/icons/settings.mjs";
import Shield from "lucide-react/dist/esm/icons/shield.mjs";
import Sun from "lucide-react/dist/esm/icons/sun.mjs";
import Workflow from "lucide-react/dist/esm/icons/workflow.mjs";
import Wrench from "lucide-react/dist/esm/icons/wrench.mjs";
import { useEffect, useMemo, useState } from "react";

import { type AppCommand, commandStore } from "../lib/commands";
import { setTheme } from "../lib/theme";
import { useLocale } from "../lib/i18n";
import { OverlayShell } from "./OverlayShell";
import { useWorkspace } from "./WorkspaceContext";
import "../styles/app-content.css";
import {
  commandAgentsQueryOptions,
  commandKnowledgeQueryOptions,
  commandPromptsQueryOptions,
  commandToolsQueryOptions,
  commandWorkflowsQueryOptions,
} from "./command-catalog-query-options";

type Command = AppCommand;

// subsequence match: "opw" matches "Open Workspace"
function matches(label: string, q: string): boolean {
  if (!q) return true;
  const l = label.toLowerCase();
  let i = 0;
  for (const ch of q.toLowerCase()) {
    i = l.indexOf(ch, i);
    if (i === -1) return false;
    i += 1;
  }
  return true;
}

export function CommandPalette({
  initialOpen = false,
}: {
  initialOpen?: boolean;
}) {
  const { t } = useLocale();
  const [open, setOpen] = useState(initialOpen);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { subject, workspace } = useWorkspace();
  const isAdmin = subject?.isAdmin === true;
  // Context-bound actions published by the active screen (e.g. New chat, Switch agent).
  const dynamic = useStore(commandStore);
  const agentsCatalog = useQuery(
    commandAgentsQueryOptions(workspace?.id, open),
  );
  const knowledgeCatalog = useQuery(
    commandKnowledgeQueryOptions(workspace?.id, open),
  );
  const promptsCatalog = useQuery(
    commandPromptsQueryOptions(workspace?.id, open && isAdmin),
  );
  const toolsCatalog = useQuery(
    commandToolsQueryOptions(open && workspace !== undefined),
  );
  const workflowsCatalog = useQuery(
    commandWorkflowsQueryOptions(workspace?.id, open && isAdmin),
  );

  const commands = useMemo<Command[]>(() => {
    const workspaceSearch =
      workspace?.id === undefined ? {} : { workspace: workspace.id };
    const staticCommands: Command[] = [
      {
        id: "nav-chat",
        group: t("goTo"),
        label: t("chat"),
        icon: MessageSquare,
        run: () => void navigate({ search: workspaceSearch, to: "/" }),
      },
      {
        id: "nav-ws",
        group: t("goTo"),
        label: t("workspace"),
        icon: LayoutGrid,
        run: () => void navigate({ search: workspaceSearch, to: "/workspace" }),
      },
      {
        id: "nav-settings",
        group: t("goTo"),
        label: t("settings"),
        icon: Settings,
        run: () => void navigate({ search: workspaceSearch, to: "/settings" }),
      },
    ];
    if (isAdmin) {
      staticCommands.push({
        id: "nav-admin",
        group: t("goTo"),
        label: t("adminConsole"),
        icon: Shield,
        run: () => void navigate({ search: workspaceSearch, to: "/admin" }),
      });
    }
    staticCommands.push(
      {
        id: "theme-system",
        group: t("theme"),
        label: t("useSystemTheme"),
        icon: Monitor,
        run: () => setTheme("system"),
      },
      {
        id: "theme-light",
        group: t("theme"),
        label: t("switchToLight"),
        icon: Sun,
        run: () => setTheme("light"),
      },
      {
        id: "theme-dark",
        group: t("theme"),
        label: t("switchToDark"),
        icon: Moon,
        run: () => setTheme("dark"),
      },
      {
        id: "help-shortcuts",
        group: t("help"),
        label: t("keyboardShortcuts"),
        icon: Keyboard,
        run: () => window.dispatchEvent(new CustomEvent("rm-shortcuts")),
      },
    );
    const catalogCommands: Command[] = [
      ...(agentsCatalog.data ?? []).map((agent) => ({
        id: `catalog-agent-${agent.id}`,
        group: t("catalogAgents"),
        label: agent.name,
        keywords: [agent.description ?? "", "custom model"],
        icon: Bot,
        run: () =>
          void navigate({
            to: "/",
            search: { ...workspaceSearch, agent: agent.id },
          }),
      })),
      ...(knowledgeCatalog.data ?? []).map((base) => ({
        id: `catalog-knowledge-${base.id}`,
        group: t("catalogKnowledge"),
        label: base.name,
        keywords: [base.description ?? "", "knowledge base"],
        icon: Library,
        run: () =>
          void navigate({
            to: "/workspace",
            search: {
              ...workspaceSearch,
              resource: base.id,
              section: "knowledge",
            },
          }),
      })),
      ...(promptsCatalog.data ?? []).map((prompt) => ({
        id: `catalog-prompt-${prompt.id}`,
        group: t("catalogPrompts"),
        label: prompt.name,
        keywords: [prompt.description ?? "", ...(prompt.tags ?? [])],
        icon: FileText,
        run: () =>
          void navigate({
            to: "/admin",
            search: { ...workspaceSearch, section: "prompt-templates" },
          }),
      })),
      ...(toolsCatalog.data ?? []).map((tool) => ({
        id: `catalog-tool-${tool.id}`,
        group: t("catalogTools"),
        label: tool.name,
        keywords: [tool.description ?? "", "tool"],
        icon: Wrench,
        run: () =>
          void navigate({
            to: "/workspace",
            search: { ...workspaceSearch, section: "tools" },
          }),
      })),
      ...(workflowsCatalog.data ?? []).map((workflow) => ({
        id: `catalog-workflow-${workflow.id}`,
        group: t("catalogWorkflows"),
        label: workflow.name,
        keywords: [workflow.description ?? "", "workflow"],
        icon: Workflow,
        run: () =>
          void navigate({
            to: "/admin",
            search: { ...workspaceSearch, section: "workflows" },
          }),
      })),
    ];
    return [...dynamic, ...catalogCommands, ...staticCommands];
  }, [
    agentsCatalog.data,
    dynamic,
    isAdmin,
    knowledgeCatalog.data,
    navigate,
    promptsCatalog.data,
    t,
    toolsCatalog.data,
    workflowsCatalog.data,
    workspace?.id,
  ]);

  const filtered = useMemo(
    () =>
      commands.filter((command) =>
        matches(
          [command.label, command.group, ...(command.keywords ?? [])].join(" "),
          query,
        ),
      ),
    [commands, query],
  );

  // Global ⌘K / Ctrl+K toggle.
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((o) => !o);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    };
    // The console topbar's search affordance opens the same palette. It asks
    // by name rather than synthesising a ⌘K keystroke, so the two entry points
    // stay independent of each other's implementation.
    const onRequest = () => setOpen(true);
    window.addEventListener("keydown", onKey);
    window.addEventListener("romeo:command-palette", onRequest);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("romeo:command-palette", onRequest);
    };
  }, []);

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Radix moves focus into the dialog when it opens.
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  const run = (index: number) => {
    const cmd = filtered[index];
    if (cmd) {
      cmd.run();
      setOpen(false);
    }
  };

  const onInputKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((a) => Math.min(a + 1, filtered.length - 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((a) => Math.max(a - 1, 0));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(active);
    }
  };

  let lastGroup = "";

  return (
    <OverlayShell
      ariaLabel={t("commandPalette")}
      onClose={() => setOpen(false)}
      open={open}
      variant="command"
    >
      <div className="rm-cmdk-input">
        <Search aria-hidden size={16} />
        <Input
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onInputKey}
          placeholder={t("searchCommands")}
          value={query}
        />
        <kbd className="rm-kbd">ESC</kbd>
      </div>
      <div className="rm-cmdk-list">
        {filtered.length === 0 ? (
          <div className="rm-cmdk-empty">{t("noMatchingCommands")}</div>
        ) : (
          filtered.map((cmd, i) => {
            const showGroup = cmd.group !== lastGroup;
            lastGroup = cmd.group;
            const Icon = cmd.icon;
            return (
              <div key={cmd.id}>
                {showGroup ? (
                  <div className="rm-cmdk-group">{cmd.group}</div>
                ) : null}
                <Button
                  className={`rm-cmdk-item ${i === active ? "active" : ""}`}
                  onClick={() => run(i)}
                  onMouseMove={() => setActive(i)}
                  type="button"
                >
                  <Icon aria-hidden size={16} />
                  <span>{cmd.label}</span>
                </Button>
              </div>
            );
          })
        )}
      </div>
    </OverlayShell>
  );
}
