import { describe, expect, it } from "vitest";
import { readEnv } from "@romeo/config";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { EnvironmentSecretResolver } from "./services/secret-resolver";

describe("external vector isolation", () => {
  it("post-filters Qdrant hits against authorized Postgres chunks", async () => {
    const repository = new InMemoryRomeoRepository();
    const qdrantApiKey = "qdrant-vector-isolation-key";
    const authorizedContent =
      "Romeo authorized vector evidence must come from visible Postgres chunks.";
    let authorizedPayload: Record<string, unknown> | undefined;
    const qdrantQueryBodies: unknown[] = [];
    const api = createRomeoApi(repository, {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: "https://qdrant.isolation.example",
        QDRANT_COLLECTION: "romeo-isolation",
        QDRANT_API_KEY_REF: "env://QDRANT_API_KEY",
        VECTOR_NAMESPACE_POLICY: "knowledge_base",
        VECTOR_PARTITIONING_POLICY: "org",
      }),
      secretResolver: new EnvironmentSecretResolver({
        QDRANT_API_KEY: qdrantApiKey,
      }),
      embeddingFetch: async (_input, init) => {
        const body = JSON.parse(String(init?.body)) as {
          input: string[];
          model: string;
        };
        return new Response(
          JSON.stringify({
            model: body.model,
            embeddings: body.input.map(vectorForText),
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
      qdrantFetch: async (input, init) => {
        const url = String(input);
        const body =
          init?.body === undefined ? undefined : JSON.parse(String(init.body));
        if (url.endsWith("/points?wait=true")) {
          const request = body as {
            points?: Array<{ payload: Record<string, unknown> }>;
          };
          authorizedPayload = request.points?.[0]?.payload;
          return jsonResponse({ status: "ok" });
        }
        if (url.endsWith("/points/query")) {
          qdrantQueryBodies.push(body);
          return jsonResponse({
            result: {
              points: [
                {
                  id: "stale-cross-tenant-point",
                  score: 0.999,
                  payload: {
                    chunkId: "kb_chunk_cross_org_guess",
                    dimensions: 1536,
                    embeddingModel: "nomic-embed-text",
                    embeddingProvider: "provider_ollama",
                    knowledgeBaseId: "kb_other_tenant",
                    orgId: "org_other_tenant",
                    romeoNamespace:
                      "knowledge_base:org_other_tenant:workspace_other:kb_other_tenant",
                    romeoPartition: "org:org_other_tenant",
                    sourceId: "source_other_tenant",
                    workspaceId: "workspace_other",
                  },
                },
                {
                  id: "authorized-point",
                  score: 0.7,
                  payload: authorizedPayload,
                },
              ],
            },
            status: "ok",
          });
        }
        return jsonResponse({ status: "unexpected" }, 404);
      },
    });

    const sourceResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/sources",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          fileName: "authorized-vector.md",
          mimeType: "text/markdown",
          sizeBytes: authorizedContent.length,
          content: authorizedContent,
        }),
      },
    );
    const source = await sourceResponse.json();
    const indexResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/embeddings",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "provider_ollama",
          model: "nomic-embed-text",
        }),
      },
    );
    const queryResponse = await api.request(
      "/api/v1/knowledge-bases/kb_default/query",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          query: "authorized vector evidence",
          maxResults: 2,
        }),
      },
    );
    const query = await queryResponse.json();
    const serializedQuery = JSON.stringify(query);

    expect(sourceResponse.status).toBe(202);
    expect(indexResponse.status).toBe(200);
    expect(queryResponse.status).toBe(200);
    expect(query.data).toHaveLength(1);
    expect(query.data[0].content).toBe(authorizedContent);
    expect(query.data[0].citation.documentId).toBe(source.data.id);
    expect(serializedQuery).not.toContain("org_other_tenant");
    expect(serializedQuery).not.toContain("kb_chunk_cross_org_guess");
    expect(serializedQuery).not.toContain("source_other_tenant");
    expect(qdrantQueryBodies[0]).toMatchObject({
      filter: {
        must: expect.arrayContaining([
          {
            key: "romeoNamespace",
            match: {
              value: "knowledge_base:org_default:workspace_default:kb_default",
            },
          },
          { key: "romeoPartition", match: { value: "org:org_default" } },
          { key: "orgId", match: { value: "org_default" } },
          { key: "workspaceId", match: { value: "workspace_default" } },
          { key: "knowledgeBaseId", match: { value: "kb_default" } },
          { key: "sourceId", match: { any: [source.data.id] } },
        ]),
      },
    });
  });
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function vectorForText(text: string): number[] {
  const vector = Array.from({ length: 1536 }, () => 0);
  if (text.includes("authorized")) vector[0] = 1;
  else vector[1] = 1;
  return vector;
}
