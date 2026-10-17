import {
  contractOpenApiDocument,
  ROMEO_PRODUCT_VERSION,
  type OpenApiDocumentResponse,
} from "@romeo/contracts";

export function openApiDocument() {
  const document = contractOpenApiDocument();
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

export function openApiJsonDocument(): OpenApiDocumentResponse {
  return openApiDocument() as unknown as OpenApiDocumentResponse;
}

export const defaultOpenApiDocument = openApiDocument();
