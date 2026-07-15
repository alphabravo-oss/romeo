import { Store } from "@tanstack/store";
import type { ComponentType } from "react";
import { useEffect } from "react";

export interface AppCommand {
  id: string;
  group: string;
  label: string;
  icon: ComponentType<{ size?: number; "aria-hidden"?: boolean }>;
  run: () => void;
}

/**
 * Global registry of context-bound commands (e.g. "New chat", "Switch agent").
 * A mounted screen publishes its actions here; the command palette reads them,
 * so ⌘K can trigger controller-bound behavior it otherwise couldn't reach.
 */
export const commandStore = new Store<AppCommand[]>([]);

export function useRegisterCommands(commands: AppCommand[]): void {
  useEffect(() => {
    commandStore.setState(() => commands);
    return () => commandStore.setState(() => []);
  }, [commands]);
}
