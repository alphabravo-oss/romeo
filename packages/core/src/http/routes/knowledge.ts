import type { RomeoApi } from "../context";
import {
  compareTieredKnowledgeReplaySchema,
  createKnowledgeBaseSchema,
  createKnowledgeSourceSchema,
  createKnowledgeUploadSchema,
  indexKnowledgeEmbeddingsSchema,
  queryKnowledgeBaseSchema,
  queryTieredKnowledgeSchema,
  replayTieredKnowledgeSchema,
  reindexKnowledgeSourceSchema,
  updateKnowledgeBaseSchema,
} from "../schemas";
import type { KnowledgeRetrievalReplayCaseInput } from "../../services/knowledge-service";

export function registerKnowledgeRoutes(app: RomeoApi): void {
  app.get("/api/v1/knowledge-bases", async (context) => {
    const subject = context.get("subject");
    const workspaceId =
      context.req.query("workspaceId") ?? subject.workspaceIds[0];
    const data = workspaceId
      ? await context.get("services").knowledge.list(workspaceId, subject)
      : [];
    return context.json({ data });
  });

  app.post("/api/v1/knowledge-bases", async (context) => {
    const subject = context.get("subject");
    const body = createKnowledgeBaseSchema.parse(await context.req.json());
    const input: {
      subject: typeof subject;
      workspaceId: string;
      name: string;
      description?: string;
    } = {
      subject,
      workspaceId: body.workspaceId,
      name: body.name,
    };
    if (body.description !== undefined) input.description = body.description;

    const data = await context.get("services").knowledge.create(input);
    return context.json({ data }, 201);
  });

  app.get("/api/v1/knowledge-bases/:knowledgeBaseId", async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .knowledge.get(context.req.param("knowledgeBaseId"), subject);
    return context.json({ data });
  });

  app.patch("/api/v1/knowledge-bases/:knowledgeBaseId", async (context) => {
    const subject = context.get("subject");
    const body = updateKnowledgeBaseSchema.parse(await context.req.json());
    const data = await context.get("services").knowledge.update({
      subject,
      knowledgeBaseId: context.req.param("knowledgeBaseId"),
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
    });
    return context.json({ data });
  });

  app.get(
    "/api/v1/knowledge-bases/:knowledgeBaseId/sources",
    async (context) => {
      const subject = context.get("subject");
      const data = await context
        .get("services")
        .knowledge.listSources(context.req.param("knowledgeBaseId"), subject);
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/knowledge-bases/:knowledgeBaseId/sources",
    async (context) => {
      const subject = context.get("subject");
      const body = createKnowledgeSourceSchema.parse(await context.req.json());
      const data = await context.get("services").knowledge.createSource({
        subject,
        knowledgeBaseId: context.req.param("knowledgeBaseId"),
        fileName: body.fileName,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
        ...(body.content !== undefined ? { content: body.content } : {}),
      });
      return context.json({ data }, 202);
    },
  );

  app.post(
    "/api/v1/knowledge-bases/:knowledgeBaseId/uploads",
    async (context) => {
      const subject = context.get("subject");
      const body = createKnowledgeUploadSchema.parse(await context.req.json());
      const data = await context.get("services").knowledge.createUpload({
        subject,
        knowledgeBaseId: context.req.param("knowledgeBaseId"),
        fileName: body.fileName,
        mimeType: body.mimeType,
        sizeBytes: body.sizeBytes,
      });
      return context.json({ data }, 202);
    },
  );

  app.post(
    "/api/v1/knowledge-bases/:knowledgeBaseId/sources/:sourceId/complete",
    async (context) => {
      const subject = context.get("subject");
      const data = await context.get("services").knowledge.completeUpload({
        subject,
        knowledgeBaseId: context.req.param("knowledgeBaseId"),
        sourceId: context.req.param("sourceId"),
      });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/knowledge-bases/:knowledgeBaseId/sources/:sourceId/extract",
    async (context) => {
      const subject = context.get("subject");
      const data = await context.get("services").knowledge.extractUpload({
        subject,
        knowledgeBaseId: context.req.param("knowledgeBaseId"),
        sourceId: context.req.param("sourceId"),
      });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/knowledge-bases/:knowledgeBaseId/embeddings",
    async (context) => {
      const subject = context.get("subject");
      const body = indexKnowledgeEmbeddingsSchema.parse(
        await context.req.json(),
      );
      const data = await context.get("services").knowledge.indexEmbeddings({
        subject,
        knowledgeBaseId: context.req.param("knowledgeBaseId"),
        providerId: body.providerId,
        model: body.model,
        ...(body.batchSize !== undefined ? { batchSize: body.batchSize } : {}),
      });
      return context.json({ data });
    },
  );

  app.delete(
    "/api/v1/knowledge-bases/:knowledgeBaseId/sources/:sourceId",
    async (context) => {
      const subject = context.get("subject");
      const data = await context.get("services").knowledge.deleteSource({
        subject,
        knowledgeBaseId: context.req.param("knowledgeBaseId"),
        sourceId: context.req.param("sourceId"),
      });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/knowledge-bases/:knowledgeBaseId/sources/:sourceId/reindex",
    async (context) => {
      const subject = context.get("subject");
      const body = reindexKnowledgeSourceSchema.parse(await context.req.json());
      const data = await context.get("services").knowledge.reindexSource({
        subject,
        knowledgeBaseId: context.req.param("knowledgeBaseId"),
        sourceId: context.req.param("sourceId"),
        content: body.content,
        ...(body.sizeBytes !== undefined ? { sizeBytes: body.sizeBytes } : {}),
      });
      return context.json({ data });
    },
  );

  app.post(
    "/api/v1/knowledge-bases/:knowledgeBaseId/query",
    async (context) => {
      const subject = context.get("subject");
      const body = queryKnowledgeBaseSchema.parse(await context.req.json());
      const input: {
        subject: typeof subject;
        knowledgeBaseId: string;
        query: string;
        maxResults?: number;
      } = {
        subject,
        knowledgeBaseId: context.req.param("knowledgeBaseId"),
        query: body.query,
      };
      if (body.maxResults !== undefined) input.maxResults = body.maxResults;

      const data = await context.get("services").knowledge.query(input);
      return context.json({ data });
    },
  );

  app.post("/api/v1/knowledge-bases/query", async (context) => {
    const subject = context.get("subject");
    const body = queryTieredKnowledgeSchema.parse(await context.req.json());
    const data = await context.get("services").knowledge.queryTiered({
      subject,
      knowledgeBaseIds: body.knowledgeBaseIds,
      query: body.query,
      ...(body.maxResultsPerTier === undefined
        ? {}
        : { maxResultsPerTier: body.maxResultsPerTier }),
    });
    return context.json({ data });
  });

  app.post("/api/v1/admin/rag/replay", async (context) => {
    const subject = context.get("subject");
    const body = replayTieredKnowledgeSchema.parse(await context.req.json());
    const data = await context.get("services").knowledge.replayTiered({
      subject,
      cases: cleanReplayCases(body.cases),
    });
    return context.json({ data });
  });

  app.post("/api/v1/admin/rag/replay/compare", async (context) => {
    const subject = context.get("subject");
    const body = compareTieredKnowledgeReplaySchema.parse(
      await context.req.json(),
    );
    const data = await context.get("services").knowledge.compareTieredReplay({
      subject,
      baselineCases: cleanReplayCases(body.baseline),
      candidateCases: cleanReplayCases(body.candidate),
    });
    return context.json({ data });
  });
}

function cleanReplayCases(
  cases: Array<{
    id?: string | undefined;
    knowledgeBaseIds: string[];
    query: string;
    expectedChunkIds?: string[] | undefined;
    maxResultsPerTier?:
      | {
          user_private?: number | undefined;
          workspace?: number | undefined;
          org?: number | undefined;
          shared?: number | undefined;
        }
      | undefined;
  }>,
): KnowledgeRetrievalReplayCaseInput[] {
  return cases.map((replayCase) => ({
    knowledgeBaseIds: replayCase.knowledgeBaseIds,
    query: replayCase.query,
    ...(replayCase.id === undefined ? {} : { id: replayCase.id }),
    ...(replayCase.expectedChunkIds === undefined
      ? {}
      : { expectedChunkIds: replayCase.expectedChunkIds }),
    ...(replayCase.maxResultsPerTier === undefined
      ? {}
      : { maxResultsPerTier: replayCase.maxResultsPerTier }),
  }));
}
