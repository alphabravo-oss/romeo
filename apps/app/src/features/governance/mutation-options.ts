import type { QueryClient } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import { currentMutationSessionVersion } from "../../lib/mutation-session-boundary";
import {
  invalidateCachedResourceExactly,
  serverMutationOptions,
} from "../../lib/server-mutation-options";
import {
  createDataExportPackage,
  deleteDataExportPackage,
  enforceRetention,
  executeDataExport,
  executeDataDeletion,
  previewDataExport,
  previewDataDeletion,
  updateRetentionPolicy,
} from "./mutations";
import {
  downloadDataExportPackageContent,
  exportAccessReviewCsv,
  exportAccessReviewReportCsv,
  exportComplianceReportCsv,
} from "./downloads";
import type {
  DataExportPackageJob,
  DataExportPackageList,
  DataExportRequest,
} from "./types";

type DataExportPackageSnapshot = DataExportPackageList | undefined;

async function withinCurrentSession<T>(operation: () => Promise<T>) {
  const sessionVersion = currentMutationSessionVersion();
  const result = await operation();
  if (sessionVersion !== currentMutationSessionVersion()) {
    throw new Error("The authentication session changed.");
  }
  return result;
}

function upsertExportJob(
  client: QueryClient,
  created: DataExportPackageJob,
): void {
  client.setQueryData<DataExportPackageList>(
    appQueryKeys.dataExportPackages(),
    (current) => {
      if (current === undefined) return undefined;
      return {
        ...current,
        jobs: current.jobs.some(
          (entry) => entry.packageId === created.packageId,
        )
          ? current.jobs.map((entry) =>
              entry.packageId === created.packageId ? created : entry,
            )
          : [created, ...current.jobs],
      };
    },
  );
}

async function snapshotExportPackages(
  client: QueryClient,
): Promise<DataExportPackageSnapshot> {
  const queryKey = appQueryKeys.dataExportPackages();
  await client.cancelQueries({ exact: true, queryKey });
  return client.getQueryData<DataExportPackageList>(queryKey);
}

function removeExportPackage(client: QueryClient, packageId: string): void {
  client.setQueryData<DataExportPackageList>(
    appQueryKeys.dataExportPackages(),
    (current) =>
      current === undefined
        ? undefined
        : {
            ...current,
            packages: current.packages.filter(
              (entry) => entry.packageId !== packageId,
            ),
            jobs: current.jobs.filter((entry) => entry.packageId !== packageId),
          },
  );
}

function restoreExportPackages(
  client: QueryClient,
  snapshot: DataExportPackageSnapshot,
): void {
  const queryKey = appQueryKeys.dataExportPackages();
  if (snapshot === undefined) client.removeQueries({ exact: true, queryKey });
  else client.setQueryData(queryKey, snapshot);
}

async function invalidateAuditVariants(client: QueryClient): Promise<void> {
  await invalidateCachedResourceExactly(client, appQueryKeys.auditLogs());
}

async function invalidateGovernanceResourceVariants(client: QueryClient) {
  await Promise.all([
    invalidateCachedResourceExactly(client, appQueryKeys.auditLogs()),
    invalidateCachedResourceExactly(client, appQueryKeys.dataExportPackages()),
    invalidateCachedResourceExactly(client, appQueryKeys.tablePages()),
  ]);
}

export function previewDataDeletionMutationOptions() {
  return serverMutationOptions({
    resource: "governance.dataDeletion.preview",
    mutationFn: previewDataDeletion,
  });
}

export function executeDataDeletionMutationOptions() {
  return serverMutationOptions({
    resource: "governance.dataDeletion.execute",
    mutationFn: executeDataDeletion,
  });
}

export function updateRetentionPolicyMutationOptions() {
  return serverMutationOptions({
    resource: "governance.retention.update",
    mutationFn: updateRetentionPolicy,
    reconcile: async (client, policy) => {
      client.setQueryData(appQueryKeys.retentionPolicy(), policy);
      await invalidateCachedResourceExactly(client, appQueryKeys.auditLogs());
    },
  });
}

export function enforceRetentionMutationOptions() {
  return serverMutationOptions({
    resource: "governance.retention.enforce",
    mutationFn: enforceRetention,
    reconcile: invalidateGovernanceResourceVariants,
  });
}

export function previewDataExportMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "governance.dataExport.preview",
    mutationFn: (input: DataExportRequest) =>
      withinCurrentSession(() => previewDataExport(input)),
  });
}

export function executeDataExportMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "governance.dataExport.execute",
    mutationFn: (input: DataExportRequest) =>
      withinCurrentSession(() => executeDataExport(input)),
    reconcile: invalidateAuditVariants,
  });
}

export function createDataExportPackageMutationOptions() {
  const queryKey = appQueryKeys.dataExportPackages();
  return serverMutationOptions({
    resource: "governance.dataExport.package.create",
    mutationFn: (input: DataExportRequest) =>
      withinCurrentSession(() => createDataExportPackage(input)),
    reconcile: async (client, created) => {
      upsertExportJob(client, created);
      await Promise.all([
        invalidateAuditVariants(client),
        invalidateCachedResourceExactly(client, appQueryKeys.tablePages()),
      ]);
    },
    invalidations: () => [{ exact: true, queryKey }],
  });
}

export interface DeleteDataExportPackageInput {
  packageId: string;
  confirmPackageId: string;
}

export function deleteDataExportPackageMutationOptions() {
  const queryKey = appQueryKeys.dataExportPackages();
  return serverMutationOptions<
    Awaited<ReturnType<typeof deleteDataExportPackage>>,
    Error,
    DeleteDataExportPackageInput,
    DataExportPackageSnapshot
  >({
    resource: "governance.dataExport.package.delete",
    mutationFn: (input) =>
      withinCurrentSession(() => deleteDataExportPackage(input)),
    optimistic: {
      snapshot: snapshotExportPackages,
      update: (client, input) => removeExportPackage(client, input.packageId),
      rollback: restoreExportPackages,
    },
    reconcile: async (client, result) => {
      removeExportPackage(client, result.packageId);
      await Promise.all([
        invalidateAuditVariants(client),
        invalidateCachedResourceExactly(client, appQueryKeys.tablePages()),
      ]);
    },
    invalidations: () => [{ exact: true, queryKey }],
  });
}

export function downloadDataExportPackageMutationOptions() {
  return serverMutationOptions({
    ephemeral: true,
    resource: "governance.dataExport.package.download",
    mutationFn: (packageId: string) =>
      withinCurrentSession(() => downloadDataExportPackageContent(packageId)),
    reconcile: invalidateAuditVariants,
  });
}

function governanceCsvExportMutationOptions(
  resource: string,
  exportCsv: () => Promise<string>,
) {
  return serverMutationOptions({
    ephemeral: true,
    resource,
    mutationFn: () => withinCurrentSession(exportCsv),
    reconcile: invalidateAuditVariants,
  });
}

export const exportComplianceReportCsvMutationOptions = () =>
  governanceCsvExportMutationOptions(
    "governance.complianceReport.export",
    exportComplianceReportCsv,
  );

export const exportAccessReviewCsvMutationOptions = () =>
  governanceCsvExportMutationOptions(
    "governance.accessReview.export",
    exportAccessReviewCsv,
  );

export const exportAccessReviewReportCsvMutationOptions = () =>
  governanceCsvExportMutationOptions(
    "governance.accessReviewReport.export",
    exportAccessReviewReportCsv,
  );
