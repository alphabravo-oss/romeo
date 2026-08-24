import { getFile, isFileReady, type FileObject } from "../features/files";
import type { TrayLifecycle } from "./composer-tray-lifecycle";
import type { AudioAccessibility } from "./composer-tray-media";

export const maxImageAttachmentBytes = 5_000_000;
export const maxImageAttachments = 4;
export const maxDocumentAttachmentBytes = 25_000_000;
export const maxDocumentAttachments = 8;

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

export type ImageAttachmentMimeType =
  | "image/gif"
  | "image/jpeg"
  | "image/png"
  | "image/webp";

const supportedImageMimeTypes = new Set<ImageAttachmentMimeType>([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

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
  audioAccessibility?: AudioAccessibility;
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

interface GeneratedImageReadinessOptions {
  delay?: () => Promise<void>;
  maxAttempts?: number;
  read?: (fileId: string) => Promise<FileObject>;
}

export async function waitForGeneratedImageReady(
  fileId: string,
  options: GeneratedImageReadinessOptions = {},
): Promise<FileObject> {
  const delay =
    options.delay ??
    (() => new Promise<void>((resolve) => window.setTimeout(resolve, 100)));
  const maxAttempts = options.maxAttempts ?? 100;
  const read = options.read ?? getFile;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const file = await read(fileId);
    if (isFileReady(file)) return file;
    if (file.status === "failed" || file.status === "deleted") {
      throw new Error("Generated image did not pass its file lifecycle.");
    }
    if (attempt + 1 < maxAttempts) await delay();
  }
  throw new Error("Generated image file lifecycle did not become ready.");
}

export function normalizeImageMimeType(
  value: string,
): ImageAttachmentMimeType | undefined {
  const normalized = value.split(";", 1)[0]?.toLowerCase() ?? "";
  return supportedImageMimeTypes.has(normalized as ImageAttachmentMimeType)
    ? (normalized as ImageAttachmentMimeType)
    : undefined;
}

export function normalizeDocumentMimeType(file: File): string | undefined {
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
