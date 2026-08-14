import { apiQueryKeys } from "../../lib/api-query-options";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import { getStoredTheme, setTheme, type Theme } from "../../lib/theme";
import {
  getServerInterfacePreferences,
  type InterfacePreferences,
  updateServerInterfacePreferences,
} from "./index";

export interface WorkspaceModelPreferenceInput {
  kind: "default" | "last";
  modelId: string;
  workspaceId: string;
}

export function workspaceModelPreferenceMutationOptions() {
  return serverMutationOptions({
    resource: "interfacePreferences.workspaceModel.update",
    mutationFn: async ({
      kind,
      modelId,
      workspaceId,
    }: WorkspaceModelPreferenceInput) => {
      const sessionVersion = currentMutationSessionVersion();
      const current = await getServerInterfacePreferences();
      if (sessionVersion !== currentMutationSessionVersion()) return current;
      const key =
        kind === "default" ? "defaultModelByWorkspace" : "lastModelByWorkspace";
      const next = { ...current[key] };
      if (kind === "default" && next[workspaceId] === modelId) {
        delete next[workspaceId];
      } else {
        next[workspaceId] = modelId;
      }
      if (
        kind === "last" &&
        current.lastModelByWorkspace[workspaceId] === modelId
      ) {
        return current;
      }
      return updateServerInterfacePreferences({ [key]: next });
    },
    invalidations: () => [
      { exact: true, queryKey: apiQueryKeys.interfacePreferences() },
    ],
  });
}

export function themePreferenceMutationOptions() {
  return serverMutationOptions<
    Awaited<ReturnType<typeof updateServerInterfacePreferences>>,
    Error,
    Theme,
    Theme
  >({
    resource: "interfacePreferences.theme.update",
    mutationFn: (theme) => updateServerInterfacePreferences({ theme }),
    optimistic: {
      snapshot: getStoredTheme,
      update: (_client, theme) => setTheme(theme),
      rollback: (_client, theme) => setTheme(theme),
    },
    reconcile: (_client, preferences) => {
      if (preferences.theme !== undefined) setTheme(preferences.theme);
    },
    invalidations: () => [
      { exact: true, queryKey: apiQueryKeys.interfacePreferences() },
    ],
  });
}

export function interfacePreferencesPatchMutationOptions() {
  return serverMutationOptions({
    resource: "interfacePreferences.update",
    mutationFn: (input: Partial<InterfacePreferences>) =>
      updateServerInterfacePreferences(input),
    invalidations: () => [
      { exact: true, queryKey: apiQueryKeys.interfacePreferences() },
    ],
  });
}
