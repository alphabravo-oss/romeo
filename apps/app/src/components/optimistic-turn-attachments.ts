import { fileContentUrl } from "../features";
import type { Message } from "../features/types";
import type {
  PendingDocumentAttachment,
  PendingImageAttachment,
} from "./useWorkspaceAttachments";

/**
 * The attachments to hang on the optimistic user row, shaped like the ones the
 * server will send back when the turn persists.
 *
 * `previewUrl` is the only field that has to be invented: an image is still an
 * in-memory object URL at this point, while a document has already been
 * uploaded and can be addressed by its content endpoint. Everything else the
 * composer already knows, which is why the row can render before the round
 * trip finishes.
 */
export function optimisticTurnAttachments(
  images: readonly PendingImageAttachment[],
  documents: readonly PendingDocumentAttachment[],
): Message["attachments"] {
  return [
    ...images.map((attachment) => ({
      id: attachment.id,
      messageId: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      kind: "image" as const,
      retainedInContext: true,
      previewUrl: attachment.previewUrl,
    })),
    ...documents.map((attachment) => ({
      id: attachment.id,
      messageId: attachment.id,
      fileName: attachment.fileName,
      mimeType: attachment.mimeType,
      sizeBytes: attachment.sizeBytes,
      kind: "document" as const,
      retainedInContext: true,
      previewUrl: fileContentUrl(attachment.fileId),
    })),
  ];
}
