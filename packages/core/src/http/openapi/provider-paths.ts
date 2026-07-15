import {
  arrayEnvelope,
  created,
  errorResponse,
  jsonContent,
  success,
} from "./helpers";

export const providerPaths = {
  "/providers": {
    get: {
      summary: "List configured model providers",
      responses: {
        200: arrayEnvelope("Provider instance"),
        500: errorResponse,
      },
    },
    post: {
      summary: "Create a provider instance",
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/CreateProviderRequest",
        }),
      },
      responses: {
        201: created("Provider instance"),
        400: errorResponse,
        403: errorResponse,
      },
    },
  },
  "/providers/operational-summary": {
    get: {
      summary: "Summarize model-provider health and resilience state",
      responses: {
        200: success("Provider operational summary"),
        403: errorResponse,
      },
    },
  },
  "/providers/{providerId}/sync": {
    post: {
      summary: "Sync provider models",
      parameters: [{ $ref: "#/components/parameters/ProviderId" }],
      responses: {
        200: arrayEnvelope("Base model"),
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
  "/models": {
    get: {
      summary: "List base models visible to the caller",
      responses: { 200: arrayEnvelope("Base model"), 500: errorResponse },
    },
  },
  "/models/{modelId}/pricing": {
    patch: {
      summary: "Update base model token pricing",
      parameters: [{ $ref: "#/components/parameters/ModelId" }],
      requestBody: {
        required: true,
        content: jsonContent({
          $ref: "#/components/schemas/UpdateModelPricingRequest",
        }),
      },
      responses: {
        200: success("Base model"),
        400: errorResponse,
        403: errorResponse,
        404: errorResponse,
      },
    },
  },
};
