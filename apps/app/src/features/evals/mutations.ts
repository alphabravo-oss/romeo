import {
  evalsCreateSuite,
  evalsRateResult,
  evalsRunSuite,
  type CreateEvalSuiteRequest,
  type RateEvalResultRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function createEvalSuite(input: CreateEvalSuiteRequest) {
  configureBrowserApiClients();
  const response = await evalsCreateSuite({ body: input, throwOnError: true });
  return response.data.data;
}

export async function runEvalSuite(suiteId: string) {
  configureBrowserApiClients();
  const response = await evalsRunSuite({
    path: { suiteId },
    body: {},
    throwOnError: true,
  });
  return response.data.data;
}

export async function rateEvalResult(
  input: RateEvalResultRequest & { resultId: string },
) {
  configureBrowserApiClients();
  const { resultId, ...body } = input;
  const response = await evalsRateResult({
    path: { resultId },
    body,
    throwOnError: true,
  });
  return response.data.data;
}
