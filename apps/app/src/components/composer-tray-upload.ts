import type { FileObject } from "../features/files";
import { createChatFile, deleteChatFile, fileContentUrl } from "../features/files";
import { isFileReady } from "../features/files/types";
import { blobToBase64 } from "./workspace-controller-media";
import {
  fileStatusToTrayLifecycle,
  trayProgressPercent,
  type TrayLifecycle,
} from "./composer-tray-lifecycle";
import {
  metadataPageCount,
  metadataTranscript,
  safeAttachmentDownloadUrl,
} from "./composer-tray-media";

export function documentFieldsFromStoredFile(file: FileObject): {
  downloadUrl?: string;
  fileId: string;
  pageCount?: number;
  percent: number;
  status: TrayLifecycle;
  transcript?: string;
} {
  const status = isFileReady(file)
    ? "ready"
    : fileStatusToTrayLifecycle(file.status);
  const pageCount =
    file.extraction.pageCount === null || file.extraction.pageCount === undefined
      ? metadataPageCount(file.metadata)
      : file.extraction.pageCount;
  const transcript = metadataTranscript(file.metadata);
  const downloadUrl = safeAttachmentDownloadUrl(
    file.contentUrl ?? fileContentUrl(file.id),
  );
  return {
    fileId: file.id,
    percent: trayProgressPercent(status),
    status,
    ...(downloadUrl === undefined ? {} : { downloadUrl }),
    ...(pageCount === undefined ? {} : { pageCount }),
    ...(transcript === undefined ? {} : { transcript }),
  };
}

export async function uploadChatDocument(input: {
  file: File;
  fileName: string;
  mimeType: string;
  signal: AbortSignal;
  sizeBytes: number;
  workspaceId: string;
}) {
  const stored = await createChatFile({
    dataBase64: await blobToBase64(input.file),
    fileName: input.fileName,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    workspaceId: input.workspaceId,
  });
  if (input.signal.aborted) {
    await deleteChatFile(stored.id).catch(() => undefined);
    return undefined;
  }
  const next = documentFieldsFromStoredFile(stored);
  return {
    ...next,
    status:
      next.status === "uploading"
        ? ("scanning" as const)
        : next.status,
    percent: trayProgressPercent(
      next.status === "uploading" ? "scanning" : next.status,
    ),
  };
}
