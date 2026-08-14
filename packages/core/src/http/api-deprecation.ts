import {
  apiDeprecationRegistry,
  contractRoutes,
  type ApiDeprecationDefinition,
} from "@romeo/contracts";
import type { MiddlewareHandler } from "hono";
import {
  ApiDeprecationUsageStore,
  apiDeprecationUsageStore,
} from "../services/api-deprecation-observability";

export { apiDeprecationUsageStore };

export function apiDeprecationMiddleware(
  input: {
    definitions?: readonly ApiDeprecationDefinition[];
    now?: () => number;
    operations?: readonly {
      method: string;
      operationId?: string;
      path: string;
    }[];
    store?: ApiDeprecationUsageStore;
  } = {},
): MiddlewareHandler {
  const definitions = input.definitions ?? apiDeprecationRegistry;
  const store =
    input.store ?? new ApiDeprecationUsageStore(definitions, input.now);
  const operations = input.operations ?? contractRoutes;
  const successors = new Map(
    operations.flatMap((operation) =>
      operation.operationId === undefined
        ? []
        : [[operation.operationId, operation.path] as const],
    ),
  );
  const matchers = definitions.map((definition) => ({
    definition,
    match: compilePath(definition.path),
    successorPath:
      definition.replacementOperationId === null
        ? undefined
        : successors.get(definition.replacementOperationId),
  }));
  for (const matcher of matchers) {
    if (
      matcher.definition.replacementOperationId !== null &&
      matcher.successorPath === undefined
    ) {
      throw new TypeError("API deprecation successor operation is missing.");
    }
  }

  return async (context, next) => {
    const matched = matchers.find(
      (candidate) =>
        candidate.definition.method.toUpperCase() === context.req.method &&
        candidate.match(context.req.path),
    );
    if (matched === undefined) return next();
    setDeprecationHeaders(context, matched.definition, matched.successorPath);
    try {
      await next();
      store.record(matched.definition.operationId, context.res.status);
    } catch (error) {
      store.record(matched.definition.operationId, 500);
      throw error;
    }
  };
}

function setDeprecationHeaders(
  context: Parameters<MiddlewareHandler>[0],
  definition: ApiDeprecationDefinition,
  successorPath: string | undefined,
): void {
  context.header(
    "Deprecation",
    `@${Math.floor(Date.parse(definition.deprecatedAt) / 1_000)}`,
  );
  context.header("Sunset", new Date(definition.sunsetAt).toUTCString());
  const links = [`<${definition.documentationUrl}>; rel="deprecation"`];
  if (successorPath !== undefined)
    links.push(`<${successorPath}>; rel="successor-version"`);
  context.header("Link", links.join(", "));
}

function compilePath(template: string): (path: string) => boolean {
  const expected = template.split("/");
  return (path) => {
    const actual = path.split("/");
    return (
      actual.length === expected.length &&
      expected.every((segment, index) =>
        /^\{[^{}]+\}$/u.test(segment)
          ? actual[index]?.length !== 0
          : segment === actual[index],
      )
    );
  };
}
