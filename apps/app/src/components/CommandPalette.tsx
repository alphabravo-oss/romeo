import { Input, Button } from "@romeo/ui";
import { useNavigate } from "@tanstack/react-router";
import { useStore } from "@tanstack/react-store";
import Keyboard from "lucide-react/dist/esm/icons/keyboard.mjs";
import LayoutGrid from "lucide-react/dist/esm/icons/layout-grid.mjs";
import MessageSquare from "lucide-react/dist/esm/icons/message-square.mjs";
import Monitor from "lucide-react/dist/esm/icons/monitor.mjs";
import Moon from "lucide-react/dist/esm/icons/moon.mjs";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import Settings from "lucide-react/dist/esm/icons/settings.mjs";
import Shield from "lucide-react/dist/esm/icons/shield.mjs";
import Sun from "lucide-react/dist/esm/icons/sun.mjs";
import { useEffect, useMemo, useState } from "react";

import { type AppCommand, commandStore } from "../lib/commands";
import { setTheme } from "../lib/theme";
import { useLocale } from "../lib/i18n";
import { OverlayShell } from "./OverlayShell";
import { useWorkspaceData } from "./useWorkspaceData";

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

export function CommandPalette() {
  const { t } = useLocale();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const data = useWorkspaceData(undefined);
  const isAdmin = data.subject?.isAdmin === true;
  // Context-bound actions published by the active screen (e.g. New chat, Switch agent).
  const dynamic = useStore(commandStore);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => void navigate({ to });
    const staticCommands: Command[] = [
      {
        id: "nav-chat",
        group: t("goTo"),
        label: t("chat"),
        icon: MessageSquare,
        run: go("/"),
      },
      {
        id: "nav-ws",
        group: t("goTo"),
        label: t("workspaceSettings"),
        icon: LayoutGrid,
        run: go("/workspace"),
      },
      {
        id: "nav-settings",
        group: t("goTo"),
        label: t("settings"),
        icon: Settings,
        run: go("/settings"),
      },
    ];
    if (isAdmin) {
      staticCommands.push({
        id: "nav-admin",
        group: t("goTo"),
        label: t("adminConsole"),
        icon: Shield,
        run: go("/admin"),
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
    return [...dynamic, ...staticCommands];
  }, [isAdmin, navigate, dynamic, t]);

  const filtered = useMemo(
    () => commands.filter((c) => matches(c.label, query)),
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
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
