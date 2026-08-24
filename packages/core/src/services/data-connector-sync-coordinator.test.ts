import type { AuthSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import type { DataConnector, DataConnectorSync } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import type { RepositoryRequestScope } from "../domain/repository-request-scope";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { DataConnectorSyncCoordinator } from "./data-connector-sync-coordinator";

const now = "2026-08-23T12:00:00.000Z";

describe("DataConnectorSyncCoordinator", () => {
  it("uses fair durable tenant rotation with bounded concurrency and connector attempts", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedTenants(repository, ["org_a", "org_b", "org_c"]);
    const activeByOrg = new Map<string, number>();
    let peak = 0;
    const processed: string[] = [];
    const factory = (scoped: RomeoRepository) => ({
      syncNextDue: async (input: {
        now?: string;
        subject: AuthSubject;
        workerId: string;
      }) => {
        const orgId = input.subject.orgId;
        const active = (activeByOrg.get(orgId) ?? 0) + 1;
        activeByOrg.set(orgId, active);
        peak = Math.max(
          peak,
          Array.from(activeByOrg.values()).reduce(
            (sum, value) => sum + value,
            0,
          ),
        );
        await new Promise((resolve) => setTimeout(resolve, 2));
        try {
          const sync = await completeNextDue(
            scoped,
            orgId,
            input.workerId,
            input.now ?? now,
          );
          if (sync !== undefined) processed.push(sync.connectorId);
          return sync;
        } finally {
          activeByOrg.set(orgId, active - 1);
        }
      },
    });
    const first = new DataConnectorSyncCoordinator(
      inMemoryScope(repository),
      factory,
      {
        enabled: true,
        maxConnectorsPerTenant: 1,
        maxTenantsPerRun: 2,
        tenantConcurrency: 2,
        workerId: "worker_first",
      },
    );

    const firstReport = await first.runOnce(now);
    expect(firstReport).toMatchObject({ attempted: 2, completed: 2 });
    expect(peak).toBeLessThanOrEqual(2);
    expect(processed).toHaveLength(2);

    const second = new DataConnectorSyncCoordinator(
      inMemoryScope(repository),
      factory,
      {
        enabled: true,
        maxConnectorsPerTenant: 1,
        maxTenantsPerRun: 2,
        tenantConcurrency: 2,
        workerId: "worker_restart",
      },
    );
    const secondReport = await second.runOnce(now);
    expect(secondReport.completed).toBeGreaterThanOrEqual(1);
    expect(new Set(processed)).toEqual(
      new Set(["connector_org_a", "connector_org_b", "connector_org_c"]),
    );
  });

  it("isolates a failed connector and tenant while continuing later due work", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedTenants(repository, ["org_a", "org_b"]);
    await repository.createDataConnector(connector("org_a", "second"));
    const processed: string[] = [];
    let injected = false;
    const coordinator = new DataConnectorSyncCoordinator(
      inMemoryScope(repository),
      (scoped) => ({
        syncNextDue: async (input) => {
          const claimed = await scoped.claimDataConnectorSync({
            leaseExpiresAt: "2026-08-23T12:05:00.000Z",
            leaseOwner: input.workerId,
            leaseToken: `lease_${input.subject.orgId}_${processed.length}`,
            now,
            orgId: input.subject.orgId,
          });
          if (claimed === undefined) return undefined;
          if (!injected && input.subject.orgId === "org_a") {
            injected = true;
            throw new Error("injected_connector_failure");
          }
          processed.push(claimed.id);
          return finishClaim(scoped, claimed, input.workerId, now);
        },
      }),
      {
        enabled: true,
        maxConnectorsPerTenant: 2,
        maxTenantsPerRun: 10,
        tenantConcurrency: 2,
        workerId: "worker_partial_failure",
      },
    );

    const report = await coordinator.runOnce(now);

    expect(report.failed).toBe(1);
    expect(report.completed).toBe(2);
    expect(processed).toEqual(
      expect.arrayContaining(["connector_org_a_second", "connector_org_b"]),
    );
    expect(report.attempted).toBeLessThanOrEqual(4);
  });

  it("takes over an expired lease after restart and never auto-claims local imports", async () => {
    const repository = new InMemoryRomeoRepository();
    await seedTenants(repository, ["org_a"]);
    await repository.createDataConnector({
      ...connector("org_a", "local"),
      type: "local_import",
    });
    const first = await repository.claimDataConnectorSync({
      connectorId: "connector_org_a",
      leaseExpiresAt: "2026-08-23T12:04:59.000Z",
      leaseOwner: "crashed_worker",
      leaseToken: "crashed_lease",
      now: "2026-08-23T11:59:00.000Z",
      orgId: "org_a",
    });
    expect(first?.syncLease?.fencingToken).toBe(1);
    const claimed: DataConnector[] = [];
    const restarted = new DataConnectorSyncCoordinator(
      inMemoryScope(repository),
      (scoped) => ({
        syncNextDue: async (input) => {
          const connector = await scoped.claimDataConnectorSync({
            leaseExpiresAt: "2026-08-23T12:10:00.000Z",
            leaseOwner: input.workerId,
            leaseToken: "restart_lease",
            now: "2026-08-23T12:05:00.000Z",
            orgId: input.subject.orgId,
          });
          if (connector === undefined) return undefined;
          claimed.push(connector);
          return finishClaim(
            scoped,
            connector,
            input.workerId,
            "2026-08-23T12:05:00.000Z",
          );
        },
      }),
      {
        enabled: true,
        maxConnectorsPerTenant: 2,
        maxTenantsPerRun: 10,
        workerId: "restarted_worker",
      },
    );

    await restarted.runOnce("2026-08-23T12:05:00.000Z");

    expect(claimed).toHaveLength(1);
    expect(claimed[0]).toMatchObject({
      id: "connector_org_a",
      syncLease: { fencingToken: 2, owner: "restarted_worker" },
    });
  });
});

function inMemoryScope(repository: RomeoRepository): RepositoryRequestScope {
  return {
    runAsSystem: (work) => repository.transaction(work),
    runAsTenant: (_orgId, work) => repository.transaction(work),
  };
}

async function seedTenants(
  repository: RomeoRepository,
  orgIds: string[],
): Promise<void> {
  for (const orgId of orgIds) {
    await repository.createOrganization({
      id: orgId,
      name: orgId,
      slug: orgId,
    });
    await repository.createWorkspace({
      id: `workspace_${orgId}`,
      orgId,
      name: orgId,
      slug: orgId,
    });
    await repository.createDataConnector(connector(orgId));
  }
}

function connector(orgId: string, suffix?: string): DataConnector {
  const id = `connector_${orgId}${suffix === undefined ? "" : `_${suffix}`}`;
  return {
    id,
    orgId,
    workspaceId: `workspace_${orgId}`,
    knowledgeBaseId: `kb_${orgId}`,
    type: "rss",
    name: id,
    config: {},
    status: "active",
    syncIntervalMinutes: 30,
    nextSyncAt: now,
    createdBy: `user_${orgId}`,
    createdAt: now,
    updatedAt: now,
  };
}

async function completeNextDue(
  repository: RomeoRepository,
  orgId: string,
  workerId: string,
  at: string,
): Promise<DataConnectorSync | undefined> {
  const claimed = await repository.claimDataConnectorSync({
    leaseExpiresAt: "2026-08-23T12:05:00.000Z",
    leaseOwner: workerId,
    leaseToken: `lease_${orgId}`,
    now: at,
    orgId,
  });
  return claimed === undefined
    ? undefined
    : finishClaim(repository, claimed, workerId, at);
}

async function finishClaim(
  repository: RomeoRepository,
  connector: DataConnector,
  workerId: string,
  at: string,
): Promise<DataConnectorSync> {
  const lease = connector.syncLease!;
  const sync: DataConnectorSync = {
    id: `sync_${connector.id}_${lease.fencingToken}`,
    orgId: connector.orgId,
    workspaceId: connector.workspaceId,
    knowledgeBaseId: connector.knowledgeBaseId,
    connectorId: connector.id,
    status: "running",
    createdBy: `user_${connector.orgId}`,
    itemCount: 0,
    sourceIds: [],
    summary: {},
    startedAt: at,
    fencingToken: lease.fencingToken,
    leaseToken: lease.token,
  };
  await repository.createDataConnectorSync(sync);
  return (await repository.finishDataConnectorSync({
    connector: {
      ...connector,
      nextSyncAt: "2026-08-23T12:30:00.000Z",
    },
    sync: { ...sync, status: "completed", completedAt: at },
    fencingToken: lease.fencingToken,
    leaseOwner: workerId,
    leaseToken: lease.token,
    now: at,
  }))!;
}
