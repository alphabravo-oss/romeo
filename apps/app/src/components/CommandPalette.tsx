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
import { useFocusTrap } from "../lib/use-focus-trap";
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
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const dialogRef = useFocusTrap({ active: open, onEscape: () => setOpen(false) });
  const navigate = useNavigate();
  const data = useWorkspaceData(undefined);
  const isAdmin = data.subject?.isAdmin === true;
  // Context-bound actions published by the active screen (e.g. New chat, Switch agent).
  const dynamic = useStore(commandStore);

  const commands = useMemo<Command[]>(() => {
    const go = (to: string) => () => void navigate({ to });
    const staticCommands: Command[] = [
      { id: "nav-chat", group: "Go to", label: "Chat", icon: MessageSquare, run: go("/") },
      { id: "nav-ws", group: "Go to", label: "Workspace", icon: LayoutGrid, run: go("/workspace") },
      { id: "nav-settings", group: "Go to", label: "Settings", icon: Settings, run: go("/settings") },
    ];
    if (isAdmin) {
      staticCommands.push({ id: "nav-admin", group: "Go to", label: "Admin console", icon: Shield, run: go("/admin") });
    }
    staticCommands.push(
      { id: "theme-system", group: "Theme", label: "Use system theme", icon: Monitor, run: () => setTheme("system") },
      { id: "theme-light", group: "Theme", label: "Switch to light", icon: Sun, run: () => setTheme("light") },
      { id: "theme-dark", group: "Theme", label: "Switch to dark", icon: Moon, run: () => setTheme("dark") },
      {
        id: "help-shortcuts",
        group: "Help",
        label: "Keyboard shortcuts",
        icon: Keyboard,
        run: () => window.dispatchEvent(new CustomEvent("rm-shortcuts")),
      },
    );
    return [...dynamic, ...staticCommands];
  }, [isAdmin, navigate, dynamic]);

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
      // focus is handled by useFocusTrap (focuses the first focusable child, the input)
    }
  }, [open]);

  useEffect(() => setActive(0), [query]);

  if (!open) return null;

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
    <>
      <button
        aria-label="Close command palette"
        className="rm-cmdk-backdrop"
        onClick={() => setOpen(false)}
        type="button"
      />
      <div
        aria-label="Command palette"
        aria-modal="true"
        className="rm-cmdk"
        ref={dialogRef}
        role="dialog"
      >
        <div className="rm-cmdk-input">
          <Search aria-hidden size={16} />
          <input
            onChange={(e) => setQuery(e.currentTarget.value)}
            onKeyDown={onInputKey}
            placeholder="Search commands…"
            value={query}
          />
          <kbd className="rm-kbd">ESC</kbd>
        </div>
        <div className="rm-cmdk-list">
          {filtered.length === 0 ? (
            <div className="rm-cmdk-empty">No matching commands</div>
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
                  <button
                    className={`rm-cmdk-item ${i === active ? "active" : ""}`}
                    onClick={() => run(i)}
                    onMouseMove={() => setActive(i)}
                    type="button"
                  >
                    <Icon aria-hidden size={16} />
                    <span>{cmd.label}</span>
                  </button>
                </div>
              );
            })
          )}
        </div>
      </div>
    </>
  );
}
