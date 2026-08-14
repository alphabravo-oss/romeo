import * as appQueryKeys from "../../lib/app-query-keys";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import {
  approveRagPolicyChangeRequest,
  createRagPolicyChangeRequest,
  rejectRagPolicyChangeRequest,
  updateRagPolicy,
} from "./mutations";
import type {
  CreateRagPolicyChangeRequestInput,
  RagPolicyChangeRejectReasonCode,
  RagPolicyChangeRequest,
  RagPolicyReport,
} from "./types";

export function updateRagPolicyMutationOptions() {
  return serverMutationOptions({
    resource: "rag.policy.update",
    mutationFn: updateRagPolicy,
    reconcile: (client, policy: RagPolicyReport) => {
      client.setQueryData(appQueryKeys.ragPolicy(), policy);
    },
    invalidations: () => [
      { exact: true, queryKey: appQueryKeys.ragPolicy() },
      { exact: true, queryKey: appQueryKeys.ragPosture() },
      { exact: true, queryKey: appQueryKeys.agenticRagSettings() },
    ],
  });
}

export function createRagPolicyChangeRequestMutationOptions() {
  return serverMutationOptions<
    RagPolicyChangeRequest,
    Error,
    CreateRagPolicyChangeRequestInput
  >({
    resource: "rag.policyChangeRequest.create",
    mutationFn: createRagPolicyChangeRequest,
    reconcile: (client, request) => {
      client.setQueryData(appQueryKeys.ragPolicyChangeRequest(), request);
    },
    invalidations: () => [
      { exact: true, queryKey: appQueryKeys.ragPolicyChangeRequest() },
    ],
  });
}

export function approveRagPolicyChangeRequestMutationOptions() {
  return serverMutationOptions({
    resource: "rag.policyChangeRequest.approve",
    mutationFn: (requestId: string) =>
      approveRagPolicyChangeRequest(requestId, { confirmRequestId: requestId }),
    reconcile: (client, request: RagPolicyChangeRequest) => {
      client.setQueryData(appQueryKeys.ragPolicyChangeRequest(), request);
      if (request.applied !== undefined) {
        client.setQueryData(appQueryKeys.ragPolicy(), request.applied);
      }
    },
    invalidations: () => [
      { exact: true, queryKey: appQueryKeys.ragPolicyChangeRequest() },
      { exact: true, queryKey: appQueryKeys.ragPolicy() },
      { exact: true, queryKey: appQueryKeys.ragPosture() },
      { exact: true, queryKey: appQueryKeys.agenticRagSettings() },
    ],
  });
}

type RejectChangeRequestInput = {
  requestId: string;
  reasonCode: RagPolicyChangeRejectReasonCode;
};

export function rejectRagPolicyChangeRequestMutationOptions() {
  return serverMutationOptions({
    resource: "rag.policyChangeRequest.reject",
    mutationFn: (input: RejectChangeRequestInput) =>
      rejectRagPolicyChangeRequest(input.requestId, {
        confirmRequestId: input.requestId,
        reasonCode: input.reasonCode,
      }),
    reconcile: (client, request: RagPolicyChangeRequest) => {
      client.setQueryData(appQueryKeys.ragPolicyChangeRequest(), request);
    },
    invalidations: () => [
      { exact: true, queryKey: appQueryKeys.ragPolicyChangeRequest() },
    ],
  });
}
