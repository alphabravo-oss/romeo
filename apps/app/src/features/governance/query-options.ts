import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import {
  getAccessReviewReport,
  getDataRightsCoverage,
  getRetentionPolicy,
  listAccessReviewGrants,
  listDataExportPackages,
} from "./queries";

function stableOptions<T>(
  resource: string,
  queryKey: readonly unknown[],
  queryFn: () => Promise<T>,
) {
  return queryOptions({
    ...serverQueryPolicy("stable", resource),
    queryKey,
    queryFn: ({ signal }) => abortableQuery(signal, queryFn),
  });
}

export const dataExportPackagesQueryOptions = () =>
  stableOptions(
    "dataExportPackages",
    appQueryKeys.dataExportPackages(),
    listDataExportPackages,
  );
export const dataRightsCoverageQueryOptions = () =>
  stableOptions(
    "dataRightsCoverage",
    appQueryKeys.dataRightsCoverage(),
    getDataRightsCoverage,
  );
export const accessReviewReportQueryOptions = () =>
  stableOptions(
    "accessReviewReport",
    appQueryKeys.accessReviewReport(),
    getAccessReviewReport,
  );
export const retentionPolicyQueryOptions = () =>
  stableOptions(
    "retentionPolicy",
    appQueryKeys.retentionPolicy(),
    getRetentionPolicy,
  );
export const accessReviewQueryOptions = () =>
  stableOptions(
    "accessReview",
    appQueryKeys.accessReview(),
    listAccessReviewGrants,
  );
