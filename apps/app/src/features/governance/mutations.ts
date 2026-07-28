import {
  governanceCreateDataExportPackage,
  governanceDeleteDataExportPackage,
  governanceEnforceRetention,
  governanceExecuteDataDeletion,
  governanceExecuteDataExport,
  governancePreviewDataDeletion,
  governancePreviewDataExport,
  governanceUpdateRetentionPolicy,
  type DataExportRequest,
  type ExecuteDataDeletionRequest,
  type PreviewDataDeletionRequest,
  type UpdateRetentionPolicyRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

async function data<T>(request: () => Promise<{ data: { data: T } }>) {
  configureBrowserApiClients();
  return (await request()).data.data;
}

export const updateRetentionPolicy = (body: UpdateRetentionPolicyRequest) =>
  data(() => governanceUpdateRetentionPolicy({ body, throwOnError: true }));
export const enforceRetention = () =>
  data(() => governanceEnforceRetention({ throwOnError: true }));
export const previewDataDeletion = (body: PreviewDataDeletionRequest) =>
  data(() => governancePreviewDataDeletion({ body, throwOnError: true }));
export const executeDataDeletion = (body: ExecuteDataDeletionRequest) =>
  data(() => governanceExecuteDataDeletion({ body, throwOnError: true }));
export const previewDataExport = (body: DataExportRequest) =>
  data(() => governancePreviewDataExport({ body, throwOnError: true }));
export const executeDataExport = (body: DataExportRequest) =>
  data(() => governanceExecuteDataExport({ body, throwOnError: true }));
export const createDataExportPackage = (body: DataExportRequest) =>
  data(() => governanceCreateDataExportPackage({ body, throwOnError: true }));
export const deleteDataExportPackage = (input: {
  packageId: string;
  confirmPackageId: string;
}) =>
  data(() =>
    governanceDeleteDataExportPackage({
      body: { confirmPackageId: input.confirmPackageId },
      path: { packageId: input.packageId },
      throwOnError: true,
    }),
  );
