import {
  bindManagedModelVoiceRoute,
  createVoiceProfileRoute,
  deleteVoiceArtifactRoute,
  generateMessageSpeechRoute,
  listVoicesRoute,
  previewVoiceRoute,
  syncVoiceCatalogRoute,
  transcribeVoiceRoute,
} from "@romeo/contracts";

import type { RomeoApi } from "../context";

export function registerVoiceRoutes(app: RomeoApi): void {
  app.openapi(listVoicesRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").voices.list(subject);
    return context.json({ data });
  });

  app.openapi(createVoiceProfileRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .voices.create({ subject, ...body });
    return context.json({ data }, 201);
  });

  app.openapi(syncVoiceCatalogRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").voices.syncCatalog(subject);
    return context.json({ data });
  });

  app.openapi(previewVoiceRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").voices.preview({
      subject,
      voiceProfileId: context.req.valid("param").voiceProfileId,
      text: body.text,
    });
    return context.json({ data });
  });

  app.openapi(bindManagedModelVoiceRoute, async (context) => {
    const subject = context.get("subject");
    const { agentId } = context.req.valid("param");
    const body = context.req.valid("json");
    const data = await context.get("services").voices.bindAgent({
      subject,
      agentId,
      voiceProfileId: body.voiceProfileId,
    });
    return context.json({ data }, 200);
  });

  app.openapi(generateMessageSpeechRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").voices.generateMessageSpeech({
      subject,
      messageId: context.req.valid("param").messageId,
      voiceProfileId: body.voiceProfileId,
    });
    return context.json({ data });
  });

  app.openapi(transcribeVoiceRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
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

  app.openapi(deleteVoiceArtifactRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context.get("services").voices.deleteArtifact({
      subject,
      artifactId: context.req.valid("param").artifactId,
    });
    return context.json({ data });
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
