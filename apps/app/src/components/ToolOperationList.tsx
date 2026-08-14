import { Button } from "@romeo/ui";
import { useMutation, useQuery } from "@tanstack/react-query";
import CheckCircle from "lucide-react/dist/esm/icons/check-circle.mjs";
import FlaskConical from "lucide-react/dist/esm/icons/flask-conical.mjs";
import Play from "lucide-react/dist/esm/icons/play.mjs";
import Power from "lucide-react/dist/esm/icons/power.mjs";
import { useMemo, useState } from "react";

import { RomeoApiError } from "@romeo/api-client";
import {
  dispatchToolOperationMutationOptions,
  toolOperationsQueryOptions,
  testToolOperationMutationOptions,
  updateToolOperationMutationOptions,
} from "../features/tool-connectors";
import type {
  ToolOperation,
  ToolOperationDispatchResult,
  ToolOperationTestPreview,
} from "../features/types";
import { useLocale, type MessageKey } from "../lib/i18n";
import { LocalizedBytes } from "../lib/locale-format";
import { type ColumnDef, DataTable, createColumnHelper } from "./DataTable";
import { ToolOperationTestResult } from "./ToolOperationTestResult";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import { useInventoriedServerTable } from "../lib/inventoried-server-table";

const col = createColumnHelper<ToolOperation>();

export function ToolOperationList({ connectorId }: { connectorId: string }) {
  const { t } = useLocale();
  const inventoriedTable = useInventoriedServerTable<ToolOperation>(
    "tool_operations",
    { parentId: connectorId },
  );
  const operationsQuery = useQuery(toolOperationsQueryOptions(connectorId));
  const testMutation = useMutation(testToolOperationMutationOptions());
  const operationMutation = useMutation(updateToolOperationMutationOptions());
  const dispatchMutation = useMutation(dispatchToolOperationMutationOptions());
  const [preview, setPreview] = useState<ToolOperationTestPreview>();
  const [dispatchResults, setDispatchResults] = useState<
    Record<string, ToolOperationDispatchResult>
  >({});
  const [approvalRequests, setApprovalRequests] = useState<
    Record<string, string>
  >({});
  const [error, setError] = useState<string>();
  const operations = operationsQuery.data ?? [];

  async function handleTest(operation: ToolOperation) {
    setError(undefined);
    try {
      const input = { connectorId, operationId: operation.operationId };
      const result = await testMutation.mutateAsync(
        operation.method === "get"
          ? input
          : { ...input, body: { sample: true } },
      );
      setPreview(result);
    } catch (caught) {
      setError(safeUserErrorMessage(caught, t("toolOperationUnableTest")));
    }
  }

  async function handleToggleOperation(operation: ToolOperation) {
    setError(undefined);
    try {
      await operationMutation.mutateAsync({
        connectorId,
        operationId: operation.operationId,
        enabled: !operation.enabled,
      });
    } catch (caught) {
      setError(safeUserErrorMessage(caught, t("toolOperationUnableUpdate")));
    }
  }

  async function handleDispatch(operation: ToolOperation, approved = false) {
    setError(undefined);
    const baseInput =
      operation.method === "get"
        ? { connectorId, operationId: operation.operationId }
        : {
            connectorId,
            operationId: operation.operationId,
            body: { sample: true },
          };
    const approvalRequestId = approvalRequests[operation.operationId];
    if (approved && approvalRequestId === undefined) {
      setError(t("toolOperationApprovalMissing"));
      return;
    }
    try {
      const result = await dispatchMutation.mutateAsync({
        ...baseInput,
        ...(approved ? { approved: true, approvalRequestId } : {}),
      });
      setDispatchResults((current) => ({
        ...current,
        [operation.operationId]: result,
      }));
      setApprovalRequests((current) => {
        const next = { ...current };
        delete next[operation.operationId];
        return next;
      });
    } catch (caught) {
      if (
        caught instanceof RomeoApiError &&
        caught.code === "tool_operation_approval_required"
      ) {
        const approvalRequestId =
          typeof caught.details.approvalRequestId === "string"
            ? caught.details.approvalRequestId
            : undefined;
        if (approvalRequestId !== undefined) {
          setApprovalRequests((current) => ({
            ...current,
            [operation.operationId]: approvalRequestId,
          }));
          setError(t("toolOperationApprovalRequired"));
          return;
        }
      }
      setError(safeUserErrorMessage(caught, t("toolOperationUnableDispatch")));
    }
  }

  const columns = useMemo<ColumnDef<ToolOperation, any>[]>(
    () => [
      col.accessor("name", {
        header: t("name"),
        cell: (c) => <span className="font-medium">{c.getValue()}</span>,
      }),
      col.accessor((row) => `${row.method.toUpperCase()} ${row.path}`, {
        id: "endpoint",
        header: t("toolOperationMethod"),
        cell: (c) => (
          <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
        ),
      }),
      col.accessor((row) => row.enabled, {
        id: "enabled",
        header: t("status"),
        cell: (c) => (
          <span className={`rm-status ${c.getValue() ? "pass" : "fail"}`}>
            {c.getValue() ? t("enabled") : t("disabled")}
          </span>
        ),
      }),
      col.accessor("approvalPolicy", {
        header: t("toolOperationApproval"),
        cell: (c) => (
          <span className="rm-cell-muted">
            {approvalPolicyLabel(c.getValue(), t)}
          </span>
        ),
      }),
      col.display({
        id: "actions",
        header: "",
        cell: (c) => {
          const operation = c.row.original;
          return (
            <div className="flex flex-wrap gap-2">
              <Button
                className="inline-flex min-h-8 items-center gap-2 px-2 text-xs"
                disabled={operationMutation.isPending}
                onClick={() => void handleToggleOperation(operation)}
                type="button"
              >
                <Power aria-hidden="true" size={14} />
                <span>
                  {operation.enabled
                    ? t("toolOperationDisable")
                    : t("toolOperationEnable")}
                </span>
              </Button>
              <Button
                className="inline-flex min-h-8 items-center gap-2 px-2 text-xs"
                disabled={testMutation.isPending}
                onClick={() => void handleTest(operation)}
                type="button"
              >
                <FlaskConical aria-hidden="true" size={14} />
                <span>
                  {testMutation.isPending
                    ? t("toolOperationTesting")
                    : t("toolOperationDryRun")}
                </span>
              </Button>
              <Button
                className="inline-flex min-h-8 items-center gap-2 px-2 text-xs"
                disabled={dispatchMutation.isPending}
                onClick={() => void handleDispatch(operation)}
                type="button"
              >
                <Play aria-hidden="true" size={14} />
                <span>
                  {dispatchMutation.isPending
                    ? t("toolOperationDispatching")
                    : t("toolOperationDispatch")}
                </span>
              </Button>
              {approvalRequests[operation.operationId] !== undefined ? (
                <Button
                  className="inline-flex min-h-8 items-center gap-2 px-2 text-xs"
                  disabled={dispatchMutation.isPending}
                  onClick={() => void handleDispatch(operation, true)}
                  type="button"
                >
                  <CheckCircle aria-hidden="true" size={14} />
                  <span>{t("toolOperationApprove")}</span>
                </Button>
              ) : null}
            </div>
          );
        },
      }),
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      approvalRequests,
      operationMutation.isPending,
      testMutation.isPending,
      dispatchMutation.isPending,
      t,
    ],
  );

  return (
    <div className="mt-2 grid gap-2">
      <DataTable
        serverState={inventoriedTable.serverState}
        columns={columns}
        data={inventoriedTable.rows}
        empty={t("toolOperationNone")}
      />
      {preview !== undefined ? (
        <ToolOperationTestResult preview={preview} />
      ) : null}
      {Object.entries(dispatchResults).map(([operationId, result]) => (
        <ToolOperationDispatchSummary key={operationId} result={result} />
      ))}
      {error ? (
        <div className="text-xs text-red-600" role="alert">
          {error}
        </div>
      ) : null}
    </div>
  );
}

function ToolOperationDispatchSummary({
  result,
}: {
  result: ToolOperationDispatchResult;
}) {
  const { t } = useLocale();
  return (
    <div className="mt-2 grid gap-1 rounded-md border border-border p-2 text-muted">
      <div>
        {t("toolOperationDispatch")}: {result.job.status} - HTTP{" "}
        {result.response.status}
      </div>
      <div>
        {t("toolOperationResponse")}:{" "}
        <LocalizedBytes value={result.response.bodyBytes} />
        {result.response.truncated ? ` ${t("toolOperationTruncated")}` : ""}
      </div>
      <div>
        {t("toolOperationSchema")}: {result.response.schemaValidation.status}
        {result.response.schemaValidation.errorCode
          ? ` (${result.response.schemaValidation.errorCode})`
          : ""}
      </div>
      <div>
        {t("toolOperationHost")}: {result.request.host}
      </div>
    </div>
  );
}

function approvalPolicyLabel(
  policy: string,
  t: (key: MessageKey) => string,
): string {
  if (policy === "never") return t("toolApprovalNever");
  if (policy === "always") return t("toolApprovalAlways");
  if (policy === "external_side_effects")
    return t("toolApprovalExternalSideEffects");
  if (policy === "write_operations") return t("toolApprovalWriteOperations");
  return policy;
}
