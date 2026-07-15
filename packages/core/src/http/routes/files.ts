import type { RomeoApi } from "../context";
import {
  createFileResumableUploadSessionSchema,
  createFileSchema,
  createFileUploadSessionSchema,
} from "../schemas";

export function registerFileRoutes(app: RomeoApi): void {
  app.get("/api/v1/files", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.list(subject, context.req.query("workspaceId"));
    return context.json({ data });
  });

  app.post("/api/v1/files", async (context) => {
    const subject = context.get("subject");
    const body = createFileSchema.parse(await context.req.json());
    const data = await context.get("services").files.create(subject, body);
    return context.json({ data }, 201);
  });

  app.post("/api/v1/files/uploads", async (context) => {
    const subject = context.get("subject");
    const body = createFileUploadSessionSchema.parse(await context.req.json());
    const data = await context
      .get("services")
      .files.createUploadSession(subject, body);
    return context.json({ data }, 201);
  });

  app.post("/api/v1/files/uploads/resumable", async (context) => {
    const subject = context.get("subject");
    const body = createFileResumableUploadSessionSchema.parse(
      await context.req.json(),
    );
    const data = await context
      .get("services")
      .files.createResumableUploadSession(subject, body);
    return context.json({ data }, 201);
  });

  app.get("/api/v1/files/uploads/resumable/:fileId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.getResumableUploadSession(subject, context.req.param("fileId"));
    return context.json({ data });
  });

  app.post(
    "/api/v1/files/uploads/resumable/:fileId/complete",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .files.completeResumableUploadSession(
          subject,
          context.req.param("fileId"),
        );
      return context.json({ data });
    },
  );

  app.delete("/api/v1/files/uploads/resumable/:fileId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.delete(subject, context.req.param("fileId"));
    return context.json({ data });
  });

  app.get("/api/v1/files/uploads/:fileId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.getUploadSession(subject, context.req.param("fileId"));
    return context.json({ data });
  });

  app.post("/api/v1/files/uploads/:fileId/complete", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.completeUploadSession(subject, context.req.param("fileId"));
    return context.json({ data });
  });

  app.delete("/api/v1/files/uploads/:fileId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.delete(subject, context.req.param("fileId"));
    return context.json({ data });
  });

  app.get("/api/v1/files/:fileId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.get(subject, context.req.param("fileId"));
    return context.json({ data });
  });

  app.get("/api/v1/files/:fileId/content", async (context) => {
    const subject = context.get("subject");
    const file = await context
      .get("services")
      .files.readContent(subject, context.req.param("fileId"));
    return new Response(toArrayBuffer(file.bytes), {
      headers: {
        "cache-control": "private, max-age=300",
        "content-disposition": `inline; filename="${file.fileName.replace(/"/gu, "")}"`,
        "content-length": String(file.sizeBytes),
        "content-type": file.mimeType,
        "x-content-type-options": "nosniff",
      },
    });
  });

  app.delete("/api/v1/files/:fileId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.delete(subject, context.req.param("fileId"));
    return context.json({ data });
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
