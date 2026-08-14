import type { AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { FileObject, MessagePart } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { createId } from "../ids";
import { isFileReadyForUse } from "./file-lifecycle";
import type { ChatAttachmentInput } from "./message-attachments";
import { parseMessagePartV1 } from "./message-part-v1";
import { sha256Hex } from "./file-upload-normalization";
import { normalizeAttachmentBytes } from "./file-reference-inline";
import {
  assertFileMalwareScanClean,
  type FileMalwareScanner,
  type FileMalwareScanPolicy,
} from "./file-service";

export function planFileReferenceAttach(input: {
  files: Array<Pick<FileObject, "id" | "status" | "mimeType" | "fileName">>;
  messageId: string;
  now: string;
}):
  | { outcome: "accepted"; parts: MessagePart[] }
  | { outcome: "denied"; code: "file_not_ready"; fileId: string } {
  const parts: MessagePart[] = [];
  for (const [index, file] of input.files.entries()) {
    if (!isFileReadyForUse(file))
      return { outcome: "denied", code: "file_not_ready", fileId: file.id };
    parts.push(partForFile(file, input.messageId, index, input.now));
  }
  return { outcome: "accepted", parts };
}

export function reconcileAttachRetention(input: {
  referenceCount: number;
  legalHoldActive: boolean;
}): "ready" | "attached" | "retained" {
  if (input.legalHoldActive && input.referenceCount > 0) return "retained";
  if (input.referenceCount > 0) return "attached";
  return "ready";
}

export async function materializeInlineAttachmentsAsFiles(input: {
  attachments: ChatAttachmentInput[];
  messageId: string;
  now: string;
  objectStore: ObjectStore;
  orgId: string;
  ownerId: string;
  ownerType: AuthSubject["type"];
  repository: RomeoRepository;
  workspaceId: string;
  maxBytes?: number;
  malwareScanning?: {
    policy: FileMalwareScanPolicy;
    scanner?: FileMalwareScanner;
  };
}): Promise<{ files: FileObject[]; parts: MessagePart[] }> {
  const files: FileObject[] = [];
  for (const attachment of input.attachments) {
    const normalized = normalizeAttachmentBytes(attachment, input.maxBytes);
    if (input.malwareScanning !== undefined) {
      await assertFileMalwareScanClean(input.malwareScanning, {
        bytes: normalized.bytes,
        fileName: normalized.fileName,
        mimeType: normalized.mimeType,
      });
    }
    const fileId = createId("file");
    const objectKey = `files/${input.orgId}/${input.workspaceId}/${fileId}/${normalized.fileName}`;
    await input.objectStore.putObject({
      key: objectKey,
      body: normalized.bytes,
      contentType: normalized.mimeType,
    });
    files.push(
      await input.repository.createFileObject({
        id: fileId,
        orgId: input.orgId,
        workspaceId: input.workspaceId,
        ownerType: input.ownerType === "service_account" ? "service_account" : "user",
        ownerId: input.ownerId,
        fileName: normalized.fileName,
        mimeType: normalized.mimeType,
        sizeBytes: normalized.bytes.byteLength,
        sha256: sha256Hex(normalized.bytes),
        objectKey,
        purpose: "general",
        status: "ready",
        lifecycleVersion: 1,
        lifecycleAttempts: 1,
        metadata: { source: "inline_attachment" },
        createdAt: input.now,
        updatedAt: input.now,
      }),
    );
  }
  const planned = planFileReferenceAttach({
    files,
    messageId: input.messageId,
    now: input.now,
  });
  if (planned.outcome === "denied")
    throw new ApiError(
      "file_not_ready",
      "The file has not completed its security lifecycle.",
      409,
    );
  return { files, parts: planned.parts };
}

function partForFile(
  file: Pick<FileObject, "id" | "mimeType" | "fileName">,
  messageId: string,
  index: number,
  now: string,
): MessagePart {
  const image = file.mimeType.startsWith("image/");
  return parseMessagePartV1({
    schemaVersion: 1,
    ...(image
      ? {
          type: "image_ref" as const,
          fileId: file.id,
          mediaType: file.mimeType,
          altText: file.fileName,
        }
      : file.mimeType.startsWith("audio/")
        ? {
            type: "audio_ref" as const,
            fileId: file.id,
            mediaType: file.mimeType,
          }
        : {
            type: "document_ref" as const,
            fileId: file.id,
            fileName: file.fileName,
            mediaType: file.mimeType,
          }),
    id: createId("msg_part"),
    messageId,
    position: index + 1,
    createdAt: now,
    provenance: { source: "upload", sourceId: file.id },
  });
}
