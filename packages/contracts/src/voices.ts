import { createRoute, z } from "@hono/zod-openapi";
import {
  authenticationSecurity,
  dataEnvelope,
  jsonResponse,
  standardErrorResponses,
} from "./common";
const id = z.string().trim().min(1).max(300);
const time = z.iso.datetime();
export const VoiceProfileSchema = z
  .strictObject({
    id,
    orgId: id,
    providerId: id,
    providerVoiceId: id,
    name: z.string(),
    language: z.string(),
    styleTags: z.array(z.string()),
    cloningAllowed: z.boolean(),
    enabled: z.boolean(),
    createdAt: time,
    updatedAt: time,
  })
  .openapi("VoiceProfile");
export const CreateVoiceProfileSchema = z
  .strictObject({
    name: z.string().min(1),
    providerVoiceId: id,
    language: z.string().min(2),
    styleTags: z.array(z.string().min(1)).default([]),
  })
  .openapi("CreateVoiceProfileRequest");
export const VoiceCatalogSyncResultSchema = z
  .strictObject({
    imported: z.number().int().nonnegative(),
    existing: z.number().int().nonnegative(),
    providerVoiceCount: z.number().int().nonnegative(),
    profiles: z.array(VoiceProfileSchema),
  })
  .openapi("VoiceCatalogSyncResult");
export const PublicSpeechArtifactSchema = z
  .strictObject({
    id,
    contentType: z.string(),
    durationMs: z.number().int().nonnegative().optional(),
    playbackUrl: z.string(),
    deleteUrl: z.string(),
    redaction: z.strictObject({ rawStorageKeyReturned: z.literal(false) }),
  })
  .openapi("PublicSpeechArtifact");
export const TranscriptionResultSchema = z
  .strictObject({
    text: z.string(),
    language: z.string().optional(),
    durationMs: z.number().int().nonnegative().optional(),
  })
  .openapi("TranscriptionResult");
export const VoiceArtifactDeleteResultSchema = z
  .strictObject({
    artifactId: id,
    deleted: z.boolean(),
    deletedAt: time,
    storageKeyHash: z.string().regex(/^[a-f0-9]{64}$/u),
    redaction: z.strictObject({ rawStorageKeyReturned: z.literal(false) }),
  })
  .openapi("VoiceArtifactDeleteResult");
export const TranscribeVoiceSchema = z
  .strictObject({
    audioBase64: z.string().min(1).max(14_000_000),
    contentType: z.string().min(1).max(120),
    fileName: z.string().min(1).max(200).optional(),
    language: z.string().min(2).max(20).optional(),
    prompt: z.string().min(1).max(500).optional(),
  })
  .openapi("TranscribeVoiceRequest");
const meta = { tags: ["Voices"], security: authenticationSecurity };
const errors = standardErrorResponses;
const body = <T extends z.ZodType>(schema: T) => ({
  required: true as const,
  content: { "application/json": { schema } },
});
const voicePath = z.strictObject({ voiceProfileId: id });
const artifactPath = z.strictObject({ artifactId: id });
export const listVoicesRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/voices",
  operationId: "voices.list",
  summary: "List",
  responses: {
    200: jsonResponse(
      "Voice profiles",
      dataEnvelope(z.array(VoiceProfileSchema)),
    ),
    ...errors,
  },
});
export const createVoiceProfileRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/voices",
  operationId: "voices.create",
  summary: "Create",
  request: { body: body(CreateVoiceProfileSchema) },
  responses: {
    201: jsonResponse("Voice profile", dataEnvelope(VoiceProfileSchema)),
    ...errors,
  },
});
export const syncVoiceCatalogRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/voices/sync",
  operationId: "voices.syncCatalog",
  summary: "Sync catalog",
  responses: {
    200: jsonResponse(
      "Voice catalog sync",
      dataEnvelope(VoiceCatalogSyncResultSchema),
    ),
    ...errors,
  },
});
export const previewVoiceRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/voices/{voiceProfileId}/preview",
  operationId: "voices.preview",
  summary: "Preview",
  request: {
    params: voicePath,
    body: body(z.strictObject({ text: z.string().min(1).max(500) })),
  },
  responses: {
    200: jsonResponse(
      "Speech artifact",
      dataEnvelope(PublicSpeechArtifactSchema),
    ),
    ...errors,
  },
});
export const generateMessageSpeechRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/messages/{messageId}/speech",
  operationId: "voices.generateMessageSpeech",
  summary: "Generate message speech",
  request: {
    params: z.strictObject({ messageId: id }),
    body: body(z.strictObject({ voiceProfileId: id })),
  },
  responses: {
    200: jsonResponse(
      "Speech artifact",
      dataEnvelope(PublicSpeechArtifactSchema),
    ),
    ...errors,
  },
});
export const transcribeVoiceRoute = createRoute({
  ...meta,
  method: "post",
  path: "/api/v1/voice/transcriptions",
  operationId: "voices.transcribe",
  summary: "Transcribe",
  request: { body: body(TranscribeVoiceSchema) },
  responses: {
    200: jsonResponse("Transcription", dataEnvelope(TranscriptionResultSchema)),
    ...errors,
  },
});
const audioContent = Object.fromEntries(
  ["audio/mpeg", "audio/ogg", "audio/wav", "audio/wave", "audio/x-wav"].map(
    (contentType) => [
      contentType,
      { schema: z.string().openapi({ format: "binary" }) },
    ],
  ),
);
export const readVoiceArtifactRoute = createRoute({
  ...meta,
  method: "get",
  path: "/api/v1/voice-artifacts/{artifactId}",
  operationId: "voices.readArtifact",
  summary: "Read artifact",
  request: { params: artifactPath },
  responses: {
    200: { description: "Generated audio", content: audioContent },
    ...errors,
  },
});
export const deleteVoiceArtifactRoute = createRoute({
  ...meta,
  method: "delete",
  path: "/api/v1/voice-artifacts/{artifactId}",
  operationId: "voices.deleteArtifact",
  summary: "Delete artifact",
  request: { params: artifactPath },
  responses: {
    200: jsonResponse(
      "Deleted voice artifact",
      dataEnvelope(VoiceArtifactDeleteResultSchema),
    ),
    ...errors,
  },
});
export const voiceRoutes = [
  listVoicesRoute,
  createVoiceProfileRoute,
  syncVoiceCatalogRoute,
  previewVoiceRoute,
  generateMessageSpeechRoute,
  transcribeVoiceRoute,
  readVoiceArtifactRoute,
  deleteVoiceArtifactRoute,
] as const;
