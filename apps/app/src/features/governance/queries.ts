import {
  governanceGetAccessReviewReport,
  governanceGetComplianceReport,
  governanceGetDataRightsCoverage,
  governanceGetIdentityLifecyclePolicy,
  governanceGetRetentionPolicy,
  governanceListAccessReviewGrants,
  governanceListDataExportPackages,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

async function data<T>(request: () => Promise<{ data: { data: T } }>) {
  configureBrowserApiClients();
  return (await request()).data.data;
}

export const getRetentionPolicy = () =>
  data(() => governanceGetRetentionPolicy({ throwOnError: true }));
export const getDataRightsCoverage = () =>
  data(() => governanceGetDataRightsCoverage({ throwOnError: true }));
export const listDataExportPackages = () =>
  data(() => governanceListDataExportPackages({ throwOnError: true }));
export const getComplianceReport = () =>
  data(() => governanceGetComplianceReport({ throwOnError: true }));
export const listAccessReviewGrants = () =>
  data(() => governanceListAccessReviewGrants({ throwOnError: true }));
export const getAccessReviewReport = () =>
  data(() => governanceGetAccessReviewReport({ throwOnError: true }));
export const getIdentityLifecyclePolicy = () =>
  data(() => governanceGetIdentityLifecyclePolicy({ throwOnError: true }));
