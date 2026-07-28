import { useMutation, useQueryClient } from "@tanstack/react-query";

import { updateServerInterfacePreferences } from "../features/interface-preferences";
import { setTheme, type Theme } from "./theme";

/** Apply a theme immediately and persist the same choice to the user profile. */
export function useThemePreference() {
  const queryClient = useQueryClient();
  const mutation = useMutation({
    mutationFn: (theme: Theme) => updateServerInterfacePreferences({ theme }),
    onSuccess: (preferences) => {
      queryClient.setQueryData(["interfacePreferences"], preferences);
    },
  });

  function updateTheme(theme: Theme): void {
    setTheme(theme);
    mutation.mutate(theme);
  }

  return {
    updateTheme,
    isError: mutation.isError,
    isPending: mutation.isPending,
  };
}
