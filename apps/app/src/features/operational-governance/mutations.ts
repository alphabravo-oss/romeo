import {
  operationalGovernanceCreateQuotaBucket,
  operationalGovernanceDeleteQuotaBucket,
  operationalGovernanceUpdateQuotaBucket,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

import type {
  CreateQuotaBucketRequest,
  UpdateQuotaBucketRequest,
} from "./types";

export async function createQuotaBucket(input: CreateQuotaBucketRequest) {
  configureBrowserApiClients();
  const response = await operationalGovernanceCreateQuotaBucket({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function updateQuotaBucket(
  quotaBucketId: string,
  input: UpdateQuotaBucketRequest,
) {
  configureBrowserApiClients();
  const response = await operationalGovernanceUpdateQuotaBucket({
    path: { quotaBucketId },
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function deleteQuotaBucket(quotaBucketId: string) {
  configureBrowserApiClients();
  const response = await operationalGovernanceDeleteQuotaBucket({
    path: { quotaBucketId },
    throwOnError: true,
  });
  return response.data.data;
}
