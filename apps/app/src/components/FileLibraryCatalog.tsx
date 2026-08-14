import { Button, StatusBadge } from "@romeo/ui";
import { useMutation } from "@tanstack/react-query";

import {
  fileLifecycleMutationOptions,
  isFileReady,
  type FileObject,
} from "../features/files";
import { useLocale } from "../lib/i18n";
import { formatBytes } from "../lib/locale-format";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import { fileExtractionLabel } from "./chat-composer-utils";

export function FileLibraryCatalog({
  files,
  onAttach,
  onClose,
  workspaceId,
}: {
  files: FileObject[];
  onAttach: (file: FileObject) => void;
  onClose: () => void;
  workspaceId: string | undefined;
}) {
  const { locale, t } = useLocale();
  const lifecycle = useMutation(fileLifecycleMutationOptions());
  const labels: Record<FileObject["status"], string> = {
    attached: t("fileLifecycleAttached"),
    available: t("fileLifecycleReady"),
    deleted: t("fileLifecycleDeleted"),
    extracting: t("fileLifecycleExtracting"),
    failed: t("fileLifecycleFailed"),
    quarantined: t("fileLifecycleQuarantined"),
    ready: t("fileLifecycleReady"),
    retained: t("fileLifecycleRetained"),
    scanning: t("fileLifecycleScanning"),
    transcoding: t("fileLifecycleTranscoding"),
    uploading: t("fileLifecycleUploading"),
  };

  return (
    <>
      <div aria-live="polite" className="sr-only">
        {lifecycle.isPending ? t("fileLifecycleUpdating") : ""}
      </div>
      {files.map((file) => {
        const ready = isFileReady(file);
        return (
          <div className="rm-list-row flex items-center gap-2" key={file.id}>
            <Button
              className="min-w-0 flex-1 text-left"
              disabled={!ready || lifecycle.isPending}
              onClick={() => {
                onAttach(file);
                onClose();
              }}
              type="button"
            >
              <span>
                <strong>{file.fileName}</strong>
                <small className="block text-muted">
                  {file.mimeType} · {formatBytes(file.sizeBytes, locale)} ·{" "}
                  {fileExtractionLabel(file)}
                </small>
              </span>
            </Button>
            <StatusBadge
              tone={
                file.status === "failed"
                  ? "danger"
                  : ready
                    ? "success"
                    : "warning"
              }
            >
              {labels[file.status]}
            </StatusBadge>
            {file.status === "failed" && file.lifecycle.retryable ? (
              <Button
                aria-label={`${t("retry")} ${file.fileName}`}
                disabled={lifecycle.isPending}
                onClick={() =>
                  lifecycle.mutate({
                    action: "retry_lifecycle",
                    fileId: file.id,
                    workspaceId,
                  })
                }
                type="button"
              >
                {t("retry")}
              </Button>
            ) : null}
            {ready && file.extraction.status === "failed" ? (
              <Button
                aria-label={`${t("retry")} ${file.fileName}`}
                disabled={lifecycle.isPending}
                onClick={() =>
                  lifecycle.mutate({
                    action: "retry_extraction",
                    fileId: file.id,
                    workspaceId,
                  })
                }
                type="button"
              >
                {t("retry")}
              </Button>
            ) : null}
            {!ready ? (
              <Button
                aria-label={`${t("cancel")} ${file.fileName}`}
                disabled={lifecycle.isPending}
                onClick={() =>
                  lifecycle.mutate({
                    action: "delete",
                    fileId: file.id,
                    workspaceId,
                  })
                }
                type="button"
                variant="danger"
              >
                {t("cancel")}
              </Button>
            ) : null}
          </div>
        );
      })}
      {lifecycle.isError ? (
        <p aria-live="polite" className="rm-composer-error">
          {safeUserErrorMessage(lifecycle.error, t("unexpectedAsyncFailure"))}
        </p>
      ) : null}
    </>
  );
}
