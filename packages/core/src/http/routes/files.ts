import type { RomeoApi } from "../context";
import {
  cancelFileUploadSessionRoute,
  cancelResumableUploadSessionRoute,
  completeFileUploadSessionRoute,
  completeResumableUploadSessionRoute,
  createFileRoute,
  createFileUploadSessionRoute,
  createResumableUploadSessionRoute,
  deleteFileRoute,
  getFileRoute,
  getFileUploadSessionRoute,
  getResumableUploadSessionRoute,
  listFilesRoute,
  readFileContentRoute,
  retryFileExtractionRoute,
  retryFileLifecycleRoute,
} from "@romeo/contracts";

export function registerFileRoutes(app: RomeoApi): void {
  app.openapi(listFilesRoute, async (context) => {
    const subject = context.get("subject");
    const { workspaceId, limit, offset, q } = context.req.valid("query");
    if (limit !== undefined && workspaceId !== undefined) {
      const page = await context.get("services").files.listPage(subject, {
        excludePurposes: ["memory", "note"],
        limit,
        offset: offset ?? 0,
        ...(q === undefined ? {} : { query: q }),
        workspaceId,
      });
      return context.json({
        data: page.items,
        meta: {
          limit: page.limit,
          offset: page.offset,
          total: page.total,
          hasMore: page.offset + page.items.length < page.total,
        },
      });
    }
    const data = await context.get("services").files.list(subject, workspaceId);
    return context.json({ data });
  });

  app.openapi(createFileRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").files.create(subject, body);
    return context.json({ data }, 201);
  });

  app.openapi(createFileUploadSessionRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .files.createUploadSession(subject, body);
    return context.json({ data }, 201);
  });

  app.openapi(createResumableUploadSessionRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context
      .get("services")
      .files.createResumableUploadSession(subject, body);
    return context.json({ data }, 201);
  });

  app.openapi(getResumableUploadSessionRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.getResumableUploadSession(
        subject,
        context.req.valid("param").fileId,
      );
    return context.json({ data });
  });

  app.openapi(completeResumableUploadSessionRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.completeResumableUploadSession(
        subject,
        context.req.valid("param").fileId,
      );
    return context.json({ data });
  });

  app.openapi(cancelResumableUploadSessionRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.delete(subject, context.req.valid("param").fileId);
    return context.json({ data });
  });

  app.openapi(getFileUploadSessionRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.getUploadSession(subject, context.req.valid("param").fileId);
    return context.json({ data });
  });

  app.openapi(completeFileUploadSessionRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.completeUploadSession(subject, context.req.valid("param").fileId);
    return context.json({ data });
  });

  app.openapi(cancelFileUploadSessionRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.delete(subject, context.req.valid("param").fileId);
    return context.json({ data });
  });

  app.openapi(getFileRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.get(subject, context.req.valid("param").fileId);
    return context.json({ data });
  });

  app.openapi(retryFileExtractionRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.retryExtraction(subject, context.req.valid("param").fileId);
    return context.json({ data });
  });

  app.openapi(retryFileLifecycleRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.retryLifecycle(subject, context.req.valid("param").fileId);
    return context.json({ data });
  });

  app.openapi(readFileContentRoute, async (context) => {
    const subject = context.get("subject");
    const file = await context
      .get("services")
      .files.readContent(subject, context.req.valid("param").fileId);
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

  app.openapi(deleteFileRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .files.delete(subject, context.req.valid("param").fileId);
    return context.json({ data });
  });
}

function toArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buffer).set(bytes);
  return buffer;
}
