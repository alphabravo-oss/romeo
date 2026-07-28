import {
  evalsGetDashboard,
  evalsGetReleaseCandidateEvidence,
  evalsListRatings,
  evalsListResults,
  evalsListRuns,
  evalsListSuites,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function listEvalSuites(agentId: string) {
  configureBrowserApiClients();
  const response = await evalsListSuites({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listEvalRuns(agentId: string) {
  configureBrowserApiClients();
  const response = await evalsListRuns({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function getEvalDashboard(agentId: string) {
  configureBrowserApiClients();
  const response = await evalsGetDashboard({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function getEvalReleaseCandidateEvidence(agentId: string) {
  configureBrowserApiClients();
  const response = await evalsGetReleaseCandidateEvidence({
    path: { agentId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listEvalResults(runId: string) {
  configureBrowserApiClients();
  const response = await evalsListResults({
    path: { runId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function listEvalRatings(runId: string) {
  configureBrowserApiClients();
  const response = await evalsListRatings({
    path: { runId },
    throwOnError: true,
  });
  return response.data.data;
}
