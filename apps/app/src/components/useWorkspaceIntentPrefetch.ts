import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { prefetchAuthorizedWorkspaceIntentData } from "../lib/route-intent";
import { useRouterApiClient } from "../lib/router-context";
import { useWorkspace } from "./WorkspaceContext";

export function useWorkspaceIntentPrefetch(): () => void {
  const apiClient = useRouterApiClient();
  const queryClient = useQueryClient();
  const { subject, workspaceId } = useWorkspace();
  return useCallback(() => {
    void prefetchAuthorizedWorkspaceIntentData(
      queryClient,
      apiClient,
      workspaceId,
      subject?.workspaceIds ?? [],
    );
  }, [apiClient, queryClient, subject?.workspaceIds, workspaceId]);
}
