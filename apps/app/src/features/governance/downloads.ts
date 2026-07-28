import {
  governanceExportAccessReviewCsv,
  governanceExportAccessReviewReportCsv,
  governanceExportComplianceReportCsv,
  governanceReadDataExportPackage,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

async function text(request: () => Promise<{ data: string }>) {
  configureBrowserApiClients();
  return (await request()).data;
}

export const exportComplianceReportCsv = () =>
  text(() => governanceExportComplianceReportCsv({ throwOnError: true }));
export const exportAccessReviewCsv = () =>
  text(() => governanceExportAccessReviewCsv({ throwOnError: true }));
export const exportAccessReviewReportCsv = () =>
  text(() => governanceExportAccessReviewReportCsv({ throwOnError: true }));
export const downloadDataExportPackageContent = (packageId: string) =>
  text(() =>
    governanceReadDataExportPackage({
      parseAs: "text",
      path: { packageId },
      throwOnError: true,
    }),
  );
