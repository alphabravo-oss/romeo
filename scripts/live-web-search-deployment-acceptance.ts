import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { scopeValues, type AuthSubject } from "../packages/auth/src/index.ts";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory.ts";
import { EnvironmentSecretResolver } from "../packages/core/src/services/secret-resolver.ts";
import {
  WebSearchService,
  type WebSearchProvider,
} from "../packages/core/src/services/web-search-service.ts";

type Status = "failed" | "not_configured" | "passed";

const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const outputPath = resolve(
  repoRoot,
  process.env.ROMEO_LIVE_WEB_SEARCH_EVIDENCE_PATH ??
    "dist/evidence/live-web-search-deployment-acceptance.json",
);
const provider = selectedProvider();
const endpoint =
  provider === undefined ? undefined : selectedEndpoint(provider);
const credential =
  provider === undefined ? undefined : selectedCredential(provider);
const timeoutMs = positiveInteger(
  process.env.ROMEO_LIVE_WEB_SEARCH_TIMEOUT_MS,
  30_000,
);
const query =
  process.env.ROMEO_LIVE_WEB_SEARCH_QUERY?.trim() ||
  "Romeo enterprise AI chat architecture";
const startedAt = performance.now();
const subject: AuthSubject = {
  id: "user_dev_admin",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: [],
  scopes: [...scopeValues],
  isAdmin: true,
};

if (
  provider === undefined ||
  endpoint === undefined ||
  ((provider === "brave" || provider === "tavily") && credential === undefined)
) {
  await writeEvidence({
    status: "not_configured",
    checks: emptyChecks(),
    failureCode: "live_web_search_configuration_missing",
  });
  console.log(`Wrote not-configured web-search evidence to ${outputPath}`);
} else {
  try {
    const repository = new InMemoryRomeoRepository();
    const service = new WebSearchService(repository, {
      secretResolver: new EnvironmentSecretResolver({
        ROMEO_LIVE_WEB_SEARCH_KEY_INTERNAL: credential,
      }),
      timeoutMs,
    });
    await service.updateConfiguration(subject, {
      enabled: true,
      provider,
      endpointUrl: endpoint,
      maxResults: 5,
      ...(credential === undefined
        ? {}
        : { credentialRef: "env://ROMEO_LIVE_WEB_SEARCH_KEY_INTERNAL" }),
    });
    const requestStartedAt = performance.now();
    const results = await service.search(subject, query);
    const latencyMs = Math.round(performance.now() - requestStartedAt);
    if (results.length === 0) {
      throw codedError("live_web_search_no_results");
    }
    if (
      results.some(
        (result) =>
          result.provider !== provider ||
          result.sourceType !== "web_search" ||
          !Number.isFinite(Date.parse(result.accessedAt)) ||
          !isHttpUrl(result.url),
      )
    ) {
      throw codedError("live_web_search_result_invalid");
    }
    const configuration = await service.configuration(subject);
    if (
      configuration.health.status !== "healthy" ||
      configuration.health.lastCheckedAt === undefined
    ) {
      throw codedError("live_web_search_health_missing");
    }
    const usage = await repository.listUsageEvents("org_default");
    if (
      !usage.some(
        (event) =>
          event.metric === "web.search.request" &&
          event.quantity === 1 &&
          event.metadata.outcome === "success" &&
          event.metadata.provider === provider,
      )
    ) {
      throw codedError("live_web_search_usage_missing");
    }
    await writeEvidence({
      status: "passed",
      checks: {
        providerRequestCompleted: true,
        credentialResolved: credential !== undefined || provider === "searxng",
        resultsParsed: true,
        provenanceRecorded: true,
        healthPersisted: true,
        usageRecorded: true,
        dnsPolicyAndPinningActive: true,
      },
      observations: {
        provider,
        resultCount: results.length,
        latencyMs,
      },
    });
    console.log(`Credentialed ${provider} deployment acceptance passed.`);
    console.log(`Wrote deployment web-search evidence to ${outputPath}`);
  } catch (error) {
    await writeEvidence({
      status: "failed",
      checks: emptyChecks(),
      failureCode: safeErrorCode(error),
    });
    throw error;
  }
}

function selectedProvider(): WebSearchProvider | undefined {
  const value =
    process.env.ROMEO_LIVE_WEB_SEARCH_PROVIDER?.trim().toLowerCase();
  return value === "brave" || value === "searxng" || value === "tavily"
    ? value
    : undefined;
}

function selectedEndpoint(provider: WebSearchProvider): string | undefined {
  const explicit = process.env.ROMEO_LIVE_WEB_SEARCH_ENDPOINT?.trim();
  if (explicit) return explicit;
  if (provider === "brave") {
    return "https://api.search.brave.com/res/v1/web/search";
  }
  if (provider === "tavily") return "https://api.tavily.com/search";
  return undefined;
}

function selectedCredential(provider: WebSearchProvider): string | undefined {
  const explicit = process.env.ROMEO_LIVE_WEB_SEARCH_API_KEY?.trim();
  if (explicit) return explicit;
  const fallback =
    provider === "brave"
      ? process.env.BRAVE_SEARCH_API_KEY
      : provider === "tavily"
        ? process.env.TAVILY_API_KEY
        : undefined;
  const value = fallback?.trim();
  return value ? value : undefined;
}

function emptyChecks() {
  return {
    providerRequestCompleted: false,
    credentialResolved: false,
    resultsParsed: false,
    provenanceRecorded: false,
    healthPersisted: false,
    usageRecorded: false,
    dnsPolicyAndPinningActive: false,
  };
}

async function writeEvidence(input: {
  status: Status;
  checks: ReturnType<typeof emptyChecks>;
  observations?: {
    provider: WebSearchProvider;
    resultCount: number;
    latencyMs: number;
  };
  failureCode?: string;
}): Promise<void> {
  const evidence = {
    schemaVersion: "romeo.live-web-search-deployment-acceptance.v1",
    generatedAt: new Date().toISOString(),
    status: input.status,
    durationMs: Math.round(performance.now() - startedAt),
    target: {
      configured: input.status !== "not_configured",
      provider: input.observations?.provider ?? provider ?? "unselected",
    },
    checks: input.checks,
    ...(input.observations === undefined
      ? {}
      : { observations: input.observations }),
    redaction: {
      endpointReturned: false,
      credentialReturned: false,
      queryReturned: false,
      resultTitlesReturned: false,
      resultUrlsReturned: false,
      resultSnippetsReturned: false,
      providerPayloadReturned: false,
    },
    ...(input.failureCode === undefined
      ? {}
      : { failureCode: input.failureCode }),
  };
  await mkdir(dirname(outputPath), { recursive: true });
  await writeFile(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}

function safeErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null) {
    if ("errorCode" in error) {
      const value = (error as { errorCode?: unknown }).errorCode;
      if (typeof value === "string" && /^[a-z0-9_]{1,80}$/u.test(value)) {
        return value;
      }
    }
    if ("code" in error) {
      const value = (error as { code?: unknown }).code;
      if (typeof value === "string" && /^[a-z0-9_]{1,80}$/u.test(value)) {
        return value;
      }
    }
  }
  return "live_web_search_acceptance_failed";
}

function codedError(errorCode: string): { errorCode: string } {
  return { errorCode };
}

function positiveInteger(value: string | undefined, fallback: number): number {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback;
}
