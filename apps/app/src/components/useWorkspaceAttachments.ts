import type { QueryClient } from "@tanstack/react-query";
import { useState } from "react";

import {
  createChatFile,
  deleteChatFile,
  readFileContent,
  type FileObject,
} from "../features/files";
import { generateImages } from "../features/images";
import type { MessageKey } from "../lib/i18n";
import {
  blobToBase64,
  clientMessageId,
  safeAttachmentFileName,
} from "./workspace-controller-media";

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
  dataBase64: string;
  fileName: string;
  id: string;
  mimeType: ImageAttachmentMimeType;
  previewUrl: string;
  sizeBytes: number;
}

export interface PendingDocumentAttachment {
  fileId: string;
  fileName: string;
  id: string;
  mimeType: string;
  sizeBytes: number;
  reusable?: boolean;
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
    const attachments = await Promise.all(
      normalized.map(async ({ file, mimeType }) => ({
        id: clientMessageId(),
        fileName: safeAttachmentFileName(file.name),
        mimeType: mimeType!,
        sizeBytes: file.size,
        dataBase64: await blobToBase64(file),
        previewUrl: URL.createObjectURL(file),
      })),
    );
    setImageAttachments((current) => [...current, ...attachments]);
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
    try {
      const created = await Promise.all(
        normalized.map(async ({ file, mimeType }) => {
          const stored = await createChatFile({
            workspaceId,
            fileName: safeAttachmentFileName(file.name),
            mimeType: mimeType!,
            sizeBytes: file.size,
            dataBase64: await blobToBase64(file),
          });
          return {
            id: clientMessageId(),
            fileId: stored.id,
            fileName: stored.fileName,
            mimeType: stored.mimeType,
            sizeBytes: stored.sizeBytes,
          };
        }),
      );
      setDocumentAttachments((current) => [...current, ...created]);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("workspaceUnableUploadFiles"),
      );
    }
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
      setError(
        caught instanceof Error
          ? caught.message
          : t("workspaceUnableRemoveFile"),
      ),
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
        setError(
          caught instanceof Error
            ? caught.message
            : t("workspaceUnableReadImage"),
        );
      }
      return;
    }
    setDocumentAttachments((current) =>
      current.some((item) => item.fileId === file.id)
        ? current
        : [
            ...current,
            {
              id: clientMessageId(),
              fileId: file.id,
              fileName: file.fileName,
              mimeType: file.mimeType,
              sizeBytes: file.sizeBytes,
              reusable: true,
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
      await queryClient.invalidateQueries({
        queryKey: ["files", workspaceId],
      });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : t("workspaceUnableGenerateImage"),
      );
    }
  }

  function clearPendingAttachments(): void {
    setImageAttachments([]);
    setDocumentAttachments([]);
  }

  return {
    clearPendingAttachments,
    documentAttachments,
    handleAttachExistingFile,
    handleAttachFiles,
    handleAttachImages,
    handleGenerateImages,
    handleRemoveDocumentAttachment,
    handleRemoveImageAttachment,
    imageAttachments,
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
