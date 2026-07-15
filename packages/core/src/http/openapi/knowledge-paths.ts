import {
  arrayEnvelope,
  created,
  errorResponse,
  jsonContent,
  success,
} from "./helpers";

export const knowledgePaths = {
  "/knowledge-bases": {
    get: {
      summary: "List knowledge bases in a workspace",
      parameters: [
        {
          name: "workspaceId",
          in: "query",
          required: false,
          schema: { type: "string" },
        },
      ],
      responses: {
        200: {
          description: "Knowledge bases",
          content: jsonContent({
            type: "object",
            required: ["data"],
            properties: {
              data: {
                type: "array",
                items: { $ref: "#/components/schemas/KnowledgeBase" },
              },
            },
            additionalProperties: false,
          }),
        },
        403: errorResponse,
      },
    },
    post: {
      summary: "Create a knowledge base",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateKnowledgeBaseRequest",
        }),
      },
      responses: {
        201: success("Knowledge base", {
          $ref: "#/components/schemas/KnowledgeBase",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/knowledge-bases/{knowledgeBaseId}": {
    get: {
      summary: "Get a knowledge base",
      parameters: [{ $ref: "#/components/parameters/KnowledgeBaseId" }],
      responses: {
        200: success("Knowledge base", {
          $ref: "#/components/schemas/KnowledgeBase",
        }),
        403: errorResponse,
        404: errorResponse,
      },
    },
    patch: {
      summary: "Update a knowledge base",
      parameters: [{ $ref: "#/components/parameters/KnowledgeBaseId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateKnowledgeBaseRequest",
        }),
      },
      responses: {
        200: success("Knowledge base", {
          $ref: "#/components/schemas/KnowledgeBase",
        }),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/knowledge-bases/{knowledgeBaseId}/sources": {
    get: {
      summary: "List knowledge sources",
      parameters: [{ $ref: "#/components/parameters/KnowledgeBaseId" }],
      responses: {
        200: arrayEnvelope("Knowledge source"),
        403: errorResponse,
        404: errorResponse,
      },
    },
    post: {
      summary: "Register a knowledge source upload",
      parameters: [{ $ref: "#/components/parameters/KnowledgeBaseId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateKnowledgeSourceRequest",
        }),
      },
      responses: {
        202: created("Knowledge source"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        415: errorResponse,
      },
    },
  },
  "/knowledge-bases/{knowledgeBaseId}/uploads": {
    post: {
      summary: "Create a presigned knowledge source upload",
      parameters: [{ $ref: "#/components/parameters/KnowledgeBaseId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateKnowledgeUploadRequest",
        }),
      },
      responses: {
        202: created("Knowledge upload registration"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        415: errorResponse,
      },
    },
  },
  "/knowledge-bases/{knowledgeBaseId}/sources/{sourceId}": {
    delete: {
      summary: "Delete a knowledge source",
      responses: {
        200: created("Knowledge source"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/knowledge-bases/{knowledgeBaseId}/sources/{sourceId}/complete": {
    post: {
      summary: "Complete a direct knowledge upload and index text content",
      responses: {
        200: created("Knowledge source"),
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        415: errorResponse,
      },
    },
  },
  "/knowledge-bases/{knowledgeBaseId}/sources/{sourceId}/extract": {
    post: {
      summary: "Run a deferred knowledge extraction job",
      responses: {
        200: created("Knowledge extraction job result"),
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        415: errorResponse,
        503: errorResponse,
      },
    },
  },
  "/knowledge-bases/{knowledgeBaseId}/embeddings": {
    post: {
      summary: "Index provider embeddings for knowledge chunks",
      parameters: [{ $ref: "#/components/parameters/KnowledgeBaseId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/IndexKnowledgeEmbeddingsRequest",
        }),
      },
      responses: {
        200: created("Knowledge embedding index job result"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        422: errorResponse,
      },
    },
  },
  "/knowledge-bases/{knowledgeBaseId}/sources/{sourceId}/reindex": {
    post: {
      summary: "Reindex a knowledge source",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/ReindexKnowledgeSourceRequest",
        }),
      },
      responses: {
        200: created("Knowledge source"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        415: errorResponse,
      },
    },
  },
  "/knowledge-bases/{knowledgeBaseId}/query": {
    post: {
      summary: "Query a knowledge base",
      parameters: [{ $ref: "#/components/parameters/KnowledgeBaseId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/QueryKnowledgeBaseRequest",
        }),
      },
      responses: {
        200: arrayEnvelope("Retrieval hit"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/knowledge-bases/query": {
    post: {
      summary: "Query authorized knowledge bases with a tiered retrieval plan",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/TieredKnowledgeQueryRequest",
        }),
      },
      responses: {
        200: success("Tiered knowledge query result", {
          $ref: "#/components/schemas/TieredKnowledgeQueryResult",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/admin/rag/replay": {
    post: {
      summary: "Replay tiered retrieval cases with metadata-only metrics",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/KnowledgeRetrievalReplayRequest",
        }),
      },
      responses: {
        200: success("Knowledge retrieval replay report", {
          $ref: "#/components/schemas/KnowledgeRetrievalReplayReport",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/admin/rag/replay/compare": {
    post: {
      summary:
        "Compare baseline and candidate tiered retrieval replay metrics without raw corpus echo",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/KnowledgeRetrievalReplayComparisonRequest",
        }),
      },
      responses: {
        200: success("Knowledge retrieval replay comparison report", {
          $ref: "#/components/schemas/KnowledgeRetrievalReplayComparisonReport",
        }),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
};
