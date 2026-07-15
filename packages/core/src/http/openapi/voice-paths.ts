import {
  arrayEnvelope,
  created,
  errorResponse,
  jsonContent,
  success,
} from "./helpers";

const speechArtifactSchema = {
  type: "object",
  required: ["id", "contentType", "playbackUrl", "deleteUrl", "redaction"],
  properties: {
    id: { type: "string" },
    contentType: { type: "string" },
    durationMs: { type: "integer", minimum: 0 },
    playbackUrl: { type: "string" },
    deleteUrl: { type: "string" },
    redaction: {
      type: "object",
      required: ["rawStorageKeyReturned"],
      properties: { rawStorageKeyReturned: { type: "boolean", enum: [false] } },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const voiceArtifactDeleteResultSchema = {
  type: "object",
  required: [
    "artifactId",
    "deleted",
    "deletedAt",
    "storageKeyHash",
    "redaction",
  ],
  properties: {
    artifactId: { type: "string" },
    deleted: { type: "boolean" },
    deletedAt: { type: "string", format: "date-time" },
    storageKeyHash: { type: "string", pattern: "^[a-f0-9]{64}$" },
    redaction: {
      type: "object",
      required: ["rawStorageKeyReturned"],
      properties: { rawStorageKeyReturned: { type: "boolean", enum: [false] } },
      additionalProperties: false,
    },
  },
  additionalProperties: false,
};

const audioArtifactContent = Object.fromEntries(
  ["audio/mpeg", "audio/ogg", "audio/wav", "audio/wave", "audio/x-wav"].map(
    (contentType) => [
      contentType,
      { schema: { type: "string", format: "binary" } },
    ],
  ),
);

export const voicePaths = {
  "/voices": {
    get: {
      summary: "List voice profiles",
      responses: { 200: arrayEnvelope("Voice profile"), 403: errorResponse },
    },
    post: {
      summary: "Create a voice profile",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateVoiceProfileRequest",
        }),
      },
      responses: {
        201: created("Voice profile"),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/voices/sync": {
    post: {
      summary: "Sync voice profiles from the configured provider catalog",
      responses: {
        200: success("Voice catalog sync result"),
        403: errorResponse,
        409: errorResponse,
        413: errorResponse,
      },
    },
  },
  "/voices/{voiceProfileId}/preview": {
    post: {
      summary: "Preview a voice profile",
      parameters: [
        {
          name: "voiceProfileId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/PreviewVoiceRequest",
        }),
      },
      responses: {
        200: success("Speech artifact", speechArtifactSchema),
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/agents/{agentId}/voice": {
    post: {
      summary: "Bind a default voice to an agent draft",
      parameters: [{ $ref: "#/components/parameters/AgentId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/BindAgentVoiceRequest",
        }),
      },
      responses: {
        200: success("Agent"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/messages/{messageId}/speech": {
    post: {
      summary: "Generate speech for an assistant message",
      parameters: [
        {
          name: "messageId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/GenerateMessageSpeechRequest",
        }),
      },
      responses: {
        200: success("Speech artifact", speechArtifactSchema),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/voice/transcriptions": {
    post: {
      summary: "Transcribe bounded audio input",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/TranscribeVoiceRequest",
        }),
      },
      responses: {
        200: success("Transcription result"),
        400: errorResponse,
        403: errorResponse,
        409: errorResponse,
        413: errorResponse,
      },
    },
  },
  "/voice-artifacts/{artifactId}": {
    get: {
      summary: "Read an authorized generated voice artifact",
      parameters: [
        {
          name: "artifactId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: {
          description: "Generated audio artifact",
          content: audioArtifactContent,
        },
        403: errorResponse,
        404: errorResponse,
      },
    },
    delete: {
      summary: "Delete an authorized generated voice artifact",
      parameters: [
        {
          name: "artifactId",
          in: "path",
          required: true,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: success(
          "Voice artifact deletion result",
          voiceArtifactDeleteResultSchema,
        ),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
};
