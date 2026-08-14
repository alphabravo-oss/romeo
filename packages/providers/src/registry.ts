import { anthropicAdapter, anthropicUsageParser } from "./adapters/anthropic";
import { ollamaEmbeddingAdapter } from "./adapters/ollama-embeddings";
import { ollamaAdapter } from "./adapters/ollama";
import { openAiCompatibleEmbeddingAdapter } from "./adapters/openai-compatible-embeddings";
import { openAiCompatibleImageAdapter } from "./adapters/openai-compatible-images";
import { openAiCompatibleAdapter } from "./adapters/openai-compatible";
import { openAiResponsesCompatibleAdapter } from "./adapters/openai-responses-compatible";
import {
  anthropicErrorNormalizer,
  ollamaErrorNormalizer,
  openAiCompatibleErrorNormalizer,
  openAiResponsesCompatibleErrorNormalizer,
} from "./error-normalization";
import {
  ollamaUsageParser,
  openAiCompatibleUsageParser,
  openAiResponsesCompatibleUsageParser,
} from "./usage";
import {
  PROVIDER_DIALECT_CONTRACT_VERSION,
  type EmbeddingProviderAdapter,
  type ImageGenerationProviderAdapter,
  type ModelProviderAdapter,
  type ProviderDiscoveryAdapter,
  type ProviderDialect,
  type ProviderDialectOperation,
  type ProviderDialectSummary,
  type ProviderKind,
  type ProviderUsageParser,
} from "./types";

const optionalOperationKeys = [
  "audio",
  "batches",
  "capabilityProbing",
  "errorNormalization",
  "files",
  "tokenCounting",
  "usageParsing",
] as const satisfies readonly ProviderDialectOperation[];

const dialects = {
  anthropic: {
    chat: anthropicAdapter,
    contractVersion: PROVIDER_DIALECT_CONTRACT_VERSION,
    discovery: anthropicAdapter,
    errorNormalization: anthropicErrorNormalizer,
    kind: "anthropic",
    usageParsing: anthropicUsageParser,
    version: "anthropic-messages.v1",
  },
  "openai-compatible": {
    chat: openAiCompatibleAdapter,
    contractVersion: PROVIDER_DIALECT_CONTRACT_VERSION,
    discovery: openAiCompatibleAdapter,
    embeddings: openAiCompatibleEmbeddingAdapter,
    errorNormalization: openAiCompatibleErrorNormalizer,
    imageGeneration: openAiCompatibleImageAdapter,
    kind: "openai-compatible",
    usageParsing: openAiCompatibleUsageParser,
    version: "openai-chat-completions.v1",
  },
  "openai-responses-compatible": {
    chat: openAiResponsesCompatibleAdapter,
    contractVersion: PROVIDER_DIALECT_CONTRACT_VERSION,
    discovery: openAiResponsesCompatibleAdapter,
    embeddings: {
      ...openAiCompatibleEmbeddingAdapter,
      kind: "openai-responses-compatible",
    },
    errorNormalization: openAiResponsesCompatibleErrorNormalizer,
    imageGeneration: {
      ...openAiCompatibleImageAdapter,
      kind: "openai-responses-compatible",
    },
    kind: "openai-responses-compatible",
    usageParsing: openAiResponsesCompatibleUsageParser,
    version: "openai-responses.v1",
  },
  ollama: {
    chat: ollamaAdapter,
    contractVersion: PROVIDER_DIALECT_CONTRACT_VERSION,
    discovery: ollamaAdapter,
    embeddings: ollamaEmbeddingAdapter,
    errorNormalization: ollamaErrorNormalizer,
    kind: "ollama",
    usageParsing: ollamaUsageParser,
    version: "ollama-native.v1",
  },
} as const satisfies Record<ProviderKind, ProviderDialect>;

assertDialectRegistry(dialects);

export function getProviderDialect(
  kind: ProviderKind,
): Readonly<ProviderDialect> {
  return dialects[kind];
}

export function getProviderAdapter(kind: ProviderKind): ModelProviderAdapter {
  return dialects[kind].chat;
}

export function getProviderDiscoveryAdapter(
  kind: ProviderKind,
): ProviderDiscoveryAdapter {
  return getProviderDialect(kind).discovery;
}

export function getEmbeddingAdapter(
  kind: ProviderKind,
): EmbeddingProviderAdapter {
  const adapter = getProviderDialect(kind).embeddings;
  if (adapter === undefined) {
    throw new Error(`${kind} does not expose an embeddings API.`);
  }
  return adapter;
}

export function getImageGenerationAdapter(
  kind: ProviderKind,
): ImageGenerationProviderAdapter {
  const adapter = getProviderDialect(kind).imageGeneration;
  if (adapter === undefined) {
    throw new Error(`${kind} does not expose an image generation API.`);
  }
  return adapter;
}

export function getProviderUsageParser(
  kind: ProviderKind,
): ProviderUsageParser {
  const parser = getProviderDialect(kind).usageParsing;
  if (parser === undefined) {
    throw new Error(`${kind} does not expose a standalone usage parser.`);
  }
  return parser;
}

export function listProviderDialects(): ProviderDialectSummary[] {
  return (Object.keys(dialects) as ProviderKind[])
    .sort()
    .map(getProviderDialectSummary);
}

export function getProviderDialectSummary(
  kind: ProviderKind,
): ProviderDialectSummary {
  const dialect = dialects[kind];
  return {
    contractVersion: dialect.contractVersion,
    kind,
    operations: {
      audio: "audio" in dialect,
      batches: "batches" in dialect,
      capabilityProbing: "capabilityProbing" in dialect,
      chat: true,
      discovery: true,
      embeddings: "embeddings" in dialect,
      errorNormalization: "errorNormalization" in dialect,
      files: "files" in dialect,
      imageGeneration: "imageGeneration" in dialect,
      tokenCounting: "tokenCounting" in dialect,
      usageParsing: "usageParsing" in dialect,
    },
    version: dialect.version,
  };
}

function assertDialectRegistry(
  registry: Readonly<Record<ProviderKind, ProviderDialect>>,
): void {
  const versions = new Set<string>();
  for (const [kind, dialect] of Object.entries(registry) as Array<
    [ProviderKind, ProviderDialect]
  >) {
    if (
      dialect.kind !== kind ||
      dialect.chat.kind !== kind ||
      dialect.discovery.kind !== kind ||
      (dialect.embeddings?.kind !== undefined &&
        dialect.embeddings.kind !== kind) ||
      (dialect.imageGeneration?.kind !== undefined &&
        dialect.imageGeneration.kind !== kind) ||
      optionalOperationKindMismatch(kind, dialect)
    ) {
      throw new Error(`Provider dialect registry kind mismatch: ${kind}.`);
    }
    if (!/^[a-z0-9][a-z0-9.-]{2,79}$/u.test(dialect.version)) {
      throw new Error(`Invalid provider dialect version for ${kind}.`);
    }
    const identity = `${kind}@${dialect.version}`;
    if (versions.has(identity)) {
      throw new Error(`Duplicate provider dialect identity: ${identity}.`);
    }
    versions.add(identity);
  }
}

function optionalOperationKindMismatch(
  kind: ProviderKind,
  dialect: ProviderDialect,
): boolean {
  return optionalOperationKeys.some((operation) => {
    const adapter = dialect[operation];
    return adapter !== undefined && adapter.kind !== kind;
  });
}
