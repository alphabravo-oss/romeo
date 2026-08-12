import type { RomeoApi } from "../context";
import {
  compareTieredKnowledgeReplayRoute,
  completeKnowledgeUploadRoute,
  createKnowledgeBaseRoute,
  createKnowledgeSourceRoute,
  createKnowledgeUploadRoute,
  getAgenticRagSettingsRoute,
  getKnowledgeIngestReadinessRoute,
  deleteKnowledgeSourceRoute,
  extractKnowledgeSourceRoute,
  getKnowledgeBaseRoute,
  indexKnowledgeEmbeddingsRoute,
  listKnowledgeBasesRoute,
  listKnowledgeSourcesRoute,
  queryKnowledgeBaseRoute,
  queryTieredKnowledgeRoute,
  reindexKnowledgeSourceRoute,
  replayTieredKnowledgeRoute,
  updateKnowledgeBaseRoute,
} from "@romeo/contracts";
import type { KnowledgeRetrievalReplayCaseInput } from "../../services/knowledge-service";

export function registerKnowledgeRoutes(app: RomeoApi): void {
  app.openapi(getAgenticRagSettingsRoute, async (context) => {
    const data = await context
      .get("services")
      .ragPolicy.agenticSettings(context.get("subject"));
    return context.json({ data }, 200);
  });

  app.openapi(getKnowledgeIngestReadinessRoute, async (context) => {
    const data = await context
      .get("services")
      .ragPolicy.ingestReadiness(context.get("subject"));
    return context.json({ data }, 200);
  });

  app.openapi(listKnowledgeBasesRoute, async (context) => {
    const subject = context.get("subject");
    const workspaceId =
      context.req.valid("query").workspaceId ?? subject.workspaceIds[0];
    const data = workspaceId
      ? await context.get("services").knowledge.list(workspaceId, subject)
      : [];
    return context.json({ data });
  });

  app.openapi(createKnowledgeBaseRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const input: {
      subject: typeof subject;
      workspaceId: string;
      name: string;
      description?: string;
      scope?: "user_private" | "workspace" | "org" | "shared";
    } = {
      subject,
      workspaceId: body.workspaceId,
      name: body.name,
    };
    if (body.description !== undefined) input.description = body.description;
    if (body.scope !== undefined) input.scope = body.scope;

    const data = await context.get("services").knowledge.create(input);
    return context.json({ data }, 201);
  });

  app.openapi(getKnowledgeBaseRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .knowledge.get(context.req.valid("param").knowledgeBaseId, subject);
    return context.json({ data });
  });

  app.openapi(updateKnowledgeBaseRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").knowledge.update({
      subject,
      knowledgeBaseId: context.req.valid("param").knowledgeBaseId,
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined
        ? { description: body.description }
        : {}),
    });
    return context.json({ data });
  });

  app.openapi(listKnowledgeSourcesRoute, async (context) => {
    const subject = context.get("subject");
    const data = await context
      .get("services")
      .knowledge.listSources(
        context.req.valid("param").knowledgeBaseId,
        subject,
      );
    return context.json({ data });
  });

  app.openapi(createKnowledgeSourceRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").knowledge.createSource({
      subject,
      knowledgeBaseId: context.req.valid("param").knowledgeBaseId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
      ...(body.content !== undefined ? { content: body.content } : {}),
    });
    return context.json({ data }, 202);
  });

  app.openapi(createKnowledgeUploadRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").knowledge.createUpload({
      subject,
      knowledgeBaseId: context.req.valid("param").knowledgeBaseId,
      fileName: body.fileName,
      mimeType: body.mimeType,
      sizeBytes: body.sizeBytes,
    });
    return context.json({ data }, 202);
  });

  app.openapi(completeKnowledgeUploadRoute, async (context) => {
    const params = context.req.valid("param");
    const subject = context.get("subject");
    const data = await context.get("services").knowledge.completeUpload({
      subject,
      knowledgeBaseId: params.knowledgeBaseId,
      sourceId: params.sourceId,
    });
    return context.json({ data });
  });

  app.openapi(extractKnowledgeSourceRoute, async (context) => {
    const params = context.req.valid("param");
    const subject = context.get("subject");
    const data = await context.get("services").knowledge.extractUpload({
      subject,
      knowledgeBaseId: params.knowledgeBaseId,
      sourceId: params.sourceId,
    });
    return context.json({ data });
  });

  app.openapi(indexKnowledgeEmbeddingsRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").knowledge.indexEmbeddings({
      subject,
      knowledgeBaseId: context.req.valid("param").knowledgeBaseId,
      providerId: body.providerId,
      model: body.model,
      ...(body.batchSize !== undefined ? { batchSize: body.batchSize } : {}),
    });
    return context.json({ data });
  });

  app.openapi(deleteKnowledgeSourceRoute, async (context) => {
    const params = context.req.valid("param");
    const subject = context.get("subject");
    const data = await context.get("services").knowledge.deleteSource({
      subject,
      knowledgeBaseId: params.knowledgeBaseId,
      sourceId: params.sourceId,
    });
    return context.json({ data });
  });

  app.openapi(reindexKnowledgeSourceRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const params = context.req.valid("param");
    const data = await context.get("services").knowledge.reindexSource({
      subject,
      knowledgeBaseId: params.knowledgeBaseId,
      sourceId: params.sourceId,
      content: body.content,
      ...(body.sizeBytes !== undefined ? { sizeBytes: body.sizeBytes } : {}),
    });
    return context.json({ data });
  });

  app.openapi(queryKnowledgeBaseRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const input: {
      subject: typeof subject;
      knowledgeBaseId: string;
      query: string;
      maxResults?: number;
    } = {
      subject,
      knowledgeBaseId: context.req.valid("param").knowledgeBaseId,
      query: body.query,
    };
    if (body.maxResults !== undefined) input.maxResults = body.maxResults;

    const data = await context.get("services").knowledge.query(input);
    return context.json({ data });
  });

  app.openapi(queryTieredKnowledgeRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
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

  app.openapi(replayTieredKnowledgeRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
    const data = await context.get("services").knowledge.replayTiered({
      subject,
      cases: cleanReplayCases(body.cases),
    });
    return context.json({ data });
  });

  app.openapi(compareTieredKnowledgeReplayRoute, async (context) => {
    const subject = context.get("subject");
    const body = context.req.valid("json");
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
