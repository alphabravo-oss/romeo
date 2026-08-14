import type { QueryClient } from "@tanstack/react-query";
import { useRef, useState } from "react";

import { readFileContent, type FileObject } from "../features/files";
import { generateImages } from "../features/images";
import type { MessageKey } from "../lib/i18n";
import { movePendingAttachment } from "./composer-attachment-input";
import {
  advanceTrayLifecycle,
  trayProgressPercent,
  type TrayLifecycle,
} from "./composer-tray-lifecycle";
import { imageAltText } from "./composer-tray-media";
import {
  documentFieldsFromStoredFile,
  uploadChatDocument,
} from "./composer-tray-upload";
import {
  blobToBase64,
  clientMessageId,
  safeAttachmentFileName,
} from "./workspace-controller-media";
import { safeUserErrorMessage } from "../lib/safe-user-error";
import * as appQueryKeys from "../lib/app-query-keys";
import { invalidateCachedResourceExactly } from "../lib/server-mutation-options";

const maxImageAttachmentBytes = 5_000_000;
const maxImageAttachments = 4;
const maxDocumentAttachmentBytes = 25_000_000;
const maxDocumentAttachments = 8;
const supportedDocumentMimeTypes = new Set([
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/html",
  "text/markdown",
  "text/plain",
]);
const supportedImageMimeTypes = new Set<ImageAttachmentMimeType>([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

export type ImageAttachmentMimeType =
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

export interface PendingImageAttachment {
  altText: string;
  dataBase64: string;
  fileName: string;
  height?: number;
  id: string;
  mimeType: ImageAttachmentMimeType;
  percent: number;
  previewUrl: string;
  sizeBytes: number;
  status: TrayLifecycle;
  width?: number;
}

export interface PendingDocumentAttachment {
  downloadUrl?: string;
  fileId?: string;
  fileName: string;
  id: string;
  mimeType: string;
  pageCount?: number;
  percent: number;
  reusable?: boolean;
  selectedPage?: number;
  sizeBytes: number;
  status: TrayLifecycle;
  transcript?: string;
}

interface WorkspaceAttachmentsOptions {
  queryClient: QueryClient;
  setError: (error: string | undefined) => void;
  t: (key: MessageKey) => string;
  workspaceId: string | undefined;
}

export function useWorkspaceAttachments({
  queryClient,
  setError,
  t,
  workspaceId,
}: WorkspaceAttachmentsOptions) {
  const [imageAttachments, setImageAttachments] = useState<
    PendingImageAttachment[]
  >([]);
  const [documentAttachments, setDocumentAttachments] = useState<
    PendingDocumentAttachment[]
  >([]);
  const uploads = useRef(new Map<string, AbortController>());
  const retryFiles = useRef(new Map<string, File>());

  function patchDocument(
    id: string,
    patch: Partial<PendingDocumentAttachment>,
  ): void {
    setDocumentAttachments((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  function patchImage(
    id: string,
    patch: Partial<PendingImageAttachment>,
  ): void {
    setImageAttachments((current) =>
      current.map((item) => (item.id === id ? { ...item, ...patch } : item)),
    );
  }

  async function handleAttachImages(files: File[]) {
    if (files.length === 0) return;
    const availableSlots = maxImageAttachments - imageAttachments.length;
    if (availableSlots <= 0 || files.length > availableSlots) {
      setError(t("workspaceImageCountLimit"));
      return;
    }
    const normalized = files.map((file) => ({
      file,
      mimeType: normalizeImageMimeType(file.type),
    }));
    if (normalized.some((item) => item.mimeType === undefined)) {
      setError(t("workspaceImageTypes"));
      return;
    }
    if (
      normalized.some(
        (item) =>
          item.file.size <= 0 || item.file.size > maxImageAttachmentBytes,
      )
    ) {
      setError(t("workspaceImageSizeLimit"));
      return;
    }
    setError(undefined);
    const placeholders = normalized.map(({ file, mimeType }) => {
      const fileName = safeAttachmentFileName(file.name);
      return {
        altText: imageAltText({ fileName }),
        dataBase64: "",
        fileName,
        id: clientMessageId(),
        mimeType: mimeType!,
        percent: trayProgressPercent("uploading"),
        previewUrl: URL.createObjectURL(file),
        sizeBytes: file.size,
        status: "uploading" as const,
      };
    });
    setImageAttachments((current) => [...current, ...placeholders]);
    await Promise.all(
      placeholders.map(async (placeholder, index) => {
        const file = normalized[index]!.file;
        const controller = new AbortController();
        uploads.current.set(placeholder.id, controller);
        try {
          const dataBase64 = await blobToBase64(file);
          if (controller.signal.aborted) return;
          patchImage(placeholder.id, {
            altText: imageAltText({ fileName: placeholder.fileName }),
            dataBase64,
            percent: trayProgressPercent("ready"),
            status: advanceTrayLifecycle(placeholder.status, "succeed"),
          });
        } catch {
          if (controller.signal.aborted) return;
          patchImage(placeholder.id, {
            percent: trayProgressPercent("failed"),
            status: "failed",
          });
        } finally {
          uploads.current.delete(placeholder.id);
        }
      }),
    );
  }

  async function handleAttachFiles(files: File[]) {
    const images = files.filter((file) => file.type.startsWith("image/"));
    const documents = files.filter((file) => !file.type.startsWith("image/"));
    if (images.length > 0) await handleAttachImages(images);
    if (documents.length === 0 || workspaceId === undefined) return;
    if (
      documentAttachments.length + documents.length >
      maxDocumentAttachments
    ) {
      setError(t("workspaceDocumentCountLimit"));
      return;
    }
    const normalized = documents.map((file) => ({
      file,
      mimeType: normalizeDocumentMimeType(file),
    }));
    if (normalized.some((item) => item.mimeType === undefined)) {
      setError(t("workspaceDocumentTypes"));
      return;
    }
    if (
      normalized.some(
        (item) =>
          item.file.size <= 0 || item.file.size > maxDocumentAttachmentBytes,
      )
    ) {
      setError(t("workspaceDocumentSizeLimit"));
      return;
    }
    setError(undefined);
    const placeholders = normalized.map(({ file, mimeType }) => {
      const id = clientMessageId();
      retryFiles.current.set(id, file);
      return {
        fileName: safeAttachmentFileName(file.name),
        id,
        mimeType: mimeType!,
        percent: trayProgressPercent("uploading"),
        sizeBytes: file.size,
        status: "uploading" as const,
      };
    });
    setDocumentAttachments((current) => [...current, ...placeholders]);
    await Promise.all(
      placeholders.map(async (placeholder) => {
        const file = retryFiles.current.get(placeholder.id);
        if (file === undefined) return;
        const controller = new AbortController();
        uploads.current.set(placeholder.id, controller);
        try {
          const next = await uploadChatDocument({
            file,
            fileName: placeholder.fileName,
            mimeType: placeholder.mimeType,
            signal: controller.signal,
            sizeBytes: placeholder.sizeBytes,
            workspaceId,
          });
          if (next === undefined) return;
          patchDocument(placeholder.id, next);
        } catch (caught) {
          if (controller.signal.aborted) return;
          patchDocument(placeholder.id, {
            percent: trayProgressPercent("failed"),
            status: "failed",
          });
          setError(safeUserErrorMessage(caught, t("workspaceUnableUploadFiles")));
        } finally {
          uploads.current.delete(placeholder.id);
        }
      }),
    );
  }



  function handleRemoveImageAttachment(attachmentId: string) {
    setImageAttachments((current) => {
      const removed = current.find(
        (attachment) => attachment.id === attachmentId,
      );
      if (removed !== undefined) URL.revokeObjectURL(removed.previewUrl);
      return current.filter((attachment) => attachment.id !== attachmentId);
    });
  }

  async function handleRemoveDocumentAttachment(attachmentId: string) {
    const attachment = documentAttachments.find(
      (item) => item.id === attachmentId,
    );
    if (attachment === undefined) return;
    setDocumentAttachments((current) =>
      current.filter((item) => item.id !== attachmentId),
    );
    if (attachment.reusable === true) return;
    await deleteChatFile(attachment.fileId).catch((caught) =>
      setError(safeUserErrorMessage(caught, t("workspaceUnableRemoveFile"))),
    );
  }

  async function handleAttachExistingFile(file: FileObject) {
    if (file.mimeType.startsWith("image/")) {
      try {
        const blob = await readFileContent(file.id);
        await handleAttachImages([
          new File([blob], file.fileName, { type: file.mimeType }),
        ]);
      } catch (caught) {
        setError(safeUserErrorMessage(caught, t("workspaceUnableReadImage")));
      }
      return;
    }
    setDocumentAttachments((current) =>
      current.some((item) => item.fileId === file.id)
        ? current
        : [
            ...current,
            {
              ...documentFieldsFromStoredFile(file),
              id: clientMessageId(),
              fileName: file.fileName,
              mimeType: file.mimeType,
              reusable: true,
              sizeBytes: file.sizeBytes,
            },
          ].slice(0, maxDocumentAttachments),
    );
  }

  async function handleGenerateImages(input: {
    modelId: string;
    prompt: string;
    size: "1024x1024" | "1024x1536" | "1536x1024";
  }) {
    if (workspaceId === undefined) return;
    setError(undefined);
    try {
      const artifacts = await generateImages({
        workspaceId,
        modelId: input.modelId,
        prompt: input.prompt,
        size: input.size,
      });
      for (const artifact of artifacts) {
        await handleAttachExistingFile(artifact.file);
      }
      await invalidateCachedResourceExactly(
        queryClient,
        appQueryKeys.files(workspaceId),
      );
    } catch (caught) {
      setError(safeUserErrorMessage(caught, t("workspaceUnableGenerateImage")));
    }
  }

  function clearPendingAttachments(): void {
    setImageAttachments([]);
    setDocumentAttachments([]);
  }

  function restorePendingAttachments(
    images: readonly PendingImageAttachment[],
    documents: readonly PendingDocumentAttachment[],
  ): void {
    setImageAttachments(
      images.map((image) => ({
        ...image,
        altText: image.altText ?? image.fileName,
        percent: image.percent ?? 100,
        status: image.status ?? "ready",
      })),
    );
    setDocumentAttachments(
      documents.map((document) => ({
        ...document,
        percent: document.percent ?? 100,
        status: document.status ?? "ready",
      })),
    );
  }

  function handleMoveDocumentAttachment(id: string, direction: -1 | 1): void {
    setDocumentAttachments((current) =>
      movePendingAttachment(current, id, direction),
    );
  }

  function handleMoveImageAttachment(id: string, direction: -1 | 1): void {
    setImageAttachments((current) =>
      movePendingAttachment(current, id, direction),
    );
  }

  function handleCancelAttachment(id: string): void {
    uploads.current.get(id)?.abort();
    uploads.current.delete(id);
    patchDocument(id, {
      percent: trayProgressPercent("cancelled"),
      status: "cancelled",
    });
    patchImage(id, {
      percent: trayProgressPercent("cancelled"),
      status: "cancelled",
    });
  }

  async function handleRetryDocumentAttachment(id: string): Promise<void> {
    const current = documentAttachments.find((item) => item.id === id);
    const file = retryFiles.current.get(id);
    if (current === undefined || file === undefined || workspaceId === undefined)
      return;
    patchDocument(id, {
      percent: trayProgressPercent("uploading"),
      status: advanceTrayLifecycle(current.status, "retry"),
    });
    const controller = new AbortController();
    uploads.current.set(id, controller);
    try {
      const next = await uploadChatDocument({
        file,
        fileName: current.fileName,
        mimeType: current.mimeType,
        signal: controller.signal,
        sizeBytes: current.sizeBytes,
        workspaceId,
      });
      if (next === undefined) return;
      patchDocument(id, next);
    } catch (caught) {
      if (controller.signal.aborted) return;
      patchDocument(id, {
        percent: trayProgressPercent("failed"),
        status: "failed",
      });
      setError(safeUserErrorMessage(caught, t("workspaceUnableUploadFiles")));
    } finally {
      uploads.current.delete(id);
    }
  }

  function handleSelectDocumentPage(id: string, selectedPage: number): void {
    patchDocument(id, { selectedPage });
  }

  return {
    clearPendingAttachments,
    documentAttachments,
    handleAttachExistingFile,
    handleAttachFiles,
    handleAttachImages,
    handleCancelAttachment,
    handleGenerateImages,
    handleMoveDocumentAttachment,
    handleMoveImageAttachment,
    handleRemoveDocumentAttachment,
    handleRemoveImageAttachment,
    handleRetryDocumentAttachment,
    handleSelectDocumentPage,
    imageAttachments,
    restorePendingAttachments,
  };
}

export function normalizeImageMimeType(
  value: string,
): ImageAttachmentMimeType | undefined {
  const normalized = value.split(";", 1)[0]?.toLowerCase() ?? "";
  return supportedImageMimeTypes.has(normalized as ImageAttachmentMimeType)
    ? (normalized as ImageAttachmentMimeType)
    : undefined;
}

function normalizeDocumentMimeType(file: File): string | undefined {
  const reported = file.type.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  if (supportedDocumentMimeTypes.has(reported)) return reported;
  const lower = file.name.toLowerCase();
  const byExtension: Array<[string, string]> = [
    [".csv", "text/csv"],
    [
      ".docx",
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ],
    [".html", "text/html"],
    [".htm", "text/html"],
    [".json", "application/json"],
    [".md", "text/markdown"],
    [".pdf", "application/pdf"],
    [
      ".pptx",
      "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ],
    [".txt", "text/plain"],
    [
      ".xlsx",
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ],
  ];
  return byExtension.find(([suffix]) => lower.endsWith(suffix))?.[1];
}
