import type { AuthSubject } from "@romeo/auth";
import type { BaseModel, ProviderInstance } from "@romeo/providers";

import type { RunRecord } from "../domain/entities";
import type { FileService } from "./file-service";
import type { ProviderOutputPart } from "./persist-output-parts";

export async function storeProviderOutputFile(input: {
  fileService: FileService;
  index: number;
  model: BaseModel;
  part: Required<Pick<ProviderOutputPart, "bytes" | "mediaType" | "type">>;
  provider: ProviderInstance;
  run: RunRecord;
  subject: AuthSubject;
}) {
  const file = await input.fileService.create(input.subject, {
    dataBase64: Buffer.from(input.part.bytes).toString("base64"),
    fileName: providerOutputFileName(
      input.run.id,
      input.index,
      input.part.mediaType,
    ),
    metadata: {
      modelId: input.model.id,
      providerId: input.provider.id,
      runId: input.run.id,
      source: "provider_output",
    },
    mimeType: input.part.mediaType,
    purpose: input.part.type === "image" ? "generated_image" : "voice_artifact",
    sizeBytes: input.part.bytes.byteLength,
    workspaceId: input.run.workspaceId,
  });
  return { fileId: file.id };
}

function providerOutputFileName(
  runId: string,
  index: number,
  mediaType: string,
) {
  const extension = (
    {
      "audio/flac": "flac",
      "audio/m4a": "m4a",
      "audio/mp4": "mp4",
      "audio/mpeg": "mp3",
      "audio/ogg": "ogg",
      "audio/wav": "wav",
      "audio/webm": "webm",
      "image/gif": "gif",
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    } as Record<string, string>
  )[mediaType];
  if (extension === undefined)
    throw new Error("provider_output_media_unsupported");
  return `provider-output-${runId}-${index}.${extension}`;
}
