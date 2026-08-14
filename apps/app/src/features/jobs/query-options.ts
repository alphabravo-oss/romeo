import { queryOptions } from "@tanstack/react-query";

import * as appQueryKeys from "../../lib/app-query-keys";
import {
  abortableQuery,
  serverQueryPolicy,
} from "../../lib/server-query-options";
import { getJobsOperationalSummary, listJobs } from "./queries";

export function jobsQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("volatile", "jobs"),
    queryKey: appQueryKeys.jobs(),
    queryFn: ({ signal }) => abortableQuery(signal, listJobs),
  });
}

export function jobsOperationalSummaryQueryOptions() {
  return queryOptions({
    ...serverQueryPolicy("volatile", "jobsOperationalSummary"),
    queryKey: appQueryKeys.jobsOperationalSummary(),
    queryFn: ({ signal }) => abortableQuery(signal, getJobsOperationalSummary),
  });
}
