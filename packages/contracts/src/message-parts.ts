import { z } from "@hono/zod-openapi";

const identifier = z
  .string()
  .trim()
  .min(1)
  .max(300)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,299}$/u);
const timestamp = z.iso.datetime();
const language = z
  .string()
  .trim()
  .min(2)
  .max(35)
  .regex(/^[A-Za-z]{2,8}(?:-[A-Za-z0-9]{1,8})*$/u);
const sha256 = z.string().regex(/^[A-Fa-f0-9]{64}$/u);
const mediaType = z
  .string()
  .trim()
  .min(3)
  .max(127)
  .regex(/^[a-z0-9][a-z0-9!#$&^_.+-]{0,62}\/[a-z0-9][a-z0-9!#$&^_.+-]{0,62}$/u);
const fileName = z
  .string()
  .trim()
  .min(1)
  .max(160)
  .refine(
    (value) =>
      !/[\u0000-\u001F\u007F]/u.test(value) &&
      !value.includes("/") &&
      !value.includes("\\") &&
      value !== "." &&
      value !== "..",
    "File name must not contain path separators or control characters.",
  );

export const MessageImageMimeTypeSchema = z.enum([
  "image/gif",
  "image/jpeg",
  "image/png",
  "image/webp",
]);
export const MessageAudioMimeTypeSchema = z.enum([
  "audio/flac",
  "audio/m4a",
  "audio/mp4",
  "audio/mpeg",
  "audio/ogg",
  "audio/wav",
  "audio/webm",
]);
export const MessageVideoMimeTypeSchema = z.enum([
  "video/mp4",
  "video/quicktime",
  "video/webm",
]);
export const MessageDocumentMimeTypeSchema = z.enum([
  "application/json",
  "application/pdf",
  "application/vnd.openxmlformats-officedocument.presentationml.presentation",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  "text/csv",
  "text/markdown",
  "text/plain",
]);

const dimensions = z
  .strictObject({
    width: z.number().int().positive().max(32_768),
    height: z.number().int().positive().max(32_768),
  })
  .refine(
    (value) => value.width * value.height <= 100_000_000,
    "Media dimensions exceed the 100 megapixel contract ceiling.",
  );

const mediaProvenance = z.strictObject({
  source: z.enum(["upload", "provider", "tool", "artifact", "import"]),
  sourceId: identifier.optional(),
  modelId: identifier.optional(),
  sha256: sha256.optional(),
  createdAt: timestamp.optional(),
});

const imageTransform = z.strictObject({
  sourceFileId: identifier.optional(),
  operations: z
    .array(z.enum(["crop", "resize", "rotate", "metadata_strip"]))
    .min(1)
    .max(8),
});

const partVersion = { schemaVersion: z.literal(1) } as const;

export const TextMessagePartSchema = z
  .strictObject({
    ...partVersion,
    type: z.literal("text"),
    text: z.string().min(1).max(1_000_000),
    language: language.optional(),
  })
  .openapi("TextMessagePart");

export const ImageRefMessagePartSchema = z
  .strictObject({
    ...partVersion,
    type: z.literal("image_ref"),
    fileId: identifier,
    mediaType: MessageImageMimeTypeSchema,
    dimensions: dimensions.optional(),
    altText: z.string().trim().min(1).max(2_000).optional(),
    transform: imageTransform.optional(),
    provenance: mediaProvenance.optional(),
  })
  .openapi("ImageRefMessagePart");

export const AudioRefMessagePartSchema = z
  .strictObject({
    ...partVersion,
    type: z.literal("audio_ref"),
    fileId: identifier,
    mediaType: MessageAudioMimeTypeSchema,
    durationMs: z.number().int().positive().max(14_400_000),
    transcriptPartId: identifier.optional(),
    waveformFileId: identifier.optional(),
    language: language.optional(),
    provenance: mediaProvenance.optional(),
  })
  .openapi("AudioRefMessagePart");

export const VideoRefMessagePartSchema = z
  .strictObject({
    ...partVersion,
    type: z.literal("video_ref"),
    fileId: identifier,
    mediaType: MessageVideoMimeTypeSchema,
    durationMs: z.number().int().positive().max(14_400_000),
    dimensions,
    transcriptPartId: identifier.optional(),
    keyframeFileIds: z.array(identifier).max(32).optional(),
    provenance: mediaProvenance.optional(),
  })
  .openapi("VideoRefMessagePart");

const pageSelection = z
  .strictObject({
    start: z.number().int().positive().max(100_000),
    end: z.number().int().positive().max(100_000),
  })
  .refine((value) => value.end >= value.start, {
    message: "The final selected page must not precede the first page.",
  });

export const DocumentRefMessagePartSchema = z
  .strictObject({
    ...partVersion,
    type: z.literal("document_ref"),
    fileId: identifier,
    fileName,
    mediaType: MessageDocumentMimeTypeSchema,
    pageSelection: pageSelection.optional(),
    extractedTextPartId: identifier.optional(),
    provenance: mediaProvenance.optional(),
  })
  .openapi("DocumentRefMessagePart");

export const ToolResultRefMessagePartSchema = z
  .strictObject({
    ...partVersion,
    type: z.literal("tool_result_ref"),
    toolCallId: identifier,
    toolResultId: identifier,
    outcome: z.enum(["succeeded", "failed", "cancelled"]),
    safePreview: z.string().max(2_000).optional(),
  })
  .openapi("ToolResultRefMessagePart");

export const ArtifactRefMessagePartSchema = z
  .strictObject({
    ...partVersion,
    type: z.literal("artifact_ref"),
    artifactId: identifier,
    artifactVersion: z.number().int().positive(),
    mediaType,
    title: z.string().trim().min(1).max(300),
    renderer: z.enum([
      "text",
      "markdown",
      "code",
      "table",
      "image",
      "audio",
      "video",
      "pdf",
      "download",
    ]),
  })
  .openapi("ArtifactRefMessagePart");

export const CitationRefMessagePartSchema = z
  .strictObject({
    ...partVersion,
    type: z.literal("citation_ref"),
    sourceId: identifier,
    documentId: identifier,
    chunkId: identifier.optional(),
    title: z.string().trim().min(1).max(1_000),
  })
  .openapi("CitationRefMessagePart");

const messagePartVariants = [
  TextMessagePartSchema,
  ImageRefMessagePartSchema,
  AudioRefMessagePartSchema,
  VideoRefMessagePartSchema,
  DocumentRefMessagePartSchema,
  ToolResultRefMessagePartSchema,
  ArtifactRefMessagePartSchema,
  CitationRefMessagePartSchema,
] as const;

export const MessagePartSchema = z
  .discriminatedUnion("type", messagePartVariants)
  .openapi("MessagePart");

const outputFields = {
  id: identifier,
  messageId: identifier,
  position: z.number().int().nonnegative().max(9_999),
  createdAt: timestamp,
} as const;

export const MessagePartOutputSchema = z
  .discriminatedUnion("type", [
    TextMessagePartSchema.extend(outputFields),
    ImageRefMessagePartSchema.extend(outputFields),
    AudioRefMessagePartSchema.extend(outputFields),
    VideoRefMessagePartSchema.extend(outputFields),
    DocumentRefMessagePartSchema.extend(outputFields),
    ToolResultRefMessagePartSchema.extend(outputFields),
    ArtifactRefMessagePartSchema.extend(outputFields),
    CitationRefMessagePartSchema.extend(outputFields),
  ])
  .openapi("MessagePartOutput");

export const MessageContentSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    parts: z.array(MessagePartSchema).min(1).max(100),
  })
  .openapi("MessageContent");

export const MessageContentOutputSchema = z
  .strictObject({
    schemaVersion: z.literal(1),
    parts: z.array(MessagePartOutputSchema).min(1).max(100),
  })
  .openapi("MessageContentOutput");

export type MessagePart = z.infer<typeof MessagePartSchema>;
export type MessagePartOutput = z.infer<typeof MessagePartOutputSchema>;
