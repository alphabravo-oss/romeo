import type {
  DataExportPackage,
  DataExportPackageList,
  RetentionPolicy,
} from "@romeo/api-client/generated/sdk";
import { MutationObserver } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  completeMutationNetworkRevalidation,
  markMutationNetworkOffline,
} from "../../lib/connectivity";
import { advanceMutationSessionBoundary } from "../../lib/mutation-session-boundary";
import { createRomeoQueryClient } from "../../lib/query-client";
import { clearRouteDataForLogout } from "../../lib/route-intent";
import {
  createDataExportPackageMutationOptions,
  deleteDataExportPackageMutationOptions,
  downloadDataExportPackageMutationOptions,
  enforceRetentionMutationOptions,
  exportAccessReviewCsvMutationOptions,
  exportAccessReviewReportCsvMutationOptions,
  exportComplianceReportCsvMutationOptions,
  executeDataExportMutationOptions,
  updateRetentionPolicyMutationOptions,
} from "./mutation-options";

const mutationMocks = vi.hoisted(() => ({
  createDataExportPackage: vi.fn(),
  deleteDataExportPackage: vi.fn(),
  enforceRetention: vi.fn(),
  executeDataExport: vi.fn(),
  executeDataDeletion: vi.fn(),
  previewDataExport: vi.fn(),
  previewDataDeletion: vi.fn(),
  updateRetentionPolicy: vi.fn(),
}));
const downloadMocks = vi.hoisted(() => ({
  downloadDataExportPackageContent: vi.fn(),
  exportAccessReviewCsv: vi.fn(),
  exportAccessReviewReportCsv: vi.fn(),
  exportComplianceReportCsv: vi.fn(),
}));

vi.mock("./mutations", () => mutationMocks);
vi.mock("./downloads", () => downloadMocks);

const retentionPolicy = (updatedAt: string): RetentionPolicy => ({
  auditLogRetentionDays: 365,
  fileRetentionDays: null,
  orgId: "org-1",
  runEventRetentionDays: 30,
  updatedAt,
  updatedBy: "admin-1",
  userFileRetentionDays: {},
  workspaceFileRetentionDays: {},
});

const exportCounts = {
  agents: 0,
  backgroundJobs: 0,
  chatComments: 0,
  chats: 0,
  dataConnectorSyncs: 0,
  dataConnectors: 0,
  fileObjectBytesIncluded: 0,
  fileObjects: 0,
  knowledgeBases: 0,
  knowledgeChunks: 0,
  knowledgeSourceBytesIncluded: 0,
  knowledgeSources: 0,
  messageParts: 0,
  messages: 0,
  promptTemplates: 0,
  usageEvents: 0,
  workflowRuns: 0,
  workflows: 0,
  workspaces: 1,
};

function exportPackage(packageId = "package-1"): DataExportPackage {
  return {
    schema: "romeo.data-export-package.v1",
    artifact: {
      contentType: "application/json",
      downloadUrl: `/api/v1/governance/data-export-packages/${packageId}`,
      sha256: "a".repeat(64),
      sizeBytes: 42,
      storage: {
        driver: "object_store",
        objectKeyHash: "b".repeat(64),
        rawObjectKeyReturned: false,
      },
    },
    counts: exportCounts,
    createdAt: "2026-08-14T00:00:00.000Z",
    exclusions: [],
    limits: { maxObjectBytes: 1_024, maxTotalObjectBytes: 4_096 },
    orgId: "org-1",
    packageId,
    request: {
      includeContent: false,
      includeObjectBytes: false,
      maxObjectBytes: 1_024,
      scope: "org",
    },
    warnings: [],
  };
}

function exportPackageList(
  packages: DataExportPackageList["packages"],
): DataExportPackageList {
  return {
    schema: "romeo.data-export-package-list.v1",
    generatedAt: "2026-08-14T00:00:00.000Z",
    orgId: "org-1",
    packages,
    redaction: {
      packageContentReturned: false,
      rawObjectKeysReturned: false,
    },
  };
}

describe("governance mutation policies", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    completeMutationNetworkRevalidation();
    advanceMutationSessionBoundary();
  });

  it("invalidates each cached audit variant exactly after retention enforcement", async () => {
    const client = createRomeoQueryClient();
    const filteredAuditKey = appQueryKeys.auditLogs({
      filters: [{ field: "outcome", operator: "eq", value: "failure" }],
      limit: 50,
      sort: [{ direction: "desc", field: "createdAt" }],
    });
    const auditKey = appQueryKeys.auditLogs();
    const packagesKey = appQueryKeys.dataExportPackages();
    const unrelatedKey = appQueryKeys.retentionPolicy();
    client.setQueryData(auditKey, []);
    client.setQueryData(filteredAuditKey, []);
    client.setQueryData(packagesKey, []);
    client.setQueryData(unrelatedKey, retentionPolicy("before"));
    mutationMocks.enforceRetention.mockResolvedValueOnce({
      deletedAuditLogCount: 1,
      deletedRunEventCount: 2,
    });
    const observer = new MutationObserver(
      client,
      enforceRetentionMutationOptions(),
    );

    await observer.mutate(undefined);

    expect(client.getQueryState(auditKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(filteredAuditKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(packagesKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(unrelatedKey)?.isInvalidated).toBe(false);
  });

  it("does not let a late retention update overwrite a new session", async () => {
    const client = createRomeoQueryClient();
    let resolveUpdate!: (value: RetentionPolicy) => void;
    mutationMocks.updateRetentionPolicy.mockReturnValueOnce(
      new Promise<RetentionPolicy>((resolve) => {
        resolveUpdate = resolve;
      }),
    );
    const observer = new MutationObserver(
      client,
      updateRetentionPolicyMutationOptions(),
    );
    const mutation = observer.mutate({
      auditLogRetentionDays: 365,
      runEventRetentionDays: 30,
    });
    await vi.waitFor(() =>
      expect(mutationMocks.updateRetentionPolicy).toHaveBeenCalledOnce(),
    );

    await clearRouteDataForLogout(client);
    const nextSession = retentionPolicy("next-session");
    client.setQueryData(appQueryKeys.retentionPolicy(), nextSession);
    resolveUpdate(retentionPolicy("late-response"));
    await mutation;

    expect(client.getQueryData(appQueryKeys.retentionPolicy())).toEqual(
      nextSession,
    );
  });

  it("reconciles a created export package without package content", async () => {
    const client = createRomeoQueryClient();
    const packagesKey = appQueryKeys.dataExportPackages();
    const auditKey = appQueryKeys.auditLogs({ limit: 25 });
    client.setQueryData(packagesKey, exportPackageList([]));
    client.setQueryData(auditKey, []);
    mutationMocks.createDataExportPackage.mockResolvedValueOnce(
      exportPackage(),
    );
    const observer = new MutationObserver(
      client,
      createDataExportPackageMutationOptions(),
    );

    await observer.mutate({ scope: "org" });

    const cached = client.getQueryData<DataExportPackageList>(packagesKey);
    expect(cached?.packages).toHaveLength(1);
    expect(cached?.packages[0]?.schema).toBe(
      "romeo.data-export-package-summary.v1",
    );
    expect(cached?.packages[0]).not.toHaveProperty("data");
    expect(client.getQueryState(packagesKey)?.isInvalidated).toBe(true);
    expect(client.getQueryState(auditKey)?.isInvalidated).toBe(true);
  });

  it("rolls package deletion back after conflict or authorization failure", async () => {
    const client = createRomeoQueryClient();
    const packagesKey = appQueryKeys.dataExportPackages();
    const existing = exportPackageList([
      { ...exportPackage(), schema: "romeo.data-export-package-summary.v1" },
    ]);
    const observer = new MutationObserver(
      client,
      deleteDataExportPackageMutationOptions(),
    );

    for (const error of ["version_conflict", "forbidden"]) {
      client.setQueryData(packagesKey, existing);
      mutationMocks.deleteDataExportPackage.mockRejectedValueOnce(
        new Error(error),
      );
      await expect(
        observer.mutate({
          confirmPackageId: "package-1",
          packageId: "package-1",
        }),
      ).rejects.toThrow(error);
      expect(client.getQueryData(packagesKey)).toEqual(existing);
      expect(client.getQueryState(packagesKey)?.isInvalidated).toBe(false);
    }
  });

  it("keeps direct export and download results ephemeral", async () => {
    const client = createRomeoQueryClient();
    const auditKey = appQueryKeys.auditLogs({ limit: 25 });
    client.setQueryData(auditKey, []);
    mutationMocks.executeDataExport.mockResolvedValueOnce({
      data: { messages: [{ content: "sensitive" }] },
    });
    const executeObserver = new MutationObserver(
      client,
      executeDataExportMutationOptions(),
    );

    await executeObserver.mutate({ scope: "org", includeContent: true });
    expect(client.getQueryState(auditKey)?.isInvalidated).toBe(true);
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      "sensitive",
    );
    executeObserver.reset();

    downloadMocks.downloadDataExportPackageContent.mockResolvedValueOnce(
      "sensitive-package-content",
    );
    const downloadObserver = new MutationObserver(
      client,
      downloadDataExportPackageMutationOptions(),
    );
    await downloadObserver.mutate("package-1");
    downloadObserver.reset();

    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll()).toHaveLength(0),
    );
  });

  it("executes no data export while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      executeDataExportMutationOptions(),
    );

    await expect(observer.mutate({ scope: "org" })).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(mutationMocks.executeDataExport).not.toHaveBeenCalled();
  });

  it("rejects a late package creation response after logout", async () => {
    const client = createRomeoQueryClient();
    const packagesKey = appQueryKeys.dataExportPackages();
    client.setQueryData(packagesKey, exportPackageList([]));
    let resolveCreate: ((value: DataExportPackage) => void) | undefined;
    mutationMocks.createDataExportPackage.mockImplementationOnce(
      () =>
        new Promise<DataExportPackage>((resolve) => {
          resolveCreate = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      createDataExportPackageMutationOptions(),
    );
    const pending = observer.mutate({ scope: "org" });
    await vi.waitFor(() => expect(resolveCreate).toBeDefined());

    await clearRouteDataForLogout(client);
    resolveCreate?.(exportPackage());

    await expect(pending).rejects.toThrow(
      "The authentication session changed.",
    );
    expect(client.getQueryData(packagesKey)).toBeUndefined();
  });

  it("keeps governance report CSVs ephemeral and converges cached audit variants", async () => {
    const client = createRomeoQueryClient();
    const auditKey = appQueryKeys.auditLogs({ limit: 25 });
    const unrelated = appQueryKeys.accessReviewReport();
    client.setQueryData(auditKey, []);
    client.setQueryData(unrelated, { generatedAt: "before" });
    const exports = [
      [
        downloadMocks.exportComplianceReportCsv,
        exportComplianceReportCsvMutationOptions,
      ],
      [
        downloadMocks.exportAccessReviewCsv,
        exportAccessReviewCsvMutationOptions,
      ],
      [
        downloadMocks.exportAccessReviewReportCsv,
        exportAccessReviewReportCsvMutationOptions,
      ],
    ] as const;

    for (const [mock, options] of exports) {
      client.setQueryData(auditKey, []);
      mock.mockResolvedValueOnce("credential=must-not-persist");
      const observer = new MutationObserver(client, options());
      await observer.mutate(undefined);
      expect(mock).toHaveBeenCalledOnce();
      expect(client.getQueryState(auditKey)?.isInvalidated).toBe(true);
      expect(client.getQueryState(unrelated)?.isInvalidated).toBe(false);
      expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
        "must-not-persist",
      );
      observer.reset();
    }

    await vi.waitFor(() =>
      expect(client.getMutationCache().getAll()).toHaveLength(0),
    );
  });

  it("executes no governance report export while offline", async () => {
    const client = createRomeoQueryClient();
    markMutationNetworkOffline();
    const observer = new MutationObserver(
      client,
      exportAccessReviewReportCsvMutationOptions(),
    );

    await expect(observer.mutate(undefined)).rejects.toThrow(
      "Changes are unavailable until the secure connection is ready.",
    );
    expect(downloadMocks.exportAccessReviewReportCsv).not.toHaveBeenCalled();
  });

  it("rejects a late governance report response after logout", async () => {
    const client = createRomeoQueryClient();
    let resolveExport: ((value: string) => void) | undefined;
    downloadMocks.exportAccessReviewReportCsv.mockImplementationOnce(
      () =>
        new Promise<string>((resolve) => {
          resolveExport = resolve;
        }),
    );
    const observer = new MutationObserver(
      client,
      exportAccessReviewReportCsvMutationOptions(),
    );
    const pending = observer.mutate(undefined);
    await vi.waitFor(() => expect(resolveExport).toBeDefined());

    await clearRouteDataForLogout(client);
    resolveExport?.("credential=late-response");

    await expect(pending).rejects.toThrow(
      "The authentication session changed.",
    );
    expect(JSON.stringify(client.getQueryCache().getAll())).not.toContain(
      "late-response",
    );
  });
});
