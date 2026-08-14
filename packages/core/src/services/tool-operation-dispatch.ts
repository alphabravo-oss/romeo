import { assertScope } from "@romeo/auth";

import type {
  ToolOperationDispatchRequestResult,
  ToolOperationDispatchResult,
} from "../domain/entities";
import { ApiError } from "../errors";
import { requirePublicApiErrorCode } from "../public-api-error-registry";
import {
  assertAbuseControlsAllow,
  type AbuseControlEnforcementInput,
} from "./abuse-control-service";
import {
  completeBackgroundJob,
  failBackgroundJob,
  queueBackgroundJob,
  startBackgroundJob,
} from "./job-service";
import {
  buildToolOperationTestPreview,
  type ToolOperationTestInput,
} from "./tool-operation-test";
import {
  auditDispatch,
  auditDispatchFailure,
  dispatchErrorCode,
  fetchBounded,
  sortedKeys,
  summarizeJob,
} from "./tool-operation-dispatch-execution";
import {
  assertDispatchApproval,
  auditDispatchEnqueue,
  deleteStoredPayload,
  dispatchPayloadStorage,
  dispatchRequestIdempotency,
  dispatchRequestResult,
  findIdempotentDispatchRequest,
  storeDispatchPayload,
} from "./tool-operation-dispatch-queue";
import {
  buildRequest,
  dispatchBaseHost,
  toolOperationDispatchTransport,
} from "./tool-operation-dispatch-request";
import type {
  DispatchToolOperationInput,
  EnqueueToolOperationDispatchInput,
} from "./tool-operation-dispatch-types";

export * from "./tool-operation-dispatch-types";
export { toolOperationDispatchTransport };

export async function dispatchToolOperation(
  input: DispatchToolOperationInput,
): Promise<ToolOperationDispatchResult> {
  assertScope(input.subject, "tools:manage");
  const previewInput: ToolOperationTestInput = {};
  if (input.parameters !== undefined)
    previewInput.parameters = input.parameters;
  if (input.body !== undefined) previewInput.body = input.body;
  const preview = buildToolOperationTestPreview(
    input.connector,
    input.operation,
    previewInput,
    {
      externalExecutionEnabled: input.externalExecutionEnabled,
    },
  );
  if (!preview.readyForExecution) {
    throw new ApiError(
      "tool_operation_not_ready",
      "Tool operation is not ready for external worker dispatch.",
      409,
      {
        disabledReasons: preview.disabledReasons,
      },
    );
  }
  await assertDispatchApproval(input, "tool.operation.dispatch");
  await assertAbuseControlsAllow(input.repository, input.subject, {
    action: "tool.dispatch",
    connectorId: input.connector.id,
    workerClass: "tool.operation.dispatch",
  });

  const job = await startBackgroundJob(input.repository, {
    orgId: input.subject.orgId,
    type: "tool.operation.dispatch",
    payload: {
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      method: input.operation.method,
      path: input.operation.path,
      parameterKeys: sortedKeys(input.parameters),
      bodyKeys: sortedKeys(input.body),
      ...(input.approvalRequestId === undefined
        ? {}
        : { approvalRequestId: input.approvalRequestId }),
    },
  });

  try {
    const request = await buildRequest(input);
    const response = await fetchBounded(
      input.fetchImpl,
      request.url,
      request.init,
      input.operation,
      input.timeoutMs,
      input.maxBytes,
    );
    const completed = await completeBackgroundJob(input.repository, job);
    await auditDispatch(input, completed, request, response, "success");
    return {
      job: summarizeJob(completed),
      connectorId: input.connector.id,
      operationId: input.operation.operationId,
      method: input.operation.method,
      pathTemplate: input.operation.path,
      request: {
        parameterKeys: sortedKeys(input.parameters),
        bodyKeys: sortedKeys(input.body),
        host: request.url.hostname,
        authInjected: request.authInjected,
      },
      response,
    };
  } catch (error) {
    const code = dispatchErrorCode(error);
    const failed = await failBackgroundJob(input.repository, job, code);
    await auditDispatchFailure(input, failed, code);
    if (error instanceof ApiError) throw error;
    throw new ApiError(
      requirePublicApiErrorCode(code),
      "Tool operation dispatch failed.",
      502,
    );
  }
}

export async function enqueueToolOperationDispatch(
  input: EnqueueToolOperationDispatchInput,
): Promise<ToolOperationDispatchRequestResult> {
  assertScope(input.subject, input.requiredScope ?? "tools:manage");
  const previewInput: ToolOperationTestInput = {};
  if (input.parameters !== undefined)
    previewInput.parameters = input.parameters;
  if (input.body !== undefined) previewInput.body = input.body;
  const preview = buildToolOperationTestPreview(
    input.connector,
    input.operation,
    previewInput,
    {
      externalExecutionEnabled: input.externalExecutionEnabled,
    },
  );
  if (!preview.readyForExecution) {
    throw new ApiError(
      "tool_operation_not_ready",
      "Tool operation is not ready for external worker dispatch.",
      409,
      {
        disabledReasons: preview.disabledReasons,
      },
    );
  }
  const host = dispatchBaseHost(input.connector);
  const idempotency = dispatchRequestIdempotency(input);
  if (idempotency !== undefined) {
    const existing = await findIdempotentDispatchRequest(
      input,
      idempotency.keyHash,
    );
    if (existing !== undefined) {
      await auditDispatchEnqueue(input, existing, host, {
        keyHash: idempotency.keyHash,
        replayed: true,
      });
      return dispatchRequestResult(input, existing, host, true);
    }
  }
  if (input.operation.approvalPolicy !== "never" && input.approved !== true) {
    await assertDispatchApproval(input, "tool.operation.dispatch.enqueue");
  }
  const enforcementInput: AbuseControlEnforcementInput =
    input.runContext === undefined
      ? {
          action: "tool.dispatch",
          connectorId: input.connector.id,
          workerClass: "external_tool_operations",
        }
      : {
          action: "tool.dispatch",
          connectorId: input.connector.id,
          toolId: input.runContext.toolId,
          workerClass: "external_tool_operations",
          workspaceId: input.runContext.workspaceId,
        };
  await assertAbuseControlsAllow(
    input.repository,
    input.subject,
    enforcementInput,
  );

  const storedPayload = await storeDispatchPayload(input);
  try {
    const result = await input.repository.transaction(async (repository) => {
      const scopedInput = { ...input, repository };
      if (idempotency !== undefined) {
        const existing = await findIdempotentDispatchRequest(
          scopedInput,
          idempotency.keyHash,
        );
        if (existing !== undefined) {
          await auditDispatchEnqueue(scopedInput, existing, host, {
            keyHash: idempotency.keyHash,
            replayed: true,
          });
          return dispatchRequestResult(scopedInput, existing, host, true);
        }
      }

      await assertDispatchApproval(
        scopedInput,
        "tool.operation.dispatch.enqueue",
      );
      const payloadStorage = dispatchPayloadStorage(storedPayload);
      const transport = toolOperationDispatchTransport(
        scopedInput.connector,
        scopedInput.operation,
      );
      const job = await queueBackgroundJob(repository, {
        ...(idempotency === undefined ? {} : { id: idempotency.jobId }),
        orgId: scopedInput.subject.orgId,
        ...(scopedInput.runContext === undefined
          ? {}
          : { workspaceId: scopedInput.runContext.workspaceId }),
        type: "tool.operation.dispatch_request",
        payload: {
          actorId: scopedInput.subject.id,
          connectorId: scopedInput.connector.id,
          operationId: scopedInput.operation.operationId,
          method: scopedInput.operation.method,
          path: scopedInput.operation.path,
          workerQueue: "external_tool_operations",
          host,
          approvalPolicy: scopedInput.operation.approvalPolicy,
          riskLevel: scopedInput.operation.riskLevel,
          parameterKeys: sortedKeys(scopedInput.parameters),
          bodyKeys: sortedKeys(scopedInput.body),
          payloadStorage,
          ...(transport === undefined ? {} : { transport }),
          ...(storedPayload === undefined
            ? {}
            : { payloadStore: storedPayload }),
          ...(scopedInput.runContext === undefined
            ? {}
            : {
                agentId: scopedInput.runContext.agentId,
                runSubjectGroupIds: scopedInput.subject.groupIds,
                runSubjectIsAdmin: scopedInput.subject.isAdmin === true,
                runSubjectScopes: scopedInput.subject.scopes,
                runSubjectType: scopedInput.subject.type,
                runSubjectWorkspaceIds: scopedInput.subject.workspaceIds,
                runContinuation: "model_tool_dispatch",
                runId: scopedInput.runContext.runId,
                toolId: scopedInput.runContext.toolId,
                workspaceId: scopedInput.runContext.workspaceId,
              }),
          ...(idempotency === undefined
            ? {}
            : {
                idempotencyKeyHash: idempotency.keyHash,
                idempotencyScope: idempotency.scope,
              }),
          ...(scopedInput.approvalRequestId === undefined
            ? {}
            : { approvalRequestId: scopedInput.approvalRequestId }),
        },
      });
      await auditDispatchEnqueue(
        scopedInput,
        job,
        host,
        idempotency === undefined
          ? undefined
          : {
              keyHash: idempotency.keyHash,
              replayed: false,
            },
      );
      return dispatchRequestResult(
        scopedInput,
        job,
        host,
        idempotency === undefined ? undefined : false,
      );
    });
    if (storedPayload !== undefined && result.idempotency?.replayed === true)
      await deleteStoredPayload(input, storedPayload);
    return result;
  } catch (error) {
    await deleteStoredPayload(input, storedPayload);
    throw error;
  }
}
