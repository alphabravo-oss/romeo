import { describe, expect, it } from "vitest";

import type { RomeoRepository } from "../domain/repository";
import type { RepositoryRequestScope } from "../domain/repository-request-scope";
import {
  InMemoryRomeoRepository,
  createRuntimeSeedData,
} from "../repositories/in-memory";
import { testEnv } from "../test-support/env";
import { createServices } from ".";
import { WorkerBrokerService } from "./worker-broker";

const toolSecret = "tool-dispatch-broker-".repeat(3);
const browserSecret = "browser-automation-broker-".repeat(3);
const knowledgeSecret = "knowledge-extraction-broker-".repeat(3);

describe("WorkerBrokerService", () => {
  it("claims fairly across two tenants and skips a suspended tenant", async () => {
    const repository = await repositoryWithKnowledgeTenants();
    const broker = brokerFor(repository);

    const first = await broker.claim({
      audience: "knowledge_extraction",
      authorization: `Bearer ${knowledgeSecret}`,
      leaseSeconds: 60,
      workerId: "knowledge-worker-a",
    });
    const second = await broker.claim({
      audience: "knowledge_extraction",
      authorization: `Bearer ${knowledgeSecret}`,
      leaseSeconds: 60,
      workerId: "knowledge-worker-b",
    });

    expect(sourceId(first.claim)).toBe("source_a");
    expect(sourceId(second.claim)).toBe("source_b");

    await repository.upsertSystemSetting(
      {
        key: "abuse_controls.org.v1:org_c",
        orgId: "org_c",
        updatedAt: "2029-01-01T00:00:00.000Z",
        value: { suspension: { suspended: true } },
      },
      "org_c",
    );
    const third = await broker.claim({
      audience: "knowledge_extraction",
      authorization: `Bearer ${knowledgeSecret}`,
      leaseSeconds: 60,
      workerId: "knowledge-worker-c",
    });
    expect(third.claimed).toBe(false);
  });

  it("denies cross-audience credentials and claim tokens", async () => {
    const repository = await repositoryWithKnowledgeTenants();
    const broker = brokerFor(repository);
    await expect(
      broker.claim({
        audience: "knowledge_extraction",
        authorization: `Bearer ${toolSecret}`,
        leaseSeconds: 60,
        workerId: "knowledge-worker-a",
      }),
    ).rejects.toMatchObject({
      code: "worker_broker_authentication_failed",
      status: 401,
    });
    const claim = await broker.claim({
      audience: "knowledge_extraction",
      authorization: `Bearer ${knowledgeSecret}`,
      leaseSeconds: 60,
      workerId: "knowledge-worker-a",
    });
    await expect(
      broker.renew({
        audience: "browser_automation",
        authorization: `Bearer ${browserSecret}`,
        claimToken: claim.claimToken!,
        leaseSeconds: 60,
        workerId: "knowledge-worker-a",
      }),
    ).rejects.toMatchObject({
      code: "worker_broker_claim_invalid",
      status: 401,
    });
  });

  it("renews only the current fenced claim and rejects stale completion", async () => {
    const repository = await repositoryWithKnowledgeTenants();
    let current = new Date("2029-01-01T00:00:00.000Z");
    const broker = brokerFor(repository, () => current);
    const claim = await broker.claim({
      audience: "knowledge_extraction",
      authorization: `Bearer ${knowledgeSecret}`,
      leaseSeconds: 30,
      workerId: "knowledge-worker-a",
    });
    current = new Date("2029-01-01T00:00:10.000Z");
    const renewed = await broker.renew({
      audience: "knowledge_extraction",
      authorization: `Bearer ${knowledgeSecret}`,
      claimToken: claim.claimToken!,
      leaseSeconds: 60,
      workerId: "knowledge-worker-a",
    });
    expect(renewed.claimed).toBe(true);
    await expect(
      broker.complete({
        audience: "knowledge_extraction",
        authorization: `Bearer ${knowledgeSecret}`,
        claimToken: renewed.claimToken!,
        success: false,
        workerId: "spoofed-worker",
      }),
    ).rejects.toMatchObject({ code: "worker_broker_claim_scope_mismatch" });

    await expect(
      broker.complete({
        audience: "knowledge_extraction",
        authorization: `Bearer ${knowledgeSecret}`,
        claimToken: renewed.claimToken!,
        errorCode: "extractor_failed",
        success: false,
        workerId: "knowledge-worker-a",
      }),
    ).resolves.toMatchObject({ outcome: "failed" });

    current = new Date("2029-01-01T00:01:11.000Z");
    await expect(
      broker.complete({
        audience: "knowledge_extraction",
        authorization: `Bearer ${knowledgeSecret}`,
        claimToken: renewed.claimToken!,
        success: false,
        workerId: "knowledge-worker-a",
      }),
    ).rejects.toMatchObject({ code: "worker_broker_claim_expired" });
  });
});

function brokerFor(
  repository: RomeoRepository,
  now: () => Date = () => new Date("2029-01-01T00:00:00.000Z"),
) {
  return new WorkerBrokerService(
    passthroughScope(repository),
    (scopedRepository) => createServices(scopedRepository, { env: testEnv() }),
    {
      credentials: {
        browser_automation: { current: browserSecret },
        knowledge_extraction: { current: knowledgeSecret },
        tool_dispatch: { current: toolSecret },
      },
      now,
    },
  );
}

function passthroughScope(repository: RomeoRepository): RepositoryRequestScope {
  return {
    runAsSystem: (work) => work(repository),
    runAsTenant: (_orgId, work) => work(repository),
  };
}

async function repositoryWithKnowledgeTenants(): Promise<RomeoRepository> {
  const repository = new InMemoryRomeoRepository(createRuntimeSeedData());
  await addTenant(repository, "org_a", "source_a", false);
  await addTenant(repository, "org_b", "source_b", false);
  await addTenant(repository, "org_c", "source_c", true);
  return repository;
}

async function addTenant(
  repository: RomeoRepository,
  orgId: string,
  sourceId: string,
  suspended: boolean,
): Promise<void> {
  await repository.createOrganization({ id: orgId, name: orgId, slug: orgId });
  const workspaceId = `workspace_${orgId}`;
  const knowledgeBaseId = `kb_${orgId}`;
  await repository.createWorkspace({
    id: workspaceId,
    name: orgId,
    orgId,
    slug: orgId,
  });
  await repository.createKnowledgeBase({
    createdAt: "2029-01-01T00:00:00.000Z",
    createdBy: "test",
    id: knowledgeBaseId,
    name: orgId,
    orgId,
    updatedAt: "2029-01-01T00:00:00.000Z",
    workspaceId,
  });
  await repository.createKnowledgeSource({
    createdAt: "2029-01-01T00:00:00.000Z",
    fileName: `${sourceId}.pdf`,
    id: sourceId,
    knowledgeBaseId,
    metadata: {},
    mimeType: "application/pdf",
    objectKey: `knowledge/${orgId}/${sourceId}`,
    orgId,
    sizeBytes: 100,
    status: "pending",
    updatedAt: "2029-01-01T00:00:00.000Z",
    workspaceId,
  });
  if (suspended)
    await repository.upsertSystemSetting(
      {
        key: `abuse_controls.org.v1:${orgId}`,
        orgId,
        updatedAt: "2029-01-01T00:00:00.000Z",
        value: { suspension: { suspended: true } },
      },
      orgId,
    );
}

function sourceId(claim: unknown): string | undefined {
  if (typeof claim !== "object" || claim === null) return undefined;
  const source = (claim as { source?: unknown }).source;
  if (typeof source !== "object" || source === null) return undefined;
  const id = (source as { id?: unknown }).id;
  return typeof id === "string" ? id : undefined;
}
