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
  queryOptions({
    ...serverQueryPolicy("stable", "dataExportPackages"),
    queryKey: appQueryKeys.dataExportPackages(),
    queryFn: ({ signal }) => abortableQuery(signal, listDataExportPackages),
    refetchInterval: (query) =>
      query.state.data?.jobs.some(
        (job) => job.state === "queued" || job.state === "running",
      )
        ? 1_000
        : false,
  });
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
