import {
  jobsGetOperationalSummary,
  jobsList,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listJobs() {
  configureBrowserApiClients();
  const response = await jobsList({ throwOnError: true });
  return response.data.data;
}

export async function getJobsOperationalSummary() {
  configureBrowserApiClients();
  const response = await jobsGetOperationalSummary({ throwOnError: true });
  return response.data.data;
}
