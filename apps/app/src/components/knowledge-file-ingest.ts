import {
  completeKnowledgeUpload,
  createKnowledgeUpload,
  extractKnowledgeSource,
} from "../features";
import type { KnowledgeSource } from "../features/types";
import {
  canInlineUpload,
  isDeferredKnowledgeMime,
  mimeTypeFor,
} from "./knowledge-file-utils";

export async function ingestKnowledgeFile(input: {
  file: File;
  knowledgeBaseId: string;
}): Promise<KnowledgeSource> {
  const mimeType = mimeTypeFor(input.file.name, input.file.type);
  const registration = await createKnowledgeUpload({
    knowledgeBaseId: input.knowledgeBaseId,
    fileName: input.file.name,
    mimeType,
    sizeBytes: Math.max(1, input.file.size),
  });
  const put = await fetch(registration.upload.url, {
    method: registration.upload.method,
    headers: registration.upload.headers,
    body: input.file,
  });
  if (!put.ok) {
    throw new Error(
      `Could not upload ${input.file.name} (${put.status} ${put.statusText}).`,
    );
  }
  if (canInlineUpload(mimeType)) {
    return completeKnowledgeUpload({
      knowledgeBaseId: input.knowledgeBaseId,
      sourceId: registration.source.id,
    });
  }
  if (isDeferredKnowledgeMime(mimeType)) {
    const extracted = await extractKnowledgeSource({
      knowledgeBaseId: input.knowledgeBaseId,
      sourceId: registration.source.id,
    });
    return extracted.source;
  }
  return registration.source;
}
