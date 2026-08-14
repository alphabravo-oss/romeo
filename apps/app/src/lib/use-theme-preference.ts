import { useMutation } from "@tanstack/react-query";

import { themePreferenceMutationOptions } from "../features/interface-preferences/mutation-options";
import type { Theme } from "./theme";

/** Apply a theme immediately and persist the same choice to the user profile. */
export function useThemePreference() {
  const mutation = useMutation(themePreferenceMutationOptions());

  function updateTheme(theme: Theme): void {
    mutation.mutate(theme);
  }

  return {
    updateTheme,
    isError: mutation.isError,
    isPending: mutation.isPending,
  };
}
