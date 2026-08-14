import * as appQueryKeys from "../lib/app-query-keys";
import { serverMutationOptions } from "../lib/server-mutation-options";
import {
  createContentPolicyVersion,
  dryRunContentPolicyVersion,
  publishContentPolicyVersion,
  resolveContentPolicyApproval,
  rollbackContentPolicy,
  type ContentPolicyVersion,
} from "./content-policy-lifecycle";

export function createContentPolicyVersionMutationOptions() {
  return serverMutationOptions({
    resource: "contentPolicy.versions.create",
    mutationFn: createContentPolicyVersion,
    reconcile: (client, created) => {
      client.setQueryData<ContentPolicyVersion[]>(
        appQueryKeys.contentPolicyVersions(),
        (current) => [...(current ?? []), created],
      );
    },
  });
}

export function publishContentPolicyVersionMutationOptions() {
  return serverMutationOptions({
    resource: "contentPolicy.versions.publish",
    mutationFn: publishContentPolicyVersion,
    reconcile: (client) => {
      void client.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.contentPolicyVersions(),
      });
      void client.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.contentPolicy(),
      });
    },
  });
}

export function rollbackContentPolicyMutationOptions() {
  return serverMutationOptions({
    resource: "contentPolicy.rollback",
    mutationFn: rollbackContentPolicy,
    reconcile: (client) => {
      void client.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.contentPolicyVersions(),
      });
      void client.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.contentPolicy(),
      });
    },
  });
}

export function dryRunContentPolicyVersionMutationOptions() {
  return serverMutationOptions({
    resource: "contentPolicy.versions.dryRun",
    mutationFn: ({ versionId, content }: { versionId: string; content: string }) =>
      dryRunContentPolicyVersion(versionId, content),
    reconcile: (client) => {
      void client.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.contentPolicyDecisions(),
      });
    },
  });
}

export function resolveContentPolicyApprovalMutationOptions() {
  return serverMutationOptions({
    resource: "contentPolicy.approvals.resolve",
    mutationFn: ({
      approvalId,
      decision,
    }: {
      approvalId: string;
      decision: "approve" | "deny";
    }) => resolveContentPolicyApproval(approvalId, { decision }),
    reconcile: (client) => {
      void client.invalidateQueries({
        exact: true,
        queryKey: appQueryKeys.contentPolicyApprovals(),
      });
    },
  });
}
