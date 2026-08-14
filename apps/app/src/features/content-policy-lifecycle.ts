import {
  contentPolicyApprovalsList,
  contentPolicyApprovalsRequest,
  contentPolicyApprovalsResolve,
  contentPolicyDecisionsList,
  contentPolicyRollback,
  contentPolicyVersionsCreate,
  contentPolicyVersionsDryRun,
  contentPolicyVersionsList,
  contentPolicyVersionsPublish,
  type ContentPolicyApproval,
  type ContentPolicyDecision,
  type ContentPolicyDryRun,
  type ContentPolicyVersion,
  type CreateContentPolicyVersionRequest,
  type RequestContentPolicyApprovalRequest,
  type ResolveContentPolicyApprovalRequest,
  type RollbackContentPolicyRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export type {
  ContentPolicyApproval,
  ContentPolicyDecision,
  ContentPolicyDryRun,
  ContentPolicyVersion,
};

export async function listContentPolicyVersions(): Promise<ContentPolicyVersion[]> {
  configureBrowserApiClients();
  const response = await contentPolicyVersionsList({ throwOnError: true });
  return response.data.data;
}

export async function createContentPolicyVersion(
  input: CreateContentPolicyVersionRequest,
): Promise<ContentPolicyVersion> {
  configureBrowserApiClients();
  const response = await contentPolicyVersionsCreate({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function dryRunContentPolicyVersion(
  versionId: string,
  content: string,
): Promise<ContentPolicyDryRun> {
  configureBrowserApiClients();
  const response = await contentPolicyVersionsDryRun({
    path: { versionId },
    body: { content },
    throwOnError: true,
  });
  return response.data.data;
}

export async function publishContentPolicyVersion(
  versionId: string,
): Promise<ContentPolicyVersion> {
  configureBrowserApiClients();
  const response = await contentPolicyVersionsPublish({
    path: { versionId },
    throwOnError: true,
  });
  return response.data.data;
}

export async function rollbackContentPolicy(
  input: RollbackContentPolicyRequest,
): Promise<ContentPolicyVersion> {
  configureBrowserApiClients();
  const response = await contentPolicyRollback({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function listContentPolicyDecisions(): Promise<ContentPolicyDecision[]> {
  configureBrowserApiClients();
  const response = await contentPolicyDecisionsList({ throwOnError: true });
  return response.data.data;
}

export async function listContentPolicyApprovals(): Promise<ContentPolicyApproval[]> {
  configureBrowserApiClients();
  const response = await contentPolicyApprovalsList({ throwOnError: true });
  return response.data.data;
}

export async function requestContentPolicyApproval(
  input: RequestContentPolicyApprovalRequest,
): Promise<ContentPolicyApproval> {
  configureBrowserApiClients();
  const response = await contentPolicyApprovalsRequest({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function resolveContentPolicyApproval(
  approvalId: string,
  input: ResolveContentPolicyApprovalRequest,
): Promise<ContentPolicyApproval> {
  configureBrowserApiClients();
  const response = await contentPolicyApprovalsResolve({
    path: { approvalId },
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}
