import type { Query, QueryClient, QueryKey } from "@tanstack/react-query";

interface DiagnosticMeta {
  dimensions?: Record<string, unknown>;
  resource: string;
}

const knownScopedKeyPositions = new Map<string, readonly number[]>([
  ["adminAnalyticsSummary", [1]],
  ["agentKnowledgeBindings", [1]],
  ["agentReadiness", [1]],
  ["agentShares", [1]],
  ["agentTools", [1]],
  ["agentVersions", [1]],
  ["auditLogs", [1]],
  ["chat", [1]],
  ["chatComments", [1]],
  ["chatSearch", [1, 2]],
  ["chatShares", [1]],
  ["chats", [1]],
  ["chatsByTag", [1]],
  ["commandCatalog", [1]],
  ["dataConnectorSyncs", [1]],
  ["dataConnectors", [1]],
  ["delegatedOAuthConnections", [1]],
  ["evalDashboard", [1]],
  ["evalRatings", [1]],
  ["evalResults", [1]],
  ["evalRuns", [1]],
  ["evalSuites", [1]],
  ["files", [1]],
  ["folderItems", [1]],
  ["folderItemsBatch", [1, 2]],
  ["folders", [1]],
  ["knowledgeBases", [1]],
  ["knowledgeShares", [1]],
  ["knowledgeSources", [1]],
  ["managedModelCustomizationPolicy", [1]],
  ["managedModelPreferences", [1]],
  ["messageFeedback", [1]],
  ["messages", [1]],
  ["modelShares", [1]],
  ["personalContent", [1, 2]],
  ["promptMarketplace", [1]],
  ["promptTemplates", [1]],
  ["queuedTurns", [1]],
  ["routerSession", [1]],
  ["shareTargets", [1]],
  ["streamingMessage", [1, 2]],
  ["toolOperations", [1]],
  ["usageEvents", [1]],
  ["webhookDeliveries", [1]],
  ["webhooks", [1]],
  ["workflowRuns", [1]],
  ["workflowTemplates", [1]],
  ["workflows", [1]],
  ["workspaceCapabilities", [1]],
  ["workspaceMembers", [1]],
]);

export function queryDiagnosticMeta(
  resource: string,
  dimensions: Record<string, unknown> = {},
) {
  return { queryDiagnostic: { dimensions, resource } } as const;
}

export function devQueryDiagnosticMeta(
  resource: string,
  dimensions: Record<string, unknown> = {},
) {
  return import.meta.env.DEV ? queryDiagnosticMeta(resource, dimensions) : {};
}

export function installQueryCacheDiagnostics(
  queryClient: QueryClient,
  warn: (message: string) => void = console.warn,
): () => void {
  const signatures = new Map<string, string>();
  const warned = new Set<string>();
  return queryClient.getQueryCache().subscribe((event) => {
    const messages = diagnoseQuery(event.query, signatures);
    for (const message of messages) {
      if (warned.has(message)) continue;
      warned.add(message);
      warn(`[query-cache] ${message}`);
    }
  });
}

export function diagnoseQuery(
  query: Pick<Query, "meta" | "queryHash" | "queryKey" | "state">,
  signatures: Map<string, string>,
): string[] {
  const messages: string[] = [];
  const diagnostic = readDiagnosticMeta(query.meta);
  const signature = JSON.stringify({
    key: query.queryKey,
    resource: diagnostic?.resource,
  });
  const previous = signatures.get(query.queryHash);
  if (previous !== undefined && previous !== signature) {
    messages.push(`key collision for hash ${query.queryHash}`);
  } else {
    signatures.set(query.queryHash, signature);
  }

  if (diagnostic !== undefined) {
    for (const [dimension, value] of Object.entries(
      diagnostic.dimensions ?? {},
    )) {
      if (value === undefined || value === null || value === "") {
        messages.push(`${diagnostic.resource} is missing ${dimension}`);
      } else if (!containsDimension(query.queryKey, value)) {
        messages.push(`${diagnostic.resource} key is missing ${dimension}`);
      }
    }
  }
  if (query.state.fetchStatus !== "idle") {
    const missing = missingKnownKeyDimension(query.queryKey);
    if (missing !== undefined) messages.push(missing);
  }
  return messages;
}

function containsDimension(value: unknown, expected: unknown): boolean {
  if (structurallyEqual(value, expected)) return true;
  if (Array.isArray(value)) {
    return value.some((entry) => containsDimension(entry, expected));
  }
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).some((entry) =>
    containsDimension(entry, expected),
  );
}

function structurallyEqual(left: unknown, right: unknown): boolean {
  if (Object.is(left, right)) return true;
  if (
    typeof left !== "object" ||
    left === null ||
    typeof right !== "object" ||
    right === null
  )
    return false;
  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((entry, index) => structurallyEqual(entry, right[index]))
    );
  }
  const leftRecord = left as Record<string, unknown>;
  const rightRecord = right as Record<string, unknown>;
  const leftKeys = Object.keys(leftRecord).sort();
  const rightKeys = Object.keys(rightRecord).sort();
  return (
    leftKeys.length === rightKeys.length &&
    leftKeys.every(
      (key, index) =>
        key === rightKeys[index] &&
        structurallyEqual(leftRecord[key], rightRecord[key]),
    )
  );
}

function readDiagnosticMeta(meta: Query["meta"]): DiagnosticMeta | undefined {
  const value = meta?.queryDiagnostic;
  if (typeof value !== "object" || value === null || !("resource" in value))
    return undefined;
  return typeof value.resource === "string"
    ? (value as unknown as DiagnosticMeta)
    : undefined;
}

function missingKnownKeyDimension(queryKey: QueryKey): string | undefined {
  const [resource] = queryKey;
  if (typeof resource !== "string") return undefined;
  const positions = knownScopedKeyPositions.get(resource);
  if (positions === undefined) return undefined;
  return positions.some((position) => {
    const dimension = queryKey[position];
    return dimension === undefined || dimension === null || dimension === "";
  })
    ? `${resource} is missing its resource scope`
    : undefined;
}
