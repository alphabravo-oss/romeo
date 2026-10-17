import { useNavigate } from "@tanstack/react-router";
import { useCallback } from "react";

import type { AgentStudioTab } from "./agent-studio-model";

export function useAdminDetailNavigation() {
  const navigate = useNavigate({ from: "/admin" });
  const updateManagedModelSearch = useCallback(
    (managedModel: string | null) =>
      void navigate({
        search: (previous) => {
          const {
            managedModel: _managedModel,
            managedModelTab: _managedModelTab,
            ...rest
          } = previous;
          return {
            ...rest,
            section: "providers",
            view: "curated",
            ...(managedModel ? { managedModel } : {}),
          };
        },
      }),
    [navigate],
  );
  const updateManagedModelTab = useCallback(
    (managedModelTab: AgentStudioTab) =>
      void navigate({
        search: (previous) => ({
          ...previous,
          section: "providers",
          view: "curated",
          managedModelTab,
        }),
      }),
    [navigate],
  );
  const updateProviderConnectionSearch = useCallback(
    (connection: string | null) =>
      void navigate({
        search: {
          section: "providers",
          view: "providers",
          ...(connection ? { connection } : {}),
        },
      }),
    [navigate],
  );
  const updateToolConnectorSearch = useCallback(
    (toolConnector: string | null) =>
      void navigate({
        search: (previous) => {
          const { toolConnector: _toolConnector, ...rest } = previous;
          return {
            ...rest,
            section: "connections",
            ...(toolConnector ? { toolConnector } : {}),
          };
        },
      }),
    [navigate],
  );
  return {
    updateManagedModelSearch,
    updateManagedModelTab,
    updateProviderConnectionSearch,
    updateToolConnectorSearch,
  };
}
