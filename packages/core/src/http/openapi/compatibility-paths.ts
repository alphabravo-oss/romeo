import { errorResponse, jsonContent } from "./helpers";

export const compatibilityPaths = {
  "/openai/models": {
    get: {
      summary: "List OpenAI-compatible models",
      description:
        "Compatibility endpoint for OpenAI-style model discovery. The response is a raw OpenAI-compatible model list, not a Romeo data envelope, and includes only enabled models on enabled providers the caller can use.",
      responses: {
        200: {
          description: "OpenAI-compatible model list",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/OpenAiModelListResponse",
              },
            },
          },
        },
        403: errorResponse,
      },
    },
  },
  "/openai/models/{model}": {
    get: {
      summary: "Retrieve an OpenAI-compatible model",
      description:
        "Compatibility endpoint for OpenAI-style model metadata lookup. The response is a raw OpenAI-compatible model object, not a Romeo data envelope, and succeeds only for enabled models on enabled providers the caller can use.",
      parameters: [{ $ref: "#/components/parameters/OpenAiModelId" }],
      responses: {
        200: {
          description: "OpenAI-compatible model object",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/OpenAiModel" },
            },
          },
        },
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
      },
    },
  },
  "/chat/completions": {
    post: {
      summary: "Create an OpenAI-compatible chat completion",
      description:
        "Compatibility endpoint for OpenAI-style clients. The response is a raw OpenAI-compatible chat completion or SSE stream, not a Romeo data envelope.",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenAiChatCompletionRequest",
        }),
      },
      responses: {
        200: {
          description: "OpenAI-compatible chat completion response",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/OpenAiChatCompletionResponse",
              },
            },
            "text/event-stream": {
              schema: { type: "string" },
            },
          },
        },
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        502: errorResponse,
        503: errorResponse,
      },
    },
  },
  "/embeddings": {
    post: {
      summary: "Create OpenAI-compatible embeddings",
      description:
        "Compatibility endpoint for OpenAI-style embedding clients. The response is a raw OpenAI-compatible embeddings response, not a Romeo data envelope.",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/OpenAiEmbeddingRequest",
        }),
      },
      responses: {
        200: {
          description: "OpenAI-compatible embeddings response",
          content: {
            "application/json": {
              schema: {
                $ref: "#/components/schemas/OpenAiEmbeddingResponse",
              },
            },
          },
        },
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
        409: errorResponse,
        502: errorResponse,
        503: errorResponse,
      },
    },
  },
};
