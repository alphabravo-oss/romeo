import { createHash, randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage } from "node:http";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scopeValues, type AuthSubject } from "../packages/auth/src/index.ts";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory.ts";
import { EnvironmentSecretResolver } from "../packages/core/src/services/secret-resolver.ts";
import {
  WebSearchService,
  type WebSearchProvider,
} from "../packages/core/src/services/web-search-service.ts";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputPath = resolve(
  repoRoot,
  process.env.ROMEO_WEB_SEARCH_PROTOCOL_EVIDENCE_PATH ??
    "dist/evidence/live-web-search-protocol-acceptance.json",
);
const querySentinel = `WEB_SEARCH_QUERY_${randomUUID()}`;
const credential = `web_search_credential_${randomUUID()}`;
const observations: Record<
  WebSearchProvider,
  {
    requests: number;
    methodAccepted: boolean;
    queryAccepted: boolean;
    credentialAccepted: boolean;
    limitAccepted: boolean;
    resultParsed: boolean;
    healthPersisted: boolean;
  }
> = {
  brave: emptyObservation(),
  searxng: emptyObservation(),
  tavily: emptyObservation(),
};
const subject: AuthSubject = {
  id: "user_dev_admin",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: [],
  scopes: [...scopeValues],
  isAdmin: true,
};
const startedAt = performance.now();
const server = await startServer();

try {
  const address = server.address();
  if (address === null || typeof address === "string") {
    throw new Error("Controlled web-search server did not expose a TCP port.");
  }
  for (const provider of ["searxng", "brave", "tavily"] as const) {
    const repository = new InMemoryRomeoRepository();
    const service = new WebSearchService(repository, {
      fetchImpl: async (input, init) => {
        const target = new URL(
          input instanceof Request ? input.url : String(input),
        );
        target.hostname = "127.0.0.1";
        return await fetch(target, init);
      },
      hostLookup: async () => [{ address: "93.184.216.34", family: 4 }],
      secretResolver: new EnvironmentSecretResolver({
        WEB_SEARCH_PROTOCOL_KEY: credential,
      }),
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      provider,
      endpointUrl: `http://search.example.test:${address.port}/${provider}`,
      maxResults: 3,
      ...(provider === "searxng"
        ? {}
        : { credentialRef: "env://WEB_SEARCH_PROTOCOL_KEY" }),
    });
    const results = await service.search(subject, querySentinel);
    observations[provider].resultParsed =
      results.length === 1 &&
      results[0]?.provider === provider &&
      results[0]?.title === `${provider} result` &&
      results[0]?.url === `https://docs.example.test/${provider}`;
    observations[provider].healthPersisted =
      (await service.configuration(subject)).health.status === "healthy";
  }

  if (
    Object.values(observations).some(
      (result) =>
        result.requests !== 1 ||
        !result.methodAccepted ||
        !result.queryAccepted ||
        !result.credentialAccepted ||
        !result.limitAccepted ||
        !result.resultParsed ||
        !result.healthPersisted,
    )
  ) {
    throw new Error(
      "A controlled web-search provider contract was incomplete.",
    );
  }

  await writeEvidence("passed");
  console.log("Live controlled web-search protocol acceptance passed.");
  console.log(`Wrote web-search protocol evidence to ${outputPath}`);
} catch (error) {
  await writeEvidence("failed", error);
  throw error;
} finally {
  await new Promise<void>((resolveClose) => server.close(() => resolveClose()));
}

async function startServer(): Promise<ReturnType<typeof createServer>> {
  const server = createServer(async (request, response) => {
    try {
      const provider = providerFromRequest(request);
      if (provider === undefined) {
        response.statusCode = 404;
        response.end();
        return;
      }
      const observation = observations[provider];
      observation.requests += 1;
      if (provider === "tavily") {
        const body = JSON.parse(await readBody(request)) as Record<
          string,
          unknown
        >;
        observation.methodAccepted = request.method === "POST";
        observation.queryAccepted = body.query === querySentinel;
        observation.limitAccepted = body.max_results === 3;
        observation.credentialAccepted =
          request.headers.authorization === `Bearer ${credential}`;
      } else {
        const url = new URL(request.url!, "http://search.example.test");
        observation.methodAccepted = request.method === "GET";
        observation.queryAccepted = url.searchParams.get("q") === querySentinel;
        observation.limitAccepted =
          provider === "searxng"
            ? url.searchParams.get("format") === "json"
            : url.searchParams.get("count") === "3";
        observation.credentialAccepted =
          provider === "searxng"
            ? request.headers["x-subscription-token"] === undefined
            : request.headers["x-subscription-token"] === credential;
      }
      response.setHeader("content-type", "application/json");
      response.end(JSON.stringify(providerResponse(provider)));
    } catch {
      response.statusCode = 400;
      response.end();
    }
  });
  await new Promise<void>((resolveListen, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolveListen());
  });
  return server;
}

function providerFromRequest(
  request: IncomingMessage,
): WebSearchProvider | undefined {
  const path = new URL(request.url ?? "/", "http://search.example.test")
    .pathname;
  return path === "/brave" || path === "/searxng" || path === "/tavily"
    ? (path.slice(1) as WebSearchProvider)
    : undefined;
}

function providerResponse(
  provider: WebSearchProvider,
): Record<string, unknown> {
  const result = {
    title: `${provider} result`,
    url: `https://docs.example.test/${provider}`,
    description: "Controlled governed search result",
  };
  return provider === "brave"
    ? { web: { results: [result] } }
    : { results: [result] };
}

function emptyObservation() {
  return {
    requests: 0,
    methodAccepted: false,
    queryAccepted: false,
    credentialAccepted: false,
    limitAccepted: false,
    resultParsed: false,
    healthPersisted: false,
  };
}

async function readBody(request: IncomingMessage): Promise<string> {
  let body = "";
  request.setEncoding("utf8");
  for await (const chunk of request) body += chunk;
  return body;
}

async function writeEvidence(
  status: "failed" | "passed",
  error?: unknown,
): Promise<void> {
  const evidence = {
    schemaVersion: "romeo.live-web-search-protocol-acceptance.v1",
    generatedAt: new Date().toISOString(),
    status,
    durationMs: Math.round(performance.now() - startedAt),
    target: {
      transport: "http-json",
      controlledLoopback: true,
      providers: ["searxng", "brave", "tavily"],
    },
    checks: observations,
    redaction: {
      endpointReturned: false,
      credentialReturned: false,
      queryReturned: false,
      providerPayloadReturned: false,
      resultSnippetReturned: false,
    },
    ...(error === undefined
      ? {}
      : {
          failureCode:
            error instanceof Error
              ? createHash("sha256")
                  .update(error.message)
                  .digest("hex")
                  .slice(0, 16)
              : "unknown",
        }),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}
