import type { RomeoEnv } from "@romeo/config";

import { parseManagedSecretRef } from "./secret-refs";

export type ActiveVectorDriver = "pgvector" | "qdrant";
export type ExternalVectorStoreDriver = "disabled" | "qdrant";
export type VectorIsolationMode =
  | "dedicated_vector_store_per_org"
  | "external_collection_per_org"
  | "external_namespace_per_org"
  | "pgvector_partitioned_by_org"
  | "shared_row_scope";
export type VectorNamespacePolicy =
  | "knowledge_base"
  | "none"
  | "org"
  | "workspace";
export type VectorPartitioningPolicy = VectorNamespacePolicy;

export interface ExternalVectorStorePosture {
  driver: ExternalVectorStoreDriver;
  endpointConfigured: boolean;
  collectionConfigured: boolean;
  credentialRefConfigured: boolean;
  credentialRefValid: boolean;
  credentialRefScheme?: string;
  namespacePolicy: VectorNamespacePolicy;
  partitioningPolicy: VectorPartitioningPolicy;
  configured: boolean;
  routingActive: boolean;
}

export interface VectorStoreDeploymentPosture {
  activeDriver: ActiveVectorDriver;
  isolationMode: VectorIsolationMode;
  pgvectorConfigured: boolean;
  externalVectorStore: ExternalVectorStorePosture;
}

export function vectorStoreDeploymentFromEnv(
  env: RomeoEnv,
): VectorStoreDeploymentPosture {
  const driver = env.EXTERNAL_VECTOR_STORE_DRIVER;
  const credential = credentialRefPosture(env.QDRANT_API_KEY_REF);
  const endpointConfigured =
    driver === "qdrant" && env.QDRANT_URL.trim().length > 0;
  const endpointValid = qdrantEndpointValid(env.QDRANT_URL);
  const collectionConfigured =
    driver === "qdrant" && env.QDRANT_COLLECTION.trim().length > 0;
  const namespacePolicy = env.VECTOR_NAMESPACE_POLICY;
  const partitioningPolicy = env.VECTOR_PARTITIONING_POLICY;
  const configured =
    driver === "qdrant" &&
    endpointConfigured &&
    endpointValid &&
    collectionConfigured &&
    credential.configured &&
    credential.valid &&
    namespacePolicy !== "none";

  return {
    activeDriver: "pgvector",
    isolationMode: env.VECTOR_ISOLATION_MODE,
    pgvectorConfigured: true,
    externalVectorStore: {
      driver,
      endpointConfigured,
      collectionConfigured,
      credentialRefConfigured: credential.configured,
      credentialRefValid: credential.valid,
      ...(credential.scheme === undefined
        ? {}
        : { credentialRefScheme: credential.scheme }),
      namespacePolicy,
      partitioningPolicy,
      configured,
      routingActive: false,
    },
  };
}

export function withExternalVectorRoutingActive(
  posture: VectorStoreDeploymentPosture,
): VectorStoreDeploymentPosture {
  if (!posture.externalVectorStore.configured) return posture;
  return {
    ...posture,
    activeDriver: "qdrant",
    externalVectorStore: {
      ...posture.externalVectorStore,
      routingActive: true,
    },
  };
}

export function qdrantEndpointValid(endpoint: string): boolean {
  const value = endpoint.trim();
  if (value.length === 0) return false;
  try {
    const parsed = new URL(value);
    return (
      (parsed.protocol === "http:" || parsed.protocol === "https:") &&
      parsed.host.length > 0 &&
      parsed.username.length === 0 &&
      parsed.password.length === 0 &&
      parsed.search.length === 0 &&
      parsed.hash.length === 0
    );
  } catch {
    return false;
  }
}

function credentialRefPosture(secretRef: string): {
  configured: boolean;
  valid: boolean;
  scheme?: string;
} {
  const value = secretRef.trim();
  if (value.length === 0) return { configured: false, valid: false };
  try {
    const parsed = parseManagedSecretRef(value);
    return { configured: true, valid: true, scheme: parsed.scheme };
  } catch {
    return { configured: true, valid: false };
  }
}
