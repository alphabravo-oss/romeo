import type { InterfacePreferences } from "./index";

import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import { apiQueryKeys } from "../../lib/api-query-options";
import { completeMutationNetworkRevalidation } from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import { workspaceModelPreferenceMutationOptions } from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  getServerInterfacePreferences: vi.fn(),
  updateServerInterfacePreferences: vi.fn(),
}));

vi.mock("./index", () => mutationMocks);

const preferences = (): InterfacePreferences => ({
  defaultAgentByWorkspace: {},
  defaultModelByWorkspace: {},
  density: "comfortable",
  enterToSend: true,
  fontSize: "medium",
  lastModelByWorkspace: {},
  locale: "en",
  reducedMotion: false,
  showContinueButton: false,
  showFollowUps: false,
  showMessageModelLabel: true,
  showMessageTimestamps: true,
  showRunStatus: true,
  showStarterPrompts: true,
  stickToBottom: true,
  theme: "system",
});

describe("workspace model preference mutation policy", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("does not issue the follow-up write after logout during the read", async () => {
    const client = createRomeoQueryClient();
    let resolvePreferences!: (value: InterfacePreferences) => void;
    mutationMocks.getServerInterfacePreferences.mockReturnValueOnce(
      new Promise<InterfacePreferences>((resolve) => {
        resolvePreferences = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      workspaceModelPreferenceMutationOptions(),
    );
    const mutation = observer.mutate({
      kind: "last",
      modelId: "model-1",
      workspaceId: "workspace-1",
    });
    await vi.waitFor(() =>
      expect(
        mutationMocks.getServerInterfacePreferences,
      ).toHaveBeenCalledOnce(),
    );

    await clearRouteDataForLogout(client);
    client.setQueryData(
      apiQueryKeys.interfacePreferences() as readonly unknown[],
      {
        data: preferences(),
      },
    );
    resolvePreferences(preferences());
    await mutation;

    expect(
      mutationMocks.updateServerInterfacePreferences,
    ).not.toHaveBeenCalled();
    expect(
      client.getQueryState(apiQueryKeys.interfacePreferences())?.isInvalidated,
    ).toBe(false);
  });
});
