import type { RomeoEnv } from "@romeo/config";
import {
  memoryObjectStore,
  S3ObjectStore,
  type ObjectStore,
} from "@romeo/storage";
import {
  devVoiceProvider,
  disabledVoiceProvider,
  OpenAICompatibleVoiceProvider,
  parseOpenAICompatibleVoiceCatalog,
  type VoiceProvider,
} from "@romeo/voices";

import type { RomeoRepository } from "../domain/repository";
import {
  InMemoryChatEventTransport,
  type ChatEventTransport,
} from "./chat-event-transport";
import {
  AwsSecretsManagerResolver,
  AzureKeyVaultResolver,
  CloudSecretResolver,
  GcpSecretManagerResolver,
} from "./cloud-secret-resolver";
import {
  disabledFileOcrProvider,
  LocalTesseractOcrProvider,
  type FileOcrProvider,
} from "./file-ocr";
import {
  disabledKnowledgeBinaryExtractor,
  type KnowledgeBinaryExtractor,
} from "./knowledge-extraction-worker";
import { LocalDocumentTextExtractor } from "./local-document-extractor";
import { LocalPdfTextExtractor } from "./local-pdf-extractor";
import {
  DiscoveryOidcAuthenticator,
  type OidcAuthenticator,
} from "./oidc-auth-service";
import {
  createDisabledQuotaCoordinator,
  type QuotaCoordinator,
} from "./quota-coordination";
import {
  disabledSecretResolver,
  EnvironmentSecretResolver,
  VaultSecretResolver,
  type SecretResolver,
} from "./secret-resolver";
import { VaultSecretWriter, type SecretWriter } from "./secret-writer";
import {
  EncryptedObjectToolDispatchPayloadStore,
  type ToolDispatchPayloadStore,
} from "./tool-dispatch-payload-store";
import { ValkeyQuotaCoordinator } from "./valkey-quota-coordinator";
import { ValkeyChatEventTransport } from "./valkey-chat-event-transport";

export function canResolveExternalVectorStoreSecret(
  env: RomeoEnv,
  options: { secretResolver?: SecretResolver },
): boolean {
  if (env.EXTERNAL_VECTOR_STORE_DRIVER !== "qdrant") return false;
  if (env.QDRANT_API_KEY_REF.trim().startsWith("romeo-secret://")) return true;
  if (options.secretResolver !== undefined) return true;
  return env.SECRET_RESOLVER_DRIVER !== "disabled";
}

export function createOidcAuthenticator(
  repository: RomeoRepository,
  env: RomeoEnv,
  fetchImpl: typeof fetch | undefined,
): OidcAuthenticator {
  return new DiscoveryOidcAuthenticator(
    repository,
    env,
    fetchImpl === undefined ? {} : { fetchImpl },
  );
}

export function createObjectStore(env: RomeoEnv): ObjectStore {
  if (env.OBJECT_STORE_DRIVER === "s3") {
    return new S3ObjectStore({
      endpoint: env.S3_ENDPOINT,
      bucket: env.S3_BUCKET,
      region: env.S3_REGION,
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    });
  }
  return memoryObjectStore;
}

export function createQuotaCoordinator(env: RomeoEnv): QuotaCoordinator {
  if (env.QUOTA_COORDINATION_DRIVER === "valkey") {
    return new ValkeyQuotaCoordinator({
      keyPrefix: env.QUOTA_COORDINATION_KEY_PREFIX,
      timeoutMs: env.QUOTA_COORDINATION_TIMEOUT_MS,
      url: env.VALKEY_URL,
    });
  }
  return createDisabledQuotaCoordinator(env.QUOTA_COORDINATION_KEY_PREFIX);
}

export function createChatEventTransport(env: RomeoEnv): ChatEventTransport {
  if (env.REALTIME_EVENT_DRIVER === "valkey") {
    return new ValkeyChatEventTransport({
      keyPrefix: env.REALTIME_EVENT_KEY_PREFIX,
      timeoutMs: env.REALTIME_EVENT_TIMEOUT_MS,
      url: env.VALKEY_URL,
    });
  }
  return new InMemoryChatEventTransport();
}

export function createToolDispatchPayloadStore(
  env: RomeoEnv,
  objectStore: ObjectStore,
): ToolDispatchPayloadStore | undefined {
  if (env.TOOL_DISPATCH_PAYLOAD_STORE_DRIVER !== "object-store")
    return undefined;
  return new EncryptedObjectToolDispatchPayloadStore(objectStore, {
    encryptionKey: env.TOOL_DISPATCH_PAYLOAD_ENCRYPTION_KEY,
    prefix: env.TOOL_DISPATCH_PAYLOAD_STORE_PREFIX,
  });
}

export function createKnowledgeExtractor(
  env: RomeoEnv,
): KnowledgeBinaryExtractor {
  if (env.KNOWLEDGE_EXTRACTION_DRIVER === "local-pdftotext") {
    return new LocalPdfTextExtractor({
      commandPath: env.PDFTOTEXT_PATH,
      maxBytes: env.KNOWLEDGE_EXTRACTION_MAX_BYTES,
      timeoutMs: env.KNOWLEDGE_EXTRACTION_TIMEOUT_MS,
    });
  }
  if (env.KNOWLEDGE_EXTRACTION_DRIVER === "local-documents") {
    return new LocalDocumentTextExtractor({
      ooxml: { maxBytes: env.KNOWLEDGE_EXTRACTION_MAX_BYTES },
      pdf: {
        commandPath: env.PDFTOTEXT_PATH,
        maxBytes: env.KNOWLEDGE_EXTRACTION_MAX_BYTES,
        timeoutMs: env.KNOWLEDGE_EXTRACTION_TIMEOUT_MS,
      },
    });
  }
  return disabledKnowledgeBinaryExtractor;
}

export function createFileOcrProvider(env: RomeoEnv): FileOcrProvider {
  if (env.FILE_OCR_DRIVER !== "local-tesseract") return disabledFileOcrProvider;
  return new LocalTesseractOcrProvider({
    language: env.FILE_OCR_LANGUAGE,
    maxBytes: env.KNOWLEDGE_EXTRACTION_MAX_BYTES,
    maxPages: env.FILE_OCR_MAX_PAGES,
    pdfToPpmPath: env.FILE_OCR_PDFTOPPM_PATH,
    tesseractPath: env.FILE_OCR_TESSERACT_PATH,
    timeoutMs: env.KNOWLEDGE_EXTRACTION_TIMEOUT_MS,
  });
}

export function createSecretResolver(env: RomeoEnv): SecretResolver {
  switch (env.SECRET_RESOLVER_DRIVER) {
    case "env":
      return new EnvironmentSecretResolver();
    case "vault":
      return new VaultSecretResolver({
        address: env.VAULT_ADDR,
        token: env.VAULT_TOKEN,
        namespace: env.VAULT_NAMESPACE,
        kvMount: env.VAULT_KV_MOUNT,
        timeoutMs: env.VAULT_TIMEOUT_MS,
      });
    case "aws-sm":
      return createAwsSecretsManagerResolver(env);
    case "gcp-sm":
      return createGcpSecretManagerResolver(env);
    case "azure-kv":
      return createAzureKeyVaultResolver(env);
    case "cloud":
      return new CloudSecretResolver({
        aws: createAwsSecretsManagerResolver(env),
        gcp: createGcpSecretManagerResolver(env),
        azure: createAzureKeyVaultResolver(env),
      });
    default:
      return disabledSecretResolver;
  }
}

export function createSecretWriter(env: RomeoEnv): SecretWriter {
  return new VaultSecretWriter({
    address: env.VAULT_ADDR,
    token: env.VAULT_TOKEN,
    namespace: env.VAULT_NAMESPACE,
    kvMount: env.VAULT_KV_MOUNT,
    timeoutMs: env.VAULT_TIMEOUT_MS,
  });
}

export function createVoiceProvider(env: RomeoEnv): VoiceProvider {
  if (env.VOICE_PROVIDER_DRIVER === "dev") return devVoiceProvider;
  if (env.VOICE_PROVIDER_DRIVER === "openai-compatible") {
    return new OpenAICompatibleVoiceProvider({
      apiKey: env.VOICE_OPENAI_API_KEY,
      baseUrl: env.VOICE_OPENAI_BASE_URL,
      model: env.VOICE_OPENAI_MODEL,
      transcriptionModel: env.VOICE_OPENAI_TRANSCRIPTION_MODEL,
      voices: parseOpenAICompatibleVoiceCatalog(env.VOICE_OPENAI_VOICES),
      timeoutMs: env.VOICE_OPENAI_TIMEOUT_MS,
    });
  }
  return disabledVoiceProvider;
}

function createAwsSecretsManagerResolver(
  env: RomeoEnv,
): AwsSecretsManagerResolver {
  return new AwsSecretsManagerResolver({
    accessKeyId: env.AWS_ACCESS_KEY_ID,
    secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    sessionToken: env.AWS_SESSION_TOKEN,
    region: env.AWS_REGION,
    timeoutMs: env.AWS_SECRET_MANAGER_TIMEOUT_MS,
  });
}

function createGcpSecretManagerResolver(
  env: RomeoEnv,
): GcpSecretManagerResolver {
  return new GcpSecretManagerResolver({
    accessToken: env.GCP_ACCESS_TOKEN,
    projectId: env.GCP_SECRET_MANAGER_PROJECT,
    timeoutMs: env.GCP_SECRET_MANAGER_TIMEOUT_MS,
  });
}

function createAzureKeyVaultResolver(env: RomeoEnv): AzureKeyVaultResolver {
  return new AzureKeyVaultResolver({
    accessToken: env.AZURE_ACCESS_TOKEN,
    vaultUrl: env.AZURE_KEY_VAULT_URL,
    timeoutMs: env.AZURE_KEY_VAULT_TIMEOUT_MS,
  });
}
