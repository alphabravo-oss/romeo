import {
  contractOpenApiDocument,
  ROMEO_PRODUCT_VERSION,
  type OpenApiDocumentResponse,
} from "@romeo/contracts";

export interface OpenApiDocumentOptions {
  openWebUiCompatibilityEnabled?: boolean;
}

export function openApiDocument(options: OpenApiDocumentOptions = {}) {
  const document = contractOpenApiDocument({
    openWebUiCompatibilityEnabled:
      options.openWebUiCompatibilityEnabled ?? false,
  });
  return {
    ...document,
    info: {
      title: "Romeo API",
      version: ROMEO_PRODUCT_VERSION,
      description: "Romeo API contract.",
    },
    servers: [{ url: "/api/v1" }],
    paths: Object.fromEntries(
      Object.entries(document.paths ?? {}).map(([path, item]) => [
        path.replace(/^\/api\/v1(?=\/|$)/u, "") || "/",
        item,
      ]),
    ),
  };
}

export function openApiJsonDocument(
  options: OpenApiDocumentOptions = {},
): OpenApiDocumentResponse {
  return openApiDocument(options) as unknown as OpenApiDocumentResponse;
}

export const defaultOpenApiDocument = openApiDocument();
