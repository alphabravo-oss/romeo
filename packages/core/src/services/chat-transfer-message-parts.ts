import { hasWorkspaceAccess, type AuthSubject } from "@romeo/auth";
import type { MessagePart as TransferMessagePart } from "@romeo/contracts";

import type { MessagePart } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { canReadFile } from "./file-object-state";
import { isFileReadyForUse } from "./file-lifecycle";
import {
  isLegacyAttachmentPart,
  isMessagePartV1,
  parseMessagePartV1,
} from "./message-part-v1";

export async function portableTransferParts(input: {
  parts: MessagePart[];
  repository: RomeoRepository;
  subject: AuthSubject;
  workspaceId: string;
}): Promise<TransferMessagePart[]> {
  const portable: TransferMessagePart[] = [];
  for (const part of input.parts) {
    if (!isMessagePartV1(part)) continue;
    if (part.type === "text") {
      portable.push({ schemaVersion: 1, type: "text", text: part.text });
      continue;
    }
    if (part.type !== "image_ref" && part.type !== "document_ref")
      throw unsupportedTransferPart();
    const file = await authorizedTransferFile(input, part.fileId);
    if (part.type === "image_ref") {
      if (file.mimeType !== part.mediaType) throw notFound("File");
      portable.push({
        schemaVersion: 1,
        type: "image_ref",
        fileId: file.id,
        mediaType: part.mediaType,
        ...(part.altText === undefined ? {} : { altText: part.altText }),
        ...(part.dimensions === undefined
          ? {}
          : { dimensions: part.dimensions }),
        provenance: { source: "import", sourceId: file.id },
      });
    } else {
      if (file.mimeType !== part.mediaType || file.fileName !== part.fileName)
        throw notFound("File");
      portable.push({
        schemaVersion: 1,
        type: "document_ref",
        fileId: file.id,
        fileName: file.fileName,
        mediaType: part.mediaType,
        ...(part.pageSelection === undefined
          ? {}
          : { pageSelection: part.pageSelection }),
        provenance: { source: "import", sourceId: file.id },
      });
    }
  }
  return portable;
}

export async function materializeTransferParts(input: {
  createdAt: string;
  messageId: string;
  parts: TransferMessagePart[];
  positionOffset: number;
  repository: RomeoRepository;
  subject: AuthSubject;
  workspaceId: string;
}): Promise<MessagePart[]> {
  const materialized: MessagePart[] = [];
  for (const part of input.parts) {
    if (part.type === "text") continue;
    if (part.type !== "image_ref" && part.type !== "document_ref")
      throw unsupportedTransferPart();
    const file = await authorizedTransferFile(input, part.fileId);
    if (
      file.mimeType !== part.mediaType ||
      (part.type === "document_ref" && file.fileName !== part.fileName)
    )
      throw notFound("File");
    materialized.push(
      parseMessagePartV1({
        ...part,
        id: createId("msg_part"),
        messageId: input.messageId,
        position: input.positionOffset + materialized.length,
        createdAt: input.createdAt,
        provenance: { source: "import", sourceId: file.id },
      }),
    );
  }
  return materialized;
}

export async function assertTransferPartsImportable(input: {
  parts: TransferMessagePart[];
  repository: RomeoRepository;
  subject: AuthSubject;
  workspaceId: string;
}): Promise<void> {
  for (const part of input.parts) {
    if (part.type === "text") continue;
    if (part.type !== "image_ref" && part.type !== "document_ref")
      throw unsupportedTransferPart();
    const file = await authorizedTransferFile(input, part.fileId);
    if (
      file.mimeType !== part.mediaType ||
      (part.type === "document_ref" && file.fileName !== part.fileName)
    )
      throw notFound("File");
  }
}

export function copyAttachmentParts(
  parts: MessagePart[],
  messageId: string,
): MessagePart[] {
  return parts.filter(isLegacyAttachmentPart).map((part) => ({
    id: createId("msg_part"),
    messageId,
    type: "attachment",
    content: part.content,
    metadata: { ...part.metadata },
  }));
}

export function assertImportTextMatchesContent(
  messages: Array<{ content: string; parts?: TransferMessagePart[] }>,
): void {
  for (const message of messages) {
    const textParts = (message.parts ?? []).filter(
      (part): part is Extract<TransferMessagePart, { type: "text" }> =>
        part.type === "text",
    );
    if (
      textParts.length > 1 ||
      (textParts.length === 1 && textParts[0]!.text !== message.content)
    )
      throw new ApiError(
        "invalid_request",
        "Imported message text parts must match the canonical message content.",
        400,
      );
  }
}

async function authorizedTransferFile(
  input: {
    repository: RomeoRepository;
    subject: AuthSubject;
    workspaceId: string;
  },
  fileId: string,
) {
  const file = await input.repository.getFileObject(fileId);
  if (
    file === undefined ||
    file.orgId !== input.subject.orgId ||
    file.workspaceId !== input.workspaceId ||
    !isFileReadyForUse(file) ||
    !hasWorkspaceAccess(input.subject, file.workspaceId)
  )
    throw notFound("File");
  const grants = await input.repository.listResourceGrants(input.subject.orgId);
  if (!canReadFile(input.subject, grants, file)) throw notFound("File");
  return file;
}

function unsupportedTransferPart(): ApiError {
  return new ApiError(
    "unsupported_message_attachment_type",
    "The imported message part type is not supported by reference-preserving transfer.",
    415,
  );
}
