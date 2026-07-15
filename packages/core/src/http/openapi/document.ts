import { openApiComponents } from "./components";
import { openApiPaths } from "./paths";

export interface OpenApiDocumentOptions {
  openWebUiCompatibilityEnabled?: boolean;
}

export function openApiDocument(options: OpenApiDocumentOptions = {}) {
  const openWebUiCompatibilityEnabled =
    options.openWebUiCompatibilityEnabled ?? false;

  return {
    openapi: "3.1.0",
    info: {
      title: "Romeo API",
      version: "0.1.0",
      description: "Romeo API contract.",
    },
    servers: [{ url: "/api/v1" }],
    paths: openApiPaths({
      openWebUiCompatibilityEnabled,
    }),
    components: openApiComponents({ openWebUiCompatibilityEnabled }),
  };
}

export const defaultOpenApiDocument = openApiDocument();
