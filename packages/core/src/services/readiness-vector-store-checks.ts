import type { RomeoEnv } from "@romeo/config";

import type {
  KnowledgeVectorStoreReadinessProbe,
  KnowledgeVectorStoreReadinessReport,
} from "./knowledge-vector-store";
import {
  qdrantEndpointValid,
  type VectorStoreDeploymentPosture,
  vectorStoreDeploymentFromEnv,
} from "./vector-store-deployment";
import { fail, pass, warn, type ReadinessCheck } from "./readiness-result";

export async function vectorStoreDeploymentCheck(input: {
  env: RomeoEnv;
  deployment?: VectorStoreDeploymentPosture | undefined;
  readinessProbe?: KnowledgeVectorStoreReadinessProbe | undefined;
}): Promise<ReadinessCheck> {
  const env = input.env;
  const deployment =
    input.deployment ?? vectorStoreDeploymentFromEnv(input.env);
  const readinessProbe = input.readinessProbe;
  const external = deployment.externalVectorStore;
  if (externalIsolationMode(deployment.isolationMode)) {
    const missing = externalIsolationMissing({ deployment, env });
    if (missing.length > 0) {
      return fail(
        "vector_store",
        "critical",
        "External vector isolation mode is configured but active routing is incomplete.",
        {
          activeDriver: deployment.activeDriver,
          externalVectorStoreDriver: external.driver,
          externalVectorStoreConfigured: external.configured,
          externalVectorStoreRoutingActive: external.routingActive,
          isolationMode: deployment.isolationMode,
          credentialRefConfigured: external.credentialRefConfigured,
          credentialRefValid: external.credentialRefValid,
          credentialRefScheme: external.credentialRefScheme,
          namespacePolicy: external.namespacePolicy,
          partitioningPolicy: external.partitioningPolicy,
          secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
          missing,
          required:
            "active Qdrant routing for the configured namespace and partition policies",
        },
      );
    }
  }
  if (external.driver === "disabled") {
    return pass("vector_store", "Default pgvector vector storage is active.", {
      activeDriver: deployment.activeDriver,
      externalVectorStoreDriver: external.driver,
      isolationMode: deployment.isolationMode,
    });
  }

  const missing = qdrantDeploymentMissing(deployment, env);

  if (missing.length > 0) {
    return fail(
      "vector_store",
      "critical",
      "Qdrant external vector-store mode is enabled but deployment wiring is incomplete.",
      {
        externalVectorStoreDriver: external.driver,
        missing,
        credentialRefConfigured: external.credentialRefConfigured,
        credentialRefValid: external.credentialRefValid,
        credentialRefScheme: external.credentialRefScheme,
        namespacePolicy: external.namespacePolicy,
        partitioningPolicy: external.partitioningPolicy,
        secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
        required:
          "QDRANT_URL, QDRANT_COLLECTION, QDRANT_API_KEY_REF, VECTOR_NAMESPACE_POLICY, and compatible secret resolution",
      },
    );
  }

  if (external.routingActive && readinessProbe === undefined) {
    return warn(
      "vector_store",
      "Qdrant external vector-store routing is active, but collection health probing is not configured for this service instance.",
      {
        activeDriver: deployment.activeDriver,
        externalVectorStoreDriver: external.driver,
        externalVectorStoreConfigured: external.configured,
        externalVectorStoreRoutingActive: external.routingActive,
        credentialRefScheme: external.credentialRefScheme,
        namespacePolicy: external.namespacePolicy,
        partitioningPolicy: external.partitioningPolicy,
        secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
      },
    );
  }

  if (external.routingActive && readinessProbe !== undefined) {
    const health = await readinessProbe.checkReadiness();
    if (health.status === "unavailable") {
      return fail(
        "vector_store",
        "critical",
        "Qdrant external vector-store routing is active but the collection health check failed.",
        {
          activeDriver: deployment.activeDriver,
          externalVectorStoreDriver: external.driver,
          externalVectorStoreConfigured: external.configured,
          externalVectorStoreRoutingActive: external.routingActive,
          credentialRefScheme: external.credentialRefScheme,
          namespacePolicy: external.namespacePolicy,
          partitioningPolicy: external.partitioningPolicy,
          secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
          health: sanitizedVectorStoreHealth(health),
        },
      );
    }
    return pass(
      "vector_store",
      "Qdrant external vector-store routing and collection health check are active.",
      {
        activeDriver: deployment.activeDriver,
        externalVectorStoreDriver: external.driver,
        externalVectorStoreConfigured: external.configured,
        externalVectorStoreRoutingActive: external.routingActive,
        credentialRefScheme: external.credentialRefScheme,
        namespacePolicy: external.namespacePolicy,
        partitioningPolicy: external.partitioningPolicy,
        secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
        health: sanitizedVectorStoreHealth(health),
      },
    );
  }

  return warn(
    "vector_store",
    "Qdrant external vector-store configuration is complete, but active retrieval routing is not enabled in this service instance.",
    {
      activeDriver: deployment.activeDriver,
      externalVectorStoreDriver: external.driver,
      externalVectorStoreConfigured: external.configured,
      externalVectorStoreRoutingActive: external.routingActive,
      credentialRefScheme: external.credentialRefScheme,
      namespacePolicy: external.namespacePolicy,
      partitioningPolicy: external.partitioningPolicy,
      secretResolverDriver: env.SECRET_RESOLVER_DRIVER,
    },
  );
}

function externalIsolationMode(
  mode: VectorStoreDeploymentPosture["isolationMode"],
): boolean {
  return (
    mode === "external_namespace_per_org" ||
    mode === "external_collection_per_org" ||
    mode === "dedicated_vector_store_per_org"
  );
}

function externalIsolationMissing(input: {
  deployment: VectorStoreDeploymentPosture;
  env: RomeoEnv;
}): string[] {
  const external = input.deployment.externalVectorStore;
  const missing = qdrantDeploymentMissing(input.deployment, input.env);
  if (external.driver !== "qdrant") {
    missing.push("EXTERNAL_VECTOR_STORE_DRIVER=qdrant");
  }
  if (!external.routingActive) {
    missing.push("active Qdrant routing");
  }
  if (
    input.deployment.isolationMode === "external_namespace_per_org" &&
    external.namespacePolicy !== "org"
  ) {
    missing.push("VECTOR_NAMESPACE_POLICY=org");
  }
  return Array.from(new Set(missing)).sort();
}

function qdrantDeploymentMissing(
  deployment: VectorStoreDeploymentPosture,
  env: RomeoEnv,
): string[] {
  const external = deployment.externalVectorStore;
  if (external.driver !== "qdrant") return [];
  const missing: string[] = [];
  if (!external.endpointConfigured) missing.push("QDRANT_URL");
  if (external.endpointConfigured && !qdrantEndpointValid(env.QDRANT_URL)) {
    missing.push("valid QDRANT_URL http(s) origin");
  }
  if (!external.collectionConfigured) missing.push("QDRANT_COLLECTION");
  if (!external.credentialRefConfigured) missing.push("QDRANT_API_KEY_REF");
  if (external.credentialRefConfigured && !external.credentialRefValid) {
    missing.push("valid QDRANT_API_KEY_REF managed secret URI");
  }
  if (
    external.credentialRefConfigured &&
    external.credentialRefValid &&
    external.credentialRefScheme !== "romeo-secret" &&
    env.SECRET_RESOLVER_DRIVER === "disabled"
  ) {
    missing.push("SECRET_RESOLVER_DRIVER");
  }
  if (external.namespacePolicy === "none") {
    missing.push("VECTOR_NAMESPACE_POLICY");
  }
  return missing;
}

function sanitizedVectorStoreHealth(
  health: KnowledgeVectorStoreReadinessReport,
): Record<string, unknown> {
  return {
    status: health.status,
    ...(health.collectionStatus === undefined
      ? {}
      : { collectionStatus: health.collectionStatus }),
    ...(health.failureCode === undefined
      ? {}
      : { failureCode: health.failureCode }),
    ...(health.httpStatus === undefined
      ? {}
      : { httpStatus: health.httpStatus }),
    ...(health.optimizerStatus === undefined
      ? {}
      : { optimizerStatus: health.optimizerStatus }),
  };
}
