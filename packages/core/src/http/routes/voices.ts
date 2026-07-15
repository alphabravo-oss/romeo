import type { RomeoApi } from "../context";
import {
  bindAgentVoiceSchema,
  createVoiceProfileSchema,
  generateMessageSpeechSchema,
  previewVoiceSchema,
  transcribeVoiceSchema,
} from "../schemas";

export function registerVoiceRoutes(app: RomeoApi): void {
  app.get("/api/v1/voices", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").voices.list(subject);
    return context.json({ data });
  });

  app.post("/api/v1/voices", async (context) => {
    const subject = context.get("subject");
    const body = createVoiceProfileSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .voices.create({ subject, ...body });
    return context.json({ data }, 201);
  });

  app.post("/api/v1/voices/sync", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").voices.syncCatalog(subject);
    return context.json({ data });
  });

  app.post("/api/v1/voices/:voiceProfileId/preview", async (context) => {
    const subject = context.get("subject");
    const body = previewVoiceSchema.parse(await context.req.json());
    const data = await context.get("services").voices.preview({
      subject,
      voiceProfileId: context.req.param("voiceProfileId"),
      text: body.text,
    });
    return context.json({ data });
  });

  app.post("/api/v1/agents/:agentId/voice", async (context) => {
    const subject = context.get("subject");
    const body = bindAgentVoiceSchema.parse(await context.req.json());
    const data = await context.get("services").voices.bindAgent({
      subject,
      agentId: context.req.param("agentId"),
      voiceProfileId: body.voiceProfileId,
    });
    return context.json({ data });
  });

  app.post("/api/v1/messages/:messageId/speech", async (context) => {
    const subject = context.get("subject");
    const body = generateMessageSpeechSchema.parse(await context.req.json());
    const data = await context.get("services").voices.generateMessageSpeech({
      subject,
      messageId: context.req.param("messageId"),
      voiceProfileId: body.voiceProfileId,
    });
    return context.json({ data });
  });

  app.post("/api/v1/voice/transcriptions", async (context) => {
    const subject = context.get("subject");
    const body = transcribeVoiceSchema.parse(await context.req.json());
    const data = await context.get("services").voices.transcribe({
      subject,
      audioBase64: body.audioBase64,
      contentType: body.contentType,
      ...(body.fileName === undefined ? {} : { fileName: body.fileName }),
      ...(body.language === undefined ? {} : { language: body.language }),
      ...(body.prompt === undefined ? {} : { prompt: body.prompt }),
    });
    return context.json({ data });
  });

  app.get("/api/v1/voice-artifacts/:artifactId", async (context) => {
    const subject = context.get("subject");
    const artifact = await context.get("services").voices.readArtifact({
      subject,
      artifactId: context.req.param("artifactId"),
    });
    return new Response(toArrayBuffer(artifact.bytes), {
      headers: {
        "cache-control": "private, max-age=60",
        "content-length": String(artifact.bytes.byteLength),
        "content-type": artifact.contentType,
        "x-content-type-options": "nosniff",
      },
    });
  });

  app.delete("/api/v1/voice-artifacts/:artifactId", async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").voices.deleteArtifact({
      subject,
      artifactId: context.req.param("artifactId"),
    });
    return context.json({ data });
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
