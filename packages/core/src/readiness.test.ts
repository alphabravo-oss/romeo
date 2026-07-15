import { readEnv } from "@romeo/config";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { createSeedData } from "./repositories/seed-data";
import { EnvironmentSecretResolver } from "./services/secret-resolver";

describe("readiness API", () => {
  it("flags development defaults before production use", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("attention_required");
    expect(
      body.data.checks.some(
        (check: { id: string; status: string }) =>
          check.id === "session_secret" && check.status === "fail",
      ),
    ).toBe(true);
    expect(
      body.data.checks.some(
        (check: { id: string; status: string }) =>
          check.id === "dev_seeded_login" && check.status === "fail",
      ),
    ).toBe(true);
    expect(
      body.data.checks.some(
        (check: { id: string; status: string }) =>
          check.id === "local_auth_secret_encryption_key" &&
          check.status === "fail",
      ),
    ).toBe(true);
  });

  it("can pass with production-like secrets, durable storage, and quotas", async () => {
    const seed = createSeedData();
    seed.quotaBuckets.push({
      id: "quota_prod_runs",
      orgId: "org_default",
      scopeType: "org",
      scopeId: "org_default",
      metric: "run.started",
      limit: 1000,
      used: 0,
      resetInterval: "monthly",
      resetAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    const env = readEnv({
      SESSION_SECRET: "prod-session-secret-32-bytes-long",
      LOCAL_AUTH_SECRET_ENCRYPTION_KEY: "prod-local-auth-secret-key-32-bytes",
      WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
      DEV_SEEDED_LOGIN: "false",
      OBJECT_STORE_DRIVER: "s3",
    });
    const repository = new DurableTestRepository(seed);
    const devApi = createRomeoApi(repository);
    const keyResponse = await devApi.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Readiness check", scopes: ["admin:read"] }),
    });
    const key = await keyResponse.json();
    const api = createRomeoApi(repository, { env });
    const response = await api.request("/api/v1/admin/readiness", {
      headers: { authorization: `Bearer ${key.data.token}` },
    });
    const body = await response.json();

    expect(keyResponse.status).toBe(201);
    expect(response.status).toBe(200);
    expect(body.data.status).toBe("ready");
    expect(
      body.data.checks.every(
        (check: { status: string }) => check.status === "pass",
      ),
    ).toBe(true);
  });

  it("fails readiness when mounted GA evidence is blocked without leaking mounted paths", async () => {
    const checklistPath = writeGaChecklistEvidence({
      status: "blocked",
      summary: {
        total: 2,
        satisfied: 1,
        excepted: 0,
        blocked: 1,
        environmentRequired: 1,
        securityCriticalBlocked: 1,
      },
      gates: [
        {
          id: "phase21.kubernetes_networkpolicy_enforcement",
          phase: "21",
          title: "Kubernetes NetworkPolicy CNI enforcement",
          status: "blocked",
          requiredForGa: true,
          exceptionAllowed: false,
          environmentRequired: true,
          securityCritical: true,
          evidence: [
            {
              path: "/tmp/RAW-GA-EVIDENCE-PATH/networkpolicy.json",
              status: "missing",
              failures: ["RAW-CNI-FAILURE-DETAIL"],
            },
          ],
        },
      ],
      exceptions: [
        {
          gateId: "phase21.kubernetes_networkpolicy_enforcement",
          status: "invalid",
          owner: "raw-owner@example.com",
          failures: ["RAW-EXCEPTION-DETAIL"],
        },
      ],
    });
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({ GA_CHECKLIST_PATH: checklistPath }),
    });
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "ga_evidence",
    );
    const serialized = JSON.stringify(check);

    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "fail",
      severity: "critical",
      details: {
        checklistConfigured: true,
        checklistStatus: "blocked",
        blockedGateCount: 1,
        requiredLiveBlockerCount: 1,
        warningCodes: ["ga_blocked", "live_environment_evidence_required"],
      },
    });
    expect(serialized).not.toContain(checklistPath);
    expect(serialized).not.toContain("RAW-GA-EVIDENCE-PATH");
    expect(serialized).not.toContain("RAW-CNI-FAILURE-DETAIL");
    expect(serialized).not.toContain("RAW-EXCEPTION-DETAIL");
    expect(serialized).not.toContain("raw-owner@example.com");
  });

  it("warns when remote Postgres does not require TLS verification", async () => {
    const seed = createSeedData();
    seed.quotaBuckets.push({
      id: "quota_prod_runs",
      orgId: "org_default",
      scopeType: "org",
      scopeId: "org_default",
      metric: "run.started",
      limit: 1000,
      used: 0,
      resetInterval: "monthly",
      resetAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    const repository = new DurableTestRepository(seed);
    const devApi = createRomeoApi(repository);
    const keyResponse = await devApi.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Readiness check", scopes: ["admin:read"] }),
    });
    const key = await keyResponse.json();
    const api = createRomeoApi(repository, {
      env: readEnv({
        SESSION_SECRET: "prod-session-secret-32-bytes-long",
        LOCAL_AUTH_SECRET_ENCRYPTION_KEY: "prod-local-auth-secret-key-32-bytes",
        WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
        DEV_SEEDED_LOGIN: "false",
        OBJECT_STORE_DRIVER: "s3",
        DATABASE_URL: "postgres://romeo:super-secret@db.internal/romeo",
      }),
    });

    const response = await api.request("/api/v1/admin/readiness", {
      headers: { authorization: `Bearer ${key.data.token}` },
    });
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "postgres_connection_security",
    );
    const serialized = JSON.stringify(body);

    expect(keyResponse.status).toBe(201);
    expect(response.status).toBe(200);
    expect(body.data.status).toBe("attention_required");
    expect(check).toMatchObject({
      status: "warn",
      severity: "warning",
      details: {
        hostCategory: "remote",
        tlsConfigured: false,
        tlsMode: "unknown",
        warningCodes: ["postgres_hosted_tls_not_configured"],
      },
    });
    expect(serialized).not.toContain("super-secret");
    expect(serialized).not.toContain("db.internal");
    expect(serialized).not.toContain("postgres://");
  });

  it("fails readiness when Qdrant mode is enabled without secure deployment wiring", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_API_KEY_REF: "literal-secret-value",
      }),
    });
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "vector_store",
    );

    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "fail",
      severity: "critical",
      details: {
        externalVectorStoreDriver: "qdrant",
        credentialRefConfigured: true,
        credentialRefValid: false,
        namespacePolicy: "none",
      },
    });
    expect(check.details.missing).toEqual([
      "QDRANT_URL",
      "valid QDRANT_API_KEY_REF managed secret URI",
      "VECTOR_NAMESPACE_POLICY",
    ]);
    expect(JSON.stringify(check)).not.toContain("literal-secret-value");
  });

  it("fails readiness when pgvector partitioned isolation lacks live evidence", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        VECTOR_ISOLATION_MODE: "pgvector_partitioned_by_org",
      }),
    });
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "vector_store",
    );

    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "fail",
      severity: "critical",
      details: {
        activeDriver: "pgvector",
        externalVectorStoreDriver: "disabled",
        isolationMode: "pgvector_partitioned_by_org",
        evidence: {
          configured: false,
          status: "not_configured",
          tablePartitioned: false,
          partitionKeyIncludesOrgId: false,
          partitionCount: 0,
          hnswIndexCount: 0,
          queryPlanReviewed: false,
        },
      },
    });
  });

  it("passes the vector readiness check with live pgvector partition evidence", async () => {
    const evidencePath = writePgvectorIsolationEvidence({
      status: "passed",
      mode: "live",
      checks: {
        tableExists: true,
        tablePartitioned: true,
        partitionKeyIncludesOrgId: true,
        partitionCount: 16,
        hnswIndexCount: 16,
        queryPlanReviewed: true,
      },
    });
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        VECTOR_ISOLATION_MODE: "pgvector_partitioned_by_org",
        PGVECTOR_PHYSICAL_ISOLATION_EVIDENCE_PATH: evidencePath,
      }),
    });
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "vector_store",
    );
    const serialized = JSON.stringify(check);

    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "pass",
      details: {
        activeDriver: "pgvector",
        externalVectorStoreDriver: "disabled",
        isolationMode: "pgvector_partitioned_by_org",
        pgvectorPhysicalIsolationEvidence: {
          configured: true,
          status: "satisfied",
          evidenceStatus: "passed",
          evidenceMode: "live",
          tablePartitioned: true,
          partitionKeyIncludesOrgId: true,
          partitionCount: 16,
          hnswIndexCount: 16,
          queryPlanReviewed: true,
        },
      },
    });
    expect(serialized).not.toContain(evidencePath);
  });

  it("fails readiness when Qdrant uses external secrets but secret resolution is disabled", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: "https://qdrant.example.com",
        QDRANT_COLLECTION: "romeo-prod",
        QDRANT_API_KEY_REF: "vault://romeo/qdrant/api-key",
        VECTOR_NAMESPACE_POLICY: "workspace",
      }),
    });
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "vector_store",
    );
    const serialized = JSON.stringify(check);

    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "fail",
      severity: "critical",
      details: {
        externalVectorStoreDriver: "qdrant",
        credentialRefScheme: "vault",
        secretResolverDriver: "disabled",
      },
    });
    expect(check.details.missing).toEqual(["SECRET_RESOLVER_DRIVER"]);
    expect(serialized).not.toContain("qdrant.example.com");
    expect(serialized).not.toContain("romeo-prod");
    expect(serialized).not.toContain("qdrant/api-key");
  });

  it("fails readiness when Qdrant endpoint is not a safe HTTP origin", async () => {
    const unsafeUrl = "https://user:pass@qdrant.example.com?secret=true";
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: unsafeUrl,
        QDRANT_COLLECTION: "romeo-prod",
        QDRANT_API_KEY_REF: "vault://romeo/qdrant/api-key",
        SECRET_RESOLVER_DRIVER: "vault",
        VAULT_ADDR: "https://vault.example.com",
        VAULT_TOKEN: "vault-token-for-readiness",
        VECTOR_NAMESPACE_POLICY: "workspace",
      }),
    });
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "vector_store",
    );
    const serialized = JSON.stringify(check);

    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "fail",
      severity: "critical",
      details: {
        externalVectorStoreDriver: "qdrant",
        credentialRefScheme: "vault",
        secretResolverDriver: "vault",
      },
    });
    expect(check.details.missing).toEqual(["valid QDRANT_URL http(s) origin"]);
    expect(serialized).not.toContain("qdrant.example.com");
    expect(serialized).not.toContain("secret=true");
    expect(serialized).not.toContain("user:pass");
  });

  it("passes readiness when Qdrant runtime routing and collection health are active", async () => {
    const qdrantApiKey = "qdrant-readiness-key";
    const qdrantCalls: Array<{
      apiKey: string | null;
      method: string;
      url: string;
    }> = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: "https://qdrant.example.com",
        QDRANT_COLLECTION: "romeo-prod",
        QDRANT_API_KEY_REF: "env://QDRANT_API_KEY",
        SECRET_RESOLVER_DRIVER: "env",
        VECTOR_NAMESPACE_POLICY: "org",
        VECTOR_PARTITIONING_POLICY: "org",
      }),
      secretResolver: new EnvironmentSecretResolver({
        QDRANT_API_KEY: qdrantApiKey,
      }),
      qdrantFetch: async (input, init) => {
        qdrantCalls.push({
          apiKey: new Headers(init?.headers).get("api-key"),
          method: init?.method ?? "GET",
          url: String(input),
        });
        return new Response(
          JSON.stringify({
            result: { status: "green", optimizer_status: "ok" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "vector_store",
    );
    const serialized = JSON.stringify(check);

    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "pass",
      severity: "info",
      details: {
        activeDriver: "qdrant",
        externalVectorStoreDriver: "qdrant",
        externalVectorStoreConfigured: true,
        externalVectorStoreRoutingActive: true,
        credentialRefScheme: "env",
        namespacePolicy: "org",
        partitioningPolicy: "org",
        secretResolverDriver: "env",
        health: {
          status: "available",
          collectionStatus: "green",
          optimizerStatus: "ok",
        },
      },
    });
    expect(qdrantCalls).toEqual([
      {
        apiKey: qdrantApiKey,
        method: "GET",
        url: "https://qdrant.example.com/collections/romeo-prod",
      },
    ]);
    expect(serialized).not.toContain("qdrant.example.com");
    expect(serialized).not.toContain("romeo-prod");
    expect(serialized).not.toContain("env://QDRANT_API_KEY");
    expect(serialized).not.toContain(qdrantApiKey);
  });

  it("fails readiness when external vector isolation lacks reviewed live Qdrant evidence", async () => {
    const qdrantApiKey = "qdrant-readiness-key";
    const qdrantCalls: Array<string> = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: "https://qdrant.example.com",
        QDRANT_COLLECTION: "romeo-prod",
        QDRANT_API_KEY_REF: "env://QDRANT_API_KEY",
        SECRET_RESOLVER_DRIVER: "env",
        VECTOR_NAMESPACE_POLICY: "org",
        VECTOR_PARTITIONING_POLICY: "workspace",
        VECTOR_ISOLATION_MODE: "external_namespace_per_org",
      }),
      secretResolver: new EnvironmentSecretResolver({
        QDRANT_API_KEY: qdrantApiKey,
      }),
      qdrantFetch: async (input) => {
        qdrantCalls.push(String(input));
        return new Response(
          JSON.stringify({
            result: { status: "green", optimizer_status: "ok" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        );
      },
    });
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "vector_store",
    );
    const serialized = JSON.stringify(check);

    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "fail",
      severity: "critical",
      details: {
        activeDriver: "qdrant",
        externalVectorStoreDriver: "qdrant",
        externalVectorStoreConfigured: true,
        externalVectorStoreRoutingActive: true,
        isolationMode: "external_namespace_per_org",
        namespacePolicy: "org",
        partitioningPolicy: "workspace",
        qdrantLiveEvidence: {
          configured: false,
          status: "not_configured",
        },
      },
    });
    expect(check.details.missing).toEqual([
      "satisfied QDRANT_LIVE_EVIDENCE_PATH",
    ]);
    expect(qdrantCalls).toEqual([]);
    expect(serialized).not.toContain("qdrant.example.com");
    expect(serialized).not.toContain("romeo-prod");
    expect(serialized).not.toContain("env://QDRANT_API_KEY");
    expect(serialized).not.toContain(qdrantApiKey);
  });

  it("passes readiness when external vector isolation has matching reviewed live Qdrant evidence", async () => {
    const qdrantApiKey = "qdrant-readiness-key";
    const evidencePath = writeQdrantLiveEvidence({
      status: "passed",
      mode: "live",
      namespacePolicy: "org",
      partitioningPolicy: "workspace",
    });
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: "https://qdrant.example.com",
        QDRANT_COLLECTION: "romeo-prod",
        QDRANT_API_KEY_REF: "env://QDRANT_API_KEY",
        QDRANT_LIVE_EVIDENCE_PATH: evidencePath,
        SECRET_RESOLVER_DRIVER: "env",
        VECTOR_NAMESPACE_POLICY: "org",
        VECTOR_PARTITIONING_POLICY: "workspace",
        VECTOR_ISOLATION_MODE: "external_namespace_per_org",
      }),
      secretResolver: new EnvironmentSecretResolver({
        QDRANT_API_KEY: qdrantApiKey,
      }),
      qdrantFetch: async () =>
        new Response(
          JSON.stringify({
            result: { status: "green", optimizer_status: "ok" },
          }),
          {
            status: 200,
            headers: { "content-type": "application/json" },
          },
        ),
    });
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "vector_store",
    );
    const serialized = JSON.stringify(check);

    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "pass",
      severity: "info",
      details: {
        activeDriver: "qdrant",
        externalVectorStoreDriver: "qdrant",
        externalVectorStoreConfigured: true,
        externalVectorStoreRoutingActive: true,
        credentialRefScheme: "env",
        namespacePolicy: "org",
        partitioningPolicy: "workspace",
        secretResolverDriver: "env",
        health: {
          status: "available",
          collectionStatus: "green",
          optimizerStatus: "ok",
        },
      },
    });
    expect(serialized).not.toContain(evidencePath);
    expect(serialized).not.toContain("qdrant.example.com");
    expect(serialized).not.toContain("romeo-prod");
    expect(serialized).not.toContain("env://QDRANT_API_KEY");
    expect(serialized).not.toContain(qdrantApiKey);
  });

  it("fails readiness when Qdrant routing is active but the collection is unavailable", async () => {
    const qdrantApiKey = "qdrant-readiness-key";
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        EXTERNAL_VECTOR_STORE_DRIVER: "qdrant",
        QDRANT_URL: "https://qdrant.example.com",
        QDRANT_COLLECTION: "romeo-prod",
        QDRANT_API_KEY_REF: "env://QDRANT_API_KEY",
        SECRET_RESOLVER_DRIVER: "env",
        VECTOR_NAMESPACE_POLICY: "org",
      }),
      secretResolver: new EnvironmentSecretResolver({
        QDRANT_API_KEY: qdrantApiKey,
      }),
      qdrantFetch: async () =>
        new Response(JSON.stringify({ status: "not_found" }), {
          status: 404,
          statusText: "not found",
          headers: { "content-type": "application/json" },
        }),
    });
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "vector_store",
    );
    const serialized = JSON.stringify(check);

    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "fail",
      severity: "critical",
      details: {
        activeDriver: "qdrant",
        externalVectorStoreDriver: "qdrant",
        externalVectorStoreConfigured: true,
        externalVectorStoreRoutingActive: true,
        credentialRefScheme: "env",
        health: {
          status: "unavailable",
          failureCode: "collection_not_found",
          httpStatus: 404,
        },
      },
    });
    expect(serialized).not.toContain("qdrant.example.com");
    expect(serialized).not.toContain("romeo-prod");
    expect(serialized).not.toContain("env://QDRANT_API_KEY");
    expect(serialized).not.toContain(qdrantApiKey);
  });

  it("fails production readiness when the repository is process-local memory", async () => {
    const seed = createSeedData();
    seed.quotaBuckets.push({
      id: "quota_prod_runs",
      orgId: "org_default",
      scopeType: "org",
      scopeId: "org_default",
      metric: "run.started",
      limit: 1000,
      used: 0,
      resetInterval: "monthly",
      resetAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    const repository = new InMemoryRomeoRepository(seed);
    const devApi = createRomeoApi(repository);
    const keyResponse = await devApi.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Readiness check", scopes: ["admin:read"] }),
    });
    const key = await keyResponse.json();
    const api = createRomeoApi(repository, {
      env: readEnv({
        SESSION_SECRET: "prod-session-secret-32-bytes-long",
        WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
        DEV_SEEDED_LOGIN: "false",
        OBJECT_STORE_DRIVER: "s3",
      }),
    });
    const response = await api.request("/api/v1/admin/readiness", {
      headers: { authorization: `Bearer ${key.data.token}` },
    });
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "repository_persistence",
    );

    expect(keyResponse.status).toBe(201);
    expect(response.status).toBe(200);
    expect(body.data.status).toBe("attention_required");
    expect(check).toMatchObject({
      status: "fail",
      severity: "critical",
      details: {
        driver: "memory",
        storageScope: "process",
        required: "Postgres-backed RomeoRepository",
      },
    });
  });

  it("fails production readiness when a staged previous session secret is unsafe", async () => {
    const seed = createSeedData();
    seed.quotaBuckets.push({
      id: "quota_prod_runs",
      orgId: "org_default",
      scopeType: "org",
      scopeId: "org_default",
      metric: "run.started",
      limit: 1000,
      used: 0,
      resetInterval: "monthly",
      resetAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    const repository = new DurableTestRepository(seed);
    const devApi = createRomeoApi(repository);
    const keyResponse = await devApi.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Readiness check", scopes: ["admin:read"] }),
    });
    const key = await keyResponse.json();
    const api = createRomeoApi(repository, {
      env: readEnv({
        SESSION_SECRET: "prod-session-secret-32-bytes-long",
        SESSION_SECRET_PREVIOUS: "prod-session-secret-32-bytes-long",
        WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
        DEV_SEEDED_LOGIN: "false",
        OBJECT_STORE_DRIVER: "s3",
      }),
    });
    const response = await api.request("/api/v1/admin/readiness", {
      headers: { authorization: `Bearer ${key.data.token}` },
    });
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "session_secret_previous",
    );

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("attention_required");
    expect(check).toMatchObject({
      status: "fail",
      severity: "critical",
      details: { configured: true, required: "distinct previous secret" },
    });
  });

  it("fails when tool operation execution is enabled without required secret resolution", async () => {
    const seed = createSeedData();
    seed.quotaBuckets.push({
      id: "quota_prod_runs",
      orgId: "org_default",
      scopeType: "org",
      scopeId: "org_default",
      metric: "run.started",
      limit: 1000,
      used: 0,
      resetInterval: "monthly",
      resetAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    seed.toolConnectors.push({
      id: "tool_connector_ready_auth",
      orgId: "org_default",
      type: "openapi",
      name: "Ready auth connector",
      description: "",
      schema: { baseUrl: "https://api.example.com" },
      authConfig: {
        type: "bearer",
        configured: true,
        secretRef: "env://TOOL_TOKEN",
      },
      networkPolicy: {
        mode: "allow_hosts",
        allowedHosts: ["api.example.com"],
        allowPrivateNetwork: false,
      },
      riskLevel: "low",
      approvalPolicy: "never",
      visibility: "org",
      enabled: true,
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    const repository = new InMemoryRomeoRepository(seed);
    const devApi = createRomeoApi(repository);
    const keyResponse = await devApi.request("/api/v1/api-keys", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ name: "Readiness check", scopes: ["admin:read"] }),
    });
    const key = await keyResponse.json();
    const api = createRomeoApi(repository, {
      env: readEnv({
        SESSION_SECRET: "prod-session-secret-32-bytes-long",
        WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
        DEV_SEEDED_LOGIN: "false",
        OBJECT_STORE_DRIVER: "s3",
        TOOL_OPERATION_EXECUTION_DRIVER: "http-fetch",
        SECRET_RESOLVER_DRIVER: "disabled",
      }),
    });
    const response = await api.request("/api/v1/admin/readiness", {
      headers: { authorization: `Bearer ${key.data.token}` },
    });
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "tool_operation_execution",
    );

    expect(response.status).toBe(200);
    expect(body.data.status).toBe("attention_required");
    expect(check).toMatchObject({
      status: "fail",
      severity: "critical",
      details: { authConnectorCount: 1, required: "SECRET_RESOLVER_DRIVER" },
    });
  });

  it("warns when OIDC issuer and client configuration are incomplete", async () => {
    const seed = createSeedData();
    seed.quotaBuckets.push({
      id: "quota_prod_runs",
      orgId: "org_default",
      scopeType: "org",
      scopeId: "org_default",
      metric: "run.started",
      limit: 1000,
      used: 0,
      resetInterval: "monthly",
      resetAt: "2026-07-01T00:00:00.000Z",
      createdAt: "2026-06-27T00:00:00.000Z",
      updatedAt: "2026-06-27T00:00:00.000Z",
    });
    const repository = new InMemoryRomeoRepository(seed);
    const api = createRomeoApi(repository, {
      env: readEnv({
        SESSION_SECRET: "prod-session-secret-32-bytes-long",
        WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
        OBJECT_STORE_DRIVER: "s3",
        OIDC_ISSUER_URL: "https://keycloak.example.com/realms/romeo",
      }),
    });
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.data.checks.some(
        (check: { id: string; status: string }) =>
          check.id === "oidc_config" && check.status === "warn",
      ),
    ).toBe(true);
  });

  it("returns sanitized admin SSO settings without raw client identifiers", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        OIDC_ISSUER_URL: "https://keycloak.example.com/realms/romeo",
        OIDC_CLIENT_ID: "romeo-web",
        OIDC_ADMIN_GROUPS: "platform-admins,security-admins",
        OIDC_GROUP_MAP: "reviewers=group_reviewers",
        OIDC_WORKSPACE_GROUP_MAP: "engineering=workspace_default",
        OIDC_WORKSPACE_GROUP_PREFIX: "workspace:",
      }),
    });
    const response = await api.request("/api/v1/admin/sso-settings");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(body.data.configurationSource).toBe("environment");
    expect(body.data.status).toBe("enabled");
    expect(body.data.oidc).toMatchObject({
      bearerTokenAuthEnabled: true,
      browserPkceLoginEnabled: true,
      issuerHost: "keycloak.example.com",
      clientIdConfigured: true,
      adminGroupCount: 2,
      groupMappingCount: 1,
      workspaceGroupMappingCount: 1,
      workspaceGroupPrefixConfigured: true,
    });
    expect(JSON.stringify(body.data)).not.toContain("romeo-web");
    expect(JSON.stringify(body.data)).not.toContain("/realms/romeo");
  });

  it("updates sanitized admin SSO settings without returning raw issuer paths or client IDs", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const response = await api.request("/api/v1/admin/sso-settings", {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        oidc: {
          enabled: true,
          providerPreset: "keycloak",
          issuerUrl: "https://keycloak.example.com/realms/romeo/",
          clientId: "romeo-web",
          groupClaim: "groups",
          adminGroups: [
            "security-admins",
            "platform-admins",
            "security-admins",
          ],
          groupMap: { reviewers: "group_reviewers" },
          workspaceGroupMap: { engineering: "workspace_default" },
          workspaceGroupPrefix: "workspace:",
        },
      }),
    });
    const body = await response.json();
    const stored = await repository.getSsoOidcSettings("org_default");
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();
    const auditLog = audit.data.find(
      (log: { action: string }) => log.action === "admin.sso_settings.update",
    );

    expect(response.status).toBe(200);
    expect(body.data).toMatchObject({
      configurationSource: "database",
      status: "enabled",
      oidc: {
        detectedProviderPreset: "keycloak",
        bearerTokenAuthEnabled: true,
        issuerHost: "keycloak.example.com",
        clientIdConfigured: true,
        adminGroupCount: 2,
        groupMappingCount: 1,
        workspaceGroupMappingCount: 1,
      },
    });
    expect(stored).toMatchObject({
      issuerUrl: "https://keycloak.example.com/realms/romeo",
      clientId: "romeo-web",
      groupClaim: "groups",
      adminGroups: ["platform-admins", "security-admins"],
    });
    expect(
      body.data.oidc.providerPresets.map((preset: { id: string }) => preset.id),
    ).toEqual(
      expect.arrayContaining([
        "generic",
        "keycloak",
        "google",
        "github",
        "azure-ad",
        "okta",
        "auth0",
      ]),
    );
    expect(auditLog).toBeDefined();
    expect(auditLog.metadata.providerPreset).toBe("keycloak");
    expect(JSON.stringify([body.data, auditLog.metadata])).not.toContain(
      "romeo-web",
    );
    expect(JSON.stringify([body.data, auditLog.metadata])).not.toContain(
      "/realms/romeo",
    );
  });

  it("tests OIDC discovery and JWKS without exposing raw SSO secrets or paths", async () => {
    const calls: string[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        OIDC_ISSUER_URL: "https://keycloak.example.com/realms/romeo",
        OIDC_CLIENT_ID: "romeo-web",
      }),
      oidcFetch: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/.well-known/openid-configuration")) {
          return Response.json({
            issuer: "https://keycloak.example.com/realms/romeo",
            jwks_uri:
              "https://keycloak.example.com/realms/romeo/protocol/openid-connect/certs",
          });
        }
        if (url.endsWith("/protocol/openid-connect/certs")) {
          return Response.json({
            keys: [{ kty: "RSA", kid: "kid_1", n: "modulus", e: "AQAB" }],
          });
        }
        return new Response("not found", { status: 404 });
      },
    });
    const response = await api.request("/api/v1/admin/sso-settings/test", {
      method: "POST",
    });
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      "https://keycloak.example.com/realms/romeo/.well-known/openid-configuration",
      "https://keycloak.example.com/realms/romeo/protocol/openid-connect/certs",
    ]);
    expect(body.data).toMatchObject({
      status: "passed",
      issuerHost: "keycloak.example.com",
      checks: [
        { id: "configuration", status: "pass", code: "oidc_config_complete" },
        { id: "discovery", status: "pass", code: "oidc_discovery_reachable" },
        { id: "jwks", status: "pass", code: "oidc_jwks_reachable" },
      ],
    });
    expect(JSON.stringify(body.data)).not.toContain("romeo-web");
    expect(JSON.stringify(body.data)).not.toContain("/realms/romeo");
    expect(JSON.stringify(body.data)).not.toContain(
      "/protocol/openid-connect/certs",
    );
  });

  it("tests auth-provider card OIDC connections without exposing raw config", async () => {
    const calls: string[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      oidcFetch: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/.well-known/openid-configuration")) {
          return Response.json({
            issuer: "https://keycloak.example.com/realms/romeo",
            jwks_uri:
              "https://keycloak.example.com/realms/romeo/protocol/openid-connect/certs",
          });
        }
        if (url.endsWith("/protocol/openid-connect/certs")) {
          return Response.json({
            keys: [{ kty: "RSA", kid: "kid_1", n: "modulus", e: "AQAB" }],
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const response = await api.request(
      "/api/v1/admin/auth-providers/settings/test",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          providerId: "keycloak",
          oidc: {
            issuerUrl: "https://keycloak.example.com/realms/romeo",
            clientId: "romeo-web",
          },
        }),
      },
    );
    const body = await response.json();
    const samlResponse = await api.request(
      "/api/v1/admin/auth-providers/settings/test",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "saml" }),
      },
    );
    const saml = await samlResponse.json();

    expect(response.status).toBe(200);
    expect(calls).toEqual([
      "https://keycloak.example.com/realms/romeo/.well-known/openid-configuration",
      "https://keycloak.example.com/realms/romeo/protocol/openid-connect/certs",
    ]);
    expect(body.data).toMatchObject({
      providerId: "keycloak",
      catalogStatus: "implemented",
      protocol: "oidc",
      runtimePackage: "openid-client",
      configurationSource: "transient_request",
      status: "passed",
      enabled: false,
      issuerHost: "keycloak.example.com",
      detectedProviderPreset: "keycloak",
      checks: [
        {
          id: "adapter",
          status: "pass",
          code: "auth_provider_adapter_available",
        },
        { id: "configuration", status: "pass", code: "oidc_config_complete" },
        { id: "discovery", status: "pass", code: "oidc_discovery_reachable" },
        { id: "jwks", status: "pass", code: "oidc_jwks_reachable" },
      ],
    });
    expect(JSON.stringify(body.data)).not.toContain("romeo-web");
    expect(JSON.stringify(body.data)).not.toContain("/realms/romeo");
    expect(JSON.stringify(body.data)).not.toContain(
      "/protocol/openid-connect/certs",
    );
    expect(samlResponse.status).toBe(200);
    expect(saml.data).toMatchObject({
      providerId: "saml",
      catalogStatus: "implemented",
      protocol: "saml",
      runtimePackage: "@node-saml/node-saml",
      status: "disabled",
      enabled: false,
    });
  });

  it("persists per-provider OIDC connection config and tests it from provider settings", async () => {
    const calls: string[] = [];
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      oidcFetch: async (input) => {
        const url = String(input);
        calls.push(url);
        if (url.endsWith("/.well-known/openid-configuration")) {
          return Response.json({
            issuer: "https://tenant.okta.com/oauth2/default",
            jwks_uri: "https://tenant.okta.com/oauth2/default/v1/keys",
          });
        }
        if (url.endsWith("/v1/keys")) {
          return Response.json({
            keys: [{ kty: "RSA", kid: "kid_1", n: "modulus", e: "AQAB" }],
          });
        }
        return new Response("not found", { status: 404 });
      },
    });

    const updateResponse = await api.request(
      "/api/v1/admin/auth-providers/settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          global: {
            providers: [
              {
                providerId: "okta",
                enabled: true,
                oidc: {
                  issuerUrl: "https://tenant.okta.com/oauth2/default",
                  clientId: "okta-web",
                  groupClaim: "groups",
                  adminGroups: ["admins"],
                  groupMap: { engineers: "group_engineering" },
                  workspaceGroupPrefix: "workspace:",
                },
              },
            ],
          },
        }),
      },
    );
    const updated = await updateResponse.json();
    const testResponse = await api.request(
      "/api/v1/admin/auth-providers/settings/test",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ providerId: "okta" }),
      },
    );
    const tested = await testResponse.json();

    expect(updateResponse.status).toBe(200);
    expect(updated.data.global.providers).toContainEqual(
      expect.objectContaining({
        providerId: "okta",
        enabled: true,
        oidc: {
          issuerConfigured: true,
          issuerHost: "tenant.okta.com",
          clientIdConfigured: true,
          groupClaim: "groups",
          adminGroupCount: 1,
          groupMappingCount: 1,
          workspaceGroupMappingCount: 0,
          workspaceGroupPrefixConfigured: true,
        },
      }),
    );
    expect(testResponse.status).toBe(200);
    expect(tested.data).toMatchObject({
      providerId: "okta",
      configurationSource: "provider_settings",
      status: "passed",
      issuerHost: "tenant.okta.com",
    });
    expect(calls).toEqual([
      "https://tenant.okta.com/oauth2/default/.well-known/openid-configuration",
      "https://tenant.okta.com/oauth2/default/v1/keys",
    ]);
    expect(JSON.stringify([updated.data, tested.data])).not.toContain(
      "okta-web",
    );
    expect(JSON.stringify([updated.data, tested.data])).not.toContain(
      "/oauth2/default",
    );
    expect(JSON.stringify([updated.data, tested.data])).not.toContain(
      "/v1/keys",
    );
  });

  it("fails readiness when enabled OIDC provider cards lack connection config", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const updateResponse = await api.request(
      "/api/v1/admin/auth-providers/settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          global: {
            providers: [{ providerId: "okta", enabled: true }],
          },
        }),
      },
    );
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "auth_provider_oidc_config",
    );

    expect(updateResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "fail",
      severity: "critical",
      details: {
        incompleteProviderCount: 1,
        incompleteProviderIds: ["okta"],
      },
    });
    expect(JSON.stringify(check)).not.toContain("okta-web");
    expect(JSON.stringify(check)).not.toContain("issuerUrl");
  });

  it("warns readiness when local auth fallback is deliberately disabled", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const updateResponse = await api.request(
      "/api/v1/admin/auth-providers/settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmDisableLocalFallback: true,
          global: {
            providers: [
              { providerId: "local", enabled: false },
              {
                providerId: "okta",
                enabled: true,
                oidc: {
                  issuerUrl: "https://tenant.okta.com/oauth2/default",
                  clientId: "okta-web",
                },
              },
            ],
          },
        }),
      },
    );
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "auth_provider_local_fallback",
    );

    expect(updateResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "warn",
      severity: "warning",
      details: {
        enabledProviderCount: 1,
        enabledProviderIds: ["okta"],
      },
    });
    expect(JSON.stringify(check)).not.toContain("okta-web");
    expect(JSON.stringify(check)).not.toContain("/oauth2/default");
  });

  it("warns readiness when auth-provider secret refs exist and resolver is disabled", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const updateResponse = await api.request(
      "/api/v1/admin/auth-providers/settings",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          global: {
            providers: [
              {
                providerId: "keycloak",
                enabled: true,
                oidc: {
                  issuerUrl: "https://keycloak.example.com/realms/romeo",
                  clientId: "keycloak-web",
                },
                secretRef: "env://KEYCLOAK_CLIENT_SECRET",
              },
            ],
          },
        }),
      },
    );
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "auth_provider_secret_refs",
    );

    expect(updateResponse.status).toBe(200);
    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "warn",
      severity: "warning",
      details: {
        configuredProviderCount: 1,
        secretRefSchemes: ["env"],
        secretResolverDriver: "disabled",
      },
    });
    expect(JSON.stringify(check)).not.toContain("KEYCLOAK_CLIENT_SECRET");
    expect(JSON.stringify(check)).not.toContain("keycloak-web");
  });

  it("fails readiness when persisted auth-provider secret refs are invalid", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.upsertSystemSetting({
      key: "auth_provider_settings.global.v1",
      value: {
        version: 1,
        providers: {
          local: {
            enabled: true,
            loginOrder: 0,
            allowedEmailDomains: [],
            orgOverridesAllowed: true,
            secretRef: "literal-secret",
          },
        },
      },
      updatedAt: new Date().toISOString(),
    });
    const api = createRomeoApi(repository);
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();
    const check = body.data.checks.find(
      (item: { id: string }) => item.id === "auth_provider_secret_refs",
    );

    expect(response.status).toBe(200);
    expect(check).toMatchObject({
      status: "fail",
      severity: "critical",
      details: {
        invalidProviderCount: 1,
        invalidProviderIds: ["local"],
      },
    });
    expect(JSON.stringify(check)).not.toContain("literal-secret");
  });

  it("fails readiness when fail-closed connector egress has no host allowlist", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: readEnv({
        DATA_CONNECTOR_EXECUTION_DRIVER: "website-fetch",
        DATA_CONNECTOR_EGRESS_POLICY: "require_allowlist",
      }),
    });
    const response = await api.request("/api/v1/admin/readiness");
    const body = await response.json();

    expect(response.status).toBe(200);
    expect(
      body.data.checks.some(
        (check: { id: string; status: string }) =>
          check.id === "connector_egress_policy" && check.status === "fail",
      ),
    ).toBe(true);
  });
});

function writePgvectorIsolationEvidence(input: {
  status: "failed" | "passed" | "planned";
  mode: "dry-run" | "live";
  checks: Record<string, unknown>;
}): string {
  const directory = mkdtempSync(join(tmpdir(), "romeo-pgvector-evidence-"));
  const path = join(directory, "pgvector-isolation.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        schemaVersion: "romeo.pgvector-physical-isolation-review.v1",
        generatedAt: "2026-07-02T00:00:00.000Z",
        status: input.status,
        mode: input.mode,
        target: {
          expectedIsolationMode: "pgvector_partitioned_by_org",
          table: "knowledge_chunk_embeddings",
        },
        checks: input.checks,
      },
      null,
      2,
    ),
    "utf8",
  );
  return path;
}

function writeGaChecklistEvidence(input: Record<string, unknown>): string {
  const directory = mkdtempSync(join(tmpdir(), "romeo-ga-checklist-"));
  const path = join(directory, "ga-checklist.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        schemaVersion: "romeo.ga-checklist.v1",
        generatedAt: "2026-07-07T00:00:00.000Z",
        strict: true,
        ...input,
      },
      null,
      2,
    ),
    "utf8",
  );
  return path;
}

function writeQdrantLiveEvidence(input: {
  status: "failed" | "passed" | "planned";
  mode: "dry-run" | "live";
  namespacePolicy: "knowledge_base" | "none" | "org" | "workspace";
  partitioningPolicy: "knowledge_base" | "none" | "org" | "workspace";
}): string {
  const directory = mkdtempSync(join(tmpdir(), "romeo-qdrant-evidence-"));
  const path = join(directory, "qdrant-live-evidence.json");
  writeFileSync(
    path,
    JSON.stringify(
      {
        schemaVersion: "romeo.qdrant-live-evidence.v1",
        generatedAt: "2026-07-02T00:00:00.000Z",
        status: input.status,
        mode: input.mode,
        target: {
          driver: "qdrant",
          endpointConfigured: true,
          endpointValid: true,
          endpointScheme: "https",
          endpointHostSha256:
            "c17c302e15f4e7b9a6d2d64a3db87f4563cbb14d9b728db7ac4fd516f5b8c3dd",
          collectionConfigured: true,
          collectionSha256:
            "5c71f9989e6806562c0f44a50e430ef291c960f59087710059b9f8892e6c6624",
          credentialConfigured: true,
          unauthenticatedAllowed: false,
          namespacePolicy: input.namespacePolicy,
          partitioningPolicy: input.partitioningPolicy,
          dimensions: 8,
          timeoutMs: 15000,
        },
        collection: {
          status: "green",
          optimizerStatus: "ok",
          pointsCount: 10,
          vectorsCount: 10,
          indexedVectorsCount: 10,
          segmentsCount: 1,
        },
        mutation: {
          requiresConfirmMutation: true,
          confirmed: true,
          insertedPointCount: 4,
          cleanupAttempted: true,
        },
        isolation: {
          scopedQueryResultCount: 1,
          expectedHitReturned: true,
          namespaceTrapExcluded: true,
          partitionTrapExcluded: true,
          foreignOrgTrapExcluded: true,
          vectorsReturned: false,
          payloadReturned: true,
          filter: {
            orgFilterApplied: true,
            workspaceFilterApplied: true,
            knowledgeBaseFilterApplied: true,
            sourceFilterApplied: true,
            providerModelDimensionFilterApplied: true,
            namespaceFilterApplied: input.namespacePolicy !== "none",
            partitionFilterApplied: input.partitioningPolicy !== "none",
          },
        },
        deletion: {
          scopedDeleteIssued: true,
          postDeleteResultCount: 0,
          expectedHitRemoved: true,
          cleanupByPointIdAttempted: true,
        },
        redaction: {
          endpointReturned: false,
          collectionReturned: false,
          apiKeyReturned: false,
          evidenceFileBodyReturned: false,
          rawEvidencePathReturned: false,
          namespaceValuesReturned: false,
          partitionValuesReturned: false,
          payloadValuesReturned: false,
          pointIdsReturned: false,
          vectorValuesReturned: false,
        },
      },
      null,
      2,
    ),
    "utf8",
  );
  return path;
}

class DurableTestRepository extends InMemoryRomeoRepository {
  override readonly runtime = {
    driver: "postgres",
    durable: true,
    storageScope: "database",
    description: "Test double for a Postgres-backed repository.",
  } as const;
}
