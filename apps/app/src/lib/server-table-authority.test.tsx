// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const sdk = vi.hoisted(() => ({
  tableExportsCreate: vi.fn(),
  tableExportsDelete: vi.fn(),
  tableExportsDownloadArtifact: vi.fn(),
  tableExportsGet: vi.fn(),
  tableViewsDelete: vi.fn(),
  tableViewsList: vi.fn(),
  tableViewsReplace: vi.fn(),
  tableViewsRestore: vi.fn(),
  tableViewsSetDefault: vi.fn(),
  tableViewsShare: vi.fn(),
}));
const downloadText = vi.hoisted(() => vi.fn(() => true));

vi.mock("@romeo/api-client/generated/sdk", () => sdk);
vi.mock("@romeo/api-client/runtime/browser", () => ({
  configureBrowserApiClients: vi.fn(),
}));
vi.mock("./download", () => ({ downloadText }));

import { useServerTableAuthority } from "./server-table-authority";

const serverView = {
  canEdit: true,
  id: "saved_view_1",
  isDefault: false,
  name: "Incidents",
  presentation: { columnVisibility: {}, density: "comfortable" as const },
  query: {
    filters: [],
    pageSize: 25,
    search: "denied",
    sort: [{ direction: "desc" as const, field: "createdAt" }],
  },
  resource: "api_keys",
  schemaVersion: 2,
  source: "server" as const,
  visibility: "private" as const,
  version: 1,
};

beforeEach(() => {
  vi.clearAllMocks();
  localStorage.clear();
  sdk.tableViewsList.mockResolvedValue({ data: { data: [serverView] } });
  sdk.tableViewsReplace.mockResolvedValue({ data: { data: serverView } });
  sdk.tableViewsDelete.mockResolvedValue({
    data: {
      data: {
        deleted: true,
        undoToken: "saved_view_undo_1",
        version: 2,
      },
    },
  });
  sdk.tableViewsRestore.mockResolvedValue({ data: { data: serverView } });
  sdk.tableViewsSetDefault.mockResolvedValue({ data: { data: serverView } });
  sdk.tableViewsShare.mockResolvedValue({ data: { data: serverView } });
  sdk.tableExportsCreate.mockResolvedValue({
    data: {
      data: { outcome: "accepted", jobId: "export_job_1", state: "queued" },
    },
  });
  sdk.tableExportsGet.mockResolvedValue({
    data: {
      data: {
        outcome: "accepted",
        jobId: "export_job_1",
        state: "artifact_ready",
        artifactId: "artifact_1",
      },
    },
  });
  sdk.tableExportsDownloadArtifact.mockResolvedValue({
    data: "id,name\n1,One",
  });
  sdk.tableExportsDelete.mockResolvedValue({
    data: { data: { deleted: true } },
  });
});

describe("useServerTableAuthority", () => {
  it("wires server view mutations and the async export download", async () => {
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useServerTableAuthority(
          { resource: "api_keys", schemaVersion: 2 },
          "workspace_default",
        ),
      { wrapper },
    );
    await waitFor(() => expect(result.current?.status).toBe("ready"));
    const view = result.current!.savedViews[0]!;
    expect(view).toMatchObject({ id: "saved_view_1", source: "server" });

    await act(async () => result.current!.saveView(view));
    await act(async () => result.current!.setDefaultView(view, true));
    await act(async () => result.current!.setViewVisibility(view, "workspace"));
    const deleteReceipt = await result.current!.deleteView(view);
    await act(async () => deleteReceipt?.restore());
    await act(async () => result.current!.exportView(view, 2_000));
    await waitFor(() =>
      expect(sdk.tableExportsDownloadArtifact).toHaveBeenCalledOnce(),
    );

    expect(sdk.tableViewsReplace).toHaveBeenCalledOnce();
    expect(sdk.tableViewsSetDefault).toHaveBeenCalledOnce();
    expect(sdk.tableViewsShare).toHaveBeenCalledOnce();
    expect(sdk.tableViewsDelete).toHaveBeenCalledOnce();
    expect(sdk.tableViewsRestore).toHaveBeenCalledOnce();
    expect(sdk.tableExportsCreate).toHaveBeenCalledOnce();
    expect(sdk.tableExportsGet).toHaveBeenCalled();
    expect(sdk.tableExportsDownloadArtifact).toHaveBeenCalledOnce();
    expect(sdk.tableExportsDelete).toHaveBeenCalledOnce();
    expect(downloadText).toHaveBeenCalledWith(
      "id,name\n1,One",
      expect.stringMatching(/^romeo-api_keys-/u),
      "text/csv;charset=utf-8",
    );
  });

  it("fails visibly and does not fall back to local views without workspace authority", () => {
    const client = new QueryClient();
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    const { result } = renderHook(
      () =>
        useServerTableAuthority(
          { resource: "api_keys", schemaVersion: 2 },
          undefined,
        ),
      { wrapper },
    );
    expect(result.current).toMatchObject({
      mode: "server",
      status: "error",
      savedViews: [],
    });
    expect(sdk.tableViewsList).not.toHaveBeenCalled();
  });

  it("recovers a queued export after reload and downloads the completed artifact", async () => {
    localStorage.setItem(
      "romeo:table-export-job:v1:workspace_default%00api_keys%00",
      "export_job_recovered",
    );
    const client = new QueryClient({
      defaultOptions: { queries: { retry: false } },
    });
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={client}>{children}</QueryClientProvider>
    );
    renderHook(
      () =>
        useServerTableAuthority(
          { resource: "api_keys", schemaVersion: 2 },
          "workspace_default",
        ),
      { wrapper },
    );

    await waitFor(() =>
      expect(sdk.tableExportsDownloadArtifact).toHaveBeenCalledWith(
        expect.objectContaining({
          path: { jobId: "export_job_recovered" },
        }),
      ),
    );
    expect(sdk.tableExportsDelete).toHaveBeenCalledOnce();
    expect(localStorage.length).toBe(0);
  });
});
