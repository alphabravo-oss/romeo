import type { Message } from "../features/types";
import {
  normalizeImageMimeType,
  type ImageAttachmentMimeType,
} from "./useWorkspaceAttachments";
import { blobToBase64 } from "./workspace-controller-media";

/**
 * Re-uploads a persisted turn's images so a regenerate or an edit carries the
 * same pictures. The run API takes bytes, not ids, so the stored preview is
 * fetched back and re-encoded; anything that is not an image is skipped.
 */
export async function resolveAttachmentsForResend(
  attachments: Message["attachments"],
): Promise<
  Array<{
    dataBase64: string;
    fileName: string;
    mimeType: ImageAttachmentMimeType;
    sizeBytes: number;
  }>
> {
  if (attachments === undefined || attachments.length === 0) return [];
  const resolved = [];
  for (const attachment of attachments) {
    const mimeType = normalizeImageMimeType(attachment.mimeType);
    if (attachment.previewUrl === undefined || mimeType === undefined) continue;
    const response = await fetch(attachment.previewUrl);
    if (!response.ok) {
      throw new Error(`Unable to re-fetch attachment ${attachment.fileName}.`);
    }
    const blob = await response.blob();
    resolved.push({
      dataBase64: await blobToBase64(blob),
      fileName: attachment.fileName,
      mimeType,
      sizeBytes: blob.size,
    });
  }
  return resolved;
}
