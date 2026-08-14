// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ConnectivityStatus } from "./ConnectivityStatus";

const state = vi.hoisted(() => ({
  apiClient: {},
  online: false,
  queryClient: {},
  releaseRuns: vi.fn(),
  revalidate: vi.fn<() => Promise<void>>(),
}));

vi.mock("../lib/connectivity", () => ({
  markMutationNetworkOffline: vi.fn(),
  useOnlineStatus: () => state.online,
}));
vi.mock("../lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
vi.mock("../lib/reconnect-policy", () => ({
  revalidateAfterReconnect: () => state.revalidate(),
}));
vi.mock("../lib/router-context", () => ({
  useRouterApiClient: () => state.apiClient,
}));
vi.mock("../lib/run-registry", () => ({
  markActiveRunsOffline: vi.fn(),
  releaseActiveRunsAfterReconnect: state.releaseRuns,
}));
vi.mock("@tanstack/react-query", () => ({
  useQueryClient: () => state.queryClient,
}));
vi.mock("./WorkspaceContext", () => ({
  useWorkspace: () => ({
    chatSyncStatus: "connected",
    workspaceId: "workspace-1",
  }),
}));

let container: HTMLDivElement;
let root: Root;
const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

beforeEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  state.online = false;
  state.releaseRuns.mockReset();
  state.revalidate.mockReset();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("ConnectivityStatus", () => {
  it("labels cached offline data and announces validated reconnect without a toast", async () => {
    let finishRevalidation!: () => void;
    state.revalidate.mockReturnValue(
      new Promise<void>((resolve) => {
        finishRevalidation = resolve;
      }),
    );
    act(() => root.render(<ConnectivityStatus />));

    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "cachedDataLabel",
    );

    state.online = true;
    act(() => root.render(<ConnectivityStatus />));
    expect(container.textContent).toContain("reconnectRevalidating");
    expect(state.revalidate).toHaveBeenCalledOnce();
    expect(state.releaseRuns).not.toHaveBeenCalled();

    await act(async () => {
      finishRevalidation();
      await state.revalidate.mock.results[0]?.value;
    });
    expect(container.querySelector('[role="status"]')?.textContent).toContain(
      "reconnectedValidated",
    );
    expect(state.releaseRuns).toHaveBeenCalledOnce();
  });

  it("keeps active runs suspended when reconnect validation fails", async () => {
    state.revalidate.mockRejectedValue(new Error("session expired"));
    act(() => root.render(<ConnectivityStatus />));

    state.online = true;
    await act(async () => {
      root.render(<ConnectivityStatus />);
      await Promise.resolve();
    });

    expect(container.textContent).toContain("reconnectValidationFailed");
    expect(state.releaseRuns).not.toHaveBeenCalled();
  });
});
