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
import Wrench from "lucide-react/dist/esm/icons/wrench.mjs";
import { useEffect, useId, useMemo, useState } from "react";

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
  onOpenChange,
  open,
}: {
  onOpenChange: (open: boolean) => void;
  open: boolean;
}) {
  const { t } = useLocale();
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const inputId = useId();
  const listboxId = useId();
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

  useEffect(() => {
    if (open) {
      setQuery("");
      setActive(0);
      // Radix moves focus into the dialog when it opens.
    }
  }, [open]);

  useEffect(() => setActive(firstEnabledIndex(filtered)), [filtered]);

  const run = (index: number) => {
    const cmd = filtered[index];
    if (cmd && cmd.disabled !== true) {
      cmd.run();
      onOpenChange(false);
    }
  };

  const onInputKey = (event: React.KeyboardEvent) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActive((current) => nextEnabledIndex(filtered, current, 1));
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActive((current) => nextEnabledIndex(filtered, current, -1));
    } else if (event.key === "Home") {
      event.preventDefault();
      setActive(firstEnabledIndex(filtered));
    } else if (event.key === "End") {
      event.preventDefault();
      setActive(lastEnabledIndex(filtered));
    } else if (event.key === "Enter") {
      event.preventDefault();
      run(active);
    }
  };

  const catalogQueries = [
    agentsCatalog,
    knowledgeCatalog,
    promptsCatalog,
    toolsCatalog,
  ];
  const catalogLoading = catalogQueries.some((catalog) => catalog.isFetching);
  const catalogError = catalogQueries.some((catalog) => catalog.isError);
  const status = catalogLoading
    ? t("tableLoading")
    : catalogError
      ? t("tableError")
      : `${filtered.length} ${t("tableResults")}`;
  const activeCommand = filtered[active];

  let lastGroup = "";

  return (
    <OverlayShell
      ariaLabel={t("commandPalette")}
      onClose={() => onOpenChange(false)}
      open={open}
      variant="command"
    >
      <div className="rm-cmdk-input">
        <Search aria-hidden size={16} />
        <Input
          aria-activedescendant={
            activeCommand === undefined
              ? undefined
              : `${listboxId}-option-${activeCommand.id}`
          }
          aria-autocomplete="list"
          aria-controls={listboxId}
          aria-expanded={open}
          aria-label={t("searchCommands")}
          autoComplete="off"
          autoFocus
          id={inputId}
          name="command-search"
          onChange={(e) => setQuery(e.currentTarget.value)}
          onKeyDown={onInputKey}
          placeholder={t("searchCommands")}
          role="combobox"
          value={query}
        />
        <kbd className="rm-kbd">ESC</kbd>
      </div>
      <div aria-live="polite" className="sr-only" role="status">
        {status}
      </div>
      {catalogError ? (
        <div className="rm-cmdk-empty" role="alert">
          <span>{t("tableError")}</span>{" "}
          <Button
            onClick={() => {
              for (const catalog of catalogQueries) {
                if (catalog.isError) void catalog.refetch();
              }
            }}
            size="sm"
            type="button"
            variant="secondary"
          >
            {t("tableRetry")}
          </Button>
        </div>
      ) : null}
      <div
        aria-label={t("commandPalette")}
        className="rm-cmdk-list"
        id={listboxId}
        role="listbox"
      >
        {filtered.length === 0 ? (
          <div
            aria-disabled="true"
            aria-selected="false"
            className="rm-cmdk-empty"
            role="option"
          >
            {t("noMatchingCommands")}
          </div>
        ) : (
          filtered.map((cmd, i) => {
            const showGroup = cmd.group !== lastGroup;
            lastGroup = cmd.group;
            const Icon = cmd.icon;
            return (
              <div aria-label={cmd.group} key={cmd.id} role="group">
                {showGroup ? (
                  <div className="rm-cmdk-group">{cmd.group}</div>
                ) : null}
                <Button
                  aria-selected={i === active}
                  className={`rm-cmdk-item ${i === active ? "active" : ""}`}
                  disabled={cmd.disabled}
                  id={`${listboxId}-option-${cmd.id}`}
                  onClick={() => run(i)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseMove={() => {
                    if (cmd.disabled !== true) setActive(i);
                  }}
                  role="option"
                  tabIndex={-1}
                  type="button"
                  variant="ghost"
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

function firstEnabledIndex(commands: readonly Command[]): number {
  const index = commands.findIndex((command) => command.disabled !== true);
  return Math.max(index, 0);
}

function lastEnabledIndex(commands: readonly Command[]): number {
  for (let index = commands.length - 1; index >= 0; index -= 1) {
    if (commands[index]?.disabled !== true) return index;
  }
  return 0;
}

function nextEnabledIndex(
  commands: readonly Command[],
  current: number,
  direction: 1 | -1,
): number {
  if (commands.length === 0) return 0;
  for (let offset = 1; offset <= commands.length; offset += 1) {
    const index =
      (current + direction * offset + commands.length) % commands.length;
    if (commands[index]?.disabled !== true) return index;
  }
  return current;
}
