import type { ToolOperationTestPreview } from "../features/types";
import { useLocale, type MessageKey } from "../lib/i18n";

export function ToolOperationTestResult({
  preview,
}: {
  preview: ToolOperationTestPreview;
}) {
  const { t } = useLocale();
  const keys = [
    ...preview.requestPreview.parameterKeys,
    ...preview.requestPreview.bodyKeys.map((key) => `body.${key}`),
  ];
  return (
    <div className="mt-2 rounded-md border border-border px-2 py-1 text-xs">
      <div className="flex items-center justify-between gap-2">
        <span className="font-medium">
          {preview.readyForExecution
            ? t("toolOperationReady")
            : t("toolOperationDryRunOnly")}
        </span>
        <span className="text-muted">
          {t(
            networkExecutionMessageKey(preview.requestPreview.networkExecution),
          )}
        </span>
      </div>
      <div className="break-words text-muted">
        {preview.method.toUpperCase()} {preview.pathTemplate}
      </div>
      <div className="break-words text-muted">
        {preview.disabledReasons
          .map((reason) => t(disabledReasonMessageKey(reason)))
          .join(", ")}
      </div>
      {keys.length > 0 ? (
        <div className="break-words text-muted">
          {t("toolOperationKeys")}: {keys.join(", ")}
        </div>
      ) : null}
    </div>
  );
}

function networkExecutionMessageKey(
  value: ToolOperationTestPreview["requestPreview"]["networkExecution"],
): MessageKey {
  return value === "worker_ready"
    ? "toolNetworkWorkerReady"
    : "toolNetworkExecutionDisabled";
}

function disabledReasonMessageKey(
  reason: ToolOperationTestPreview["disabledReasons"][number],
): MessageKey {
  if (reason === "auth_not_configured") return "toolDisabledAuthNotConfigured";
  if (reason === "base_url_missing") return "toolDisabledBaseUrlMissing";
  if (reason === "connector_disabled") return "toolDisabledConnector";
  if (reason === "external_execution_disabled")
    return "toolDisabledExternalExecution";
  if (reason === "network_policy_missing") return "toolDisabledNetworkPolicy";
  return "toolDisabledOperation";
}
