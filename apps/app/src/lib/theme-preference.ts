import type { Theme } from "./theme";

// The settings query may refetch after a local theme change. Only the first
// resolved server value is allowed to seed local state; later refetches must
// not make the interface appear to change theme by itself.
export function resolveThemeSelection(input: {
  serverTheme: Theme | undefined;
  localTheme: Theme;
  hasSeeded: boolean;
}): Theme {
  return !input.hasSeeded && input.serverTheme !== undefined
    ? input.serverTheme
    : input.localTheme;
}
