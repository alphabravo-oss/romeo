import {
  ROMEO_REPOSITORY_METHOD_NAMES,
  InMemoryRomeoRepository,
  createServices,
  createRomeoApi,
  type RomeoServices,
  type RomeoRepository,
} from "@romeo/core";
import { readEnv } from "@romeo/config";
import { MemoryObjectStore } from "@romeo/storage";
import { describe, expect, it } from "vitest";

import {
  assertRepositoryMethods,
  createPostgresRomeoRepositoryFromDatabase,
} from "./romeo-repository";
import {
  createLivePostgresRepositoryFixture,
  POSTGRES_CONFORMANCE_DATABASE_URL_ENV,
  postgresConformanceDatabaseUrl,
} from "./test-support/postgres-conformance-harness";

interface RepositoryFixture {
  repository: RomeoRepository;
  close?: () => Promise<void>;
}

interface RepositorySubject {
  name: string;
  create: () => Promise<RepositoryFixture>;
}

const livePostgresUrl = postgresConformanceDatabaseUrl();
const subjects: RepositorySubject[] = [
  {
    name: "in-memory",
    create: async () => ({ repository: new InMemoryRomeoRepository() }),
  },
  ...(livePostgresUrl === undefined
    ? []
    : [
        {
          name: "postgres",
          create: () => createLivePostgresRepositoryFixture(livePostgresUrl),
        },
      ]),
];

describe("Postgres RomeoRepository factory", () => {
  it("exposes durable runtime metadata and every repository method", () => {
    const repository = createPostgresRomeoRepositoryFromDatabase({} as never);

    expect(repository.runtime).toMatchObject({
      driver: "postgres",
      durable: true,
      storageScope: "database",
    });
    for (const method of ROMEO_REPOSITORY_METHOD_NAMES) {
      expect(typeof repository[method]).toBe("function");
    }
    expect(() => assertRepositoryMethods(repository)).not.toThrow();
  });

  it("fails fast when a composed repository is missing a contract method", () => {
    const repository = createPostgresRomeoRepositoryFromDatabase({} as never);
    delete (repository as Partial<RomeoRepository>).listUsers;

    expect(() => assertRepositoryMethods(repository)).toThrow(
      "Postgres repository is missing method: listUsers",
    );
  });
});

describe("RomeoRepository conformance", () => {
  if (livePostgresUrl === undefined) {
    it.skip(`runs live Postgres conformance when ${POSTGRES_CONFORMANCE_DATABASE_URL_ENV} is set`, () =>
      undefined);
  }

  for (const subject of subjects) {
    describe(`${subject.name}`, () => {
      it("rolls back failed repository transactions", async () => {
        await withRepository(subject, async (repository) => {
          await expect(
            repository.transaction(async (transactionalRepository) => {
              await transactionalRepository.createUser({
                id: "user_transaction_rollback",
                orgId: "org_default",
                email: "rollback@example.com",
                name: "Rollback User",
              });
              throw new Error("injected transaction rollback");
            }),
          ).rejects.toThrow("injected transaction rollback");
          expect(
            await repository.getCurrentUser("user_transaction_rollback"),
          ).toBeUndefined();
        });
      });

      it("allows only one concurrent live queue lease per chat", async () => {
        await withRepository(subject, async (repository) => {
          await repository.createQueuedChatTurn({
            id: "queued_turn_concurrency_1",
            orgId: "org_default",
            workspaceId: "workspace_default",
            chatId: "chat_welcome",
            agentId: "agent_default",
            content: "First concurrent prompt",
            createdBy: "user_dev_admin",
            principalId: "user_dev_admin",
            principalType: "user",
            scopeSnapshot: ["chats:write" as const, "runs:create" as const],
            idempotencyKey: "concurrency_1",
            status: "queued",
            attemptCount: 0,
            createdAt: "2026-07-16T12:00:00.000Z",
            updatedAt: "2026-07-16T12:00:00.000Z",
          });
          await repository.createQueuedChatTurn({
            id: "queued_turn_concurrency_2",
            orgId: "org_default",
            workspaceId: "workspace_default",
            chatId: "chat_welcome",
            agentId: "agent_default",
            content: "Second concurrent prompt",
            createdBy: "user_dev_admin",
            principalId: "user_dev_admin",
            principalType: "user",
            scopeSnapshot: ["chats:write", "runs:create"],
            idempotencyKey: "concurrency_2",
            status: "queued",
            attemptCount: 0,
            createdAt: "2026-07-16T12:00:01.000Z",
            updatedAt: "2026-07-16T12:00:01.000Z",
          });

          const claims = await Promise.all([
            repository.claimNextQueuedChatTurn({
              chatId: "chat_welcome",
              leaseOwner: "worker_1",
              leaseToken: "lease_1",
              now: "2026-07-16T12:01:00.000Z",
              leaseExpiresAt: "2026-07-16T12:02:00.000Z",
            }),
            repository.claimNextQueuedChatTurn({
              chatId: "chat_welcome",
              leaseOwner: "worker_2",
              leaseToken: "lease_2",
              now: "2026-07-16T12:01:00.000Z",
              leaseExpiresAt: "2026-07-16T12:02:00.000Z",
            }),
          ]);

          expect(claims.filter((claim) => claim !== undefined)).toHaveLength(1);
          expect(claims.find((claim) => claim !== undefined)?.id).toBe(
            "queued_turn_concurrency_1",
          );
        });
      });

      it("preserves queued-turn lookup, update, lease, finish, and cancellation semantics", async () => {
        await withRepository(subject, async (repository) => {
          const baseTurn = {
            id: "queued_turn_lifecycle",
            orgId: "org_default",
            workspaceId: "workspace_default",
            chatId: "chat_welcome",
            agentId: "agent_default",
            content: "Lifecycle prompt",
            createdBy: "user_dev_admin",
            principalId: "user_dev_admin",
            principalType: "user" as const,
            scopeSnapshot: ["chats:write" as const, "runs:create" as const],
            idempotencyKey: "queue_lifecycle",
            status: "queued" as const,
            attemptCount: 0,
            createdAt: "2026-07-16T13:00:00.000Z",
            updatedAt: "2026-07-16T13:00:00.000Z",
          };
          await repository.createQueuedChatTurn(baseTurn);
          expect(
            (await repository.listQueuedChatTurns(baseTurn.chatId)).map(
              (turn) => turn.id,
            ),
          ).toContain(baseTurn.id);
          expect(await repository.getQueuedChatTurn(baseTurn.id)).toEqual(
            baseTurn,
          );
          expect(
            await repository.getQueuedChatTurnByIdempotency(
              baseTurn.orgId,
              baseTurn.chatId,
              baseTurn.idempotencyKey,
            ),
          ).toEqual(baseTurn);
          expect(
            await repository.updateQueuedChatTurn({
              ...baseTurn,
              content: "Updated lifecycle prompt",
              updatedAt: "2026-07-16T13:00:01.000Z",
            }),
          ).toMatchObject({ content: "Updated lifecycle prompt" });

          const claimed = await repository.claimNextQueuedChatTurn({
            chatId: baseTurn.chatId,
            leaseOwner: "queue_worker",
            leaseToken: "queue_lease",
            now: "2026-07-16T13:01:00.000Z",
            leaseExpiresAt: "2026-07-16T13:02:00.000Z",
          });
          expect(claimed).toMatchObject({
            id: baseTurn.id,
            leaseOwner: "queue_worker",
            leaseToken: "queue_lease",
            status: "leased",
          });
          expect(
            await repository.renewQueuedChatTurnLease({
              turnId: baseTurn.id,
              leaseOwner: "queue_worker",
              leaseToken: "queue_lease",
              now: "2026-07-16T13:01:30.000Z",
              leaseExpiresAt: "2026-07-16T13:03:00.000Z",
            }),
          ).toMatchObject({ leaseExpiresAt: "2026-07-16T13:03:00.000Z" });
          expect(
            await repository.finishQueuedChatTurnLease({
              turnId: baseTurn.id,
              leaseOwner: "queue_worker",
              leaseToken: "queue_lease",
              status: "completed",
              now: "2026-07-16T13:02:00.000Z",
            }),
          ).toMatchObject({ status: "completed" });

          const cancelledTurn = await repository.createQueuedChatTurn({
            ...baseTurn,
            id: "queued_turn_cancelled",
            idempotencyKey: "queue_cancelled",
            createdAt: "2026-07-16T13:03:00.000Z",
            updatedAt: "2026-07-16T13:03:00.000Z",
          });
          expect(
            await repository.cancelQueuedChatTurn({
              turnId: cancelledTurn.id,
              chatId: cancelledTurn.chatId,
              now: "2026-07-16T13:04:00.000Z",
            }),
          ).toMatchObject({ status: "cancelled" });
        });
      });

      it("allows only one concurrent run-execution job lease", async () => {
        await withRepository(subject, async (repository) => {
          await repository.createBackgroundJob({
            id: "job_run_execution_concurrency",
            orgId: "org_default",
            workspaceId: "workspace_default",
            type: "run.execution:run_concurrency",
            status: "queued",
            payload: { runId: "run_concurrency" },
            createdAt: "2026-07-16T12:00:00.000Z",
            updatedAt: "2026-07-16T12:00:00.000Z",
          });

          const claims = await Promise.all([
            repository.claimBackgroundJob({
              orgId: "org_default",
              type: "run.execution:run_concurrency",
              workerId: "run_worker_1",
              leaseSeconds: 60,
              now: "2026-07-16T12:01:00.000Z",
            }),
            repository.claimBackgroundJob({
              orgId: "org_default",
              type: "run.execution:run_concurrency",
              workerId: "run_worker_2",
              leaseSeconds: 60,
              now: "2026-07-16T12:01:00.000Z",
            }),
          ]);

          expect(claims.filter((claim) => claim !== undefined)).toHaveLength(1);
          expect(claims.find((claim) => claim !== undefined)).toMatchObject({
            id: "job_run_execution_concurrency",
            status: "running",
          });
        });
      });

      it("isolates queued payloads, runs, files, search, shares, memories, and web sources by tenant", async () => {
        await withRepository(subject, async (repository) => {
          type ServiceSubject = Parameters<RomeoServices["files"]["get"]>[0];
          const tenantA: ServiceSubject = {
            id: "user_dev_admin",
            type: "user",
            orgId: "org_default",
            workspaceIds: ["workspace_default"],
            groupIds: ["group_admins"],
            scopes: ["chats:read", "files:read", "files:write", "runs:read"],
            isAdmin: true,
            adminRole: "global_admin",
          };
          const tenantB: ServiceSubject = {
            id: "user_tenant_isolation_b",
            type: "user",
            orgId: "org_tenant_isolation_b",
            workspaceIds: ["workspace_tenant_isolation_b"],
            groupIds: [],
            scopes: ["chats:read", "files:read", "runs:read"],
            isAdmin: false,
          };
          const sentinels = {
            file: "PG_TENANT_A_FILE_SECRET_7391",
            memory: "PG_TENANT_A_MEMORY_SECRET_4207",
            queue: "PG_TENANT_A_QUEUE_SECRET_8813",
            run: "PG_TENANT_A_RUN_SECRET_1649",
            search: "PG_TENANT_A_SEARCH_SECRET_5521",
            share: "PG_TENANT_A_SHARE_SECRET_9064",
            webSource: "PG_TENANT_A_WEB_SOURCE_SECRET_3178",
          } as const;
          const now = new Date().toISOString();
          const objectStore = new MemoryObjectStore();
          const services = createServices(repository, { objectStore });
          const runtime = await seedRuntimeGraph(
            repository,
            "tenant_isolation",
          );

          await repository.createOrganization({
            id: tenantB.orgId,
            name: "Tenant isolation B",
            slug: "tenant-isolation-b",
          });
          await repository.createWorkspace({
            id: tenantB.workspaceIds[0]!,
            orgId: tenantB.orgId,
            name: "Tenant isolation B workspace",
            slug: "tenant-isolation-b",
          });
          await repository.createUser({
            id: tenantB.id,
            orgId: tenantB.orgId,
            email: "tenant-isolation-b@romeo.local",
            name: "Tenant isolation B user",
          });
          await repository.createMessage({
            id: "message_tenant_isolation_search",
            chatId: "chat_welcome",
            role: "user",
            content: sentinels.search,
            createdAt: now,
          });
          await repository.createQueuedChatTurn({
            id: "queued_turn_tenant_isolation",
            orgId: tenantA.orgId,
            workspaceId: "workspace_default",
            chatId: "chat_welcome",
            agentId: runtime.agentId,
            content: sentinels.queue,
            createdBy: tenantA.id,
            principalId: tenantA.id,
            principalType: tenantA.type,
            scopeSnapshot: ["chats:write", "runs:create"],
            idempotencyKey: "postgres-tenant-isolation",
            status: "queued",
            attemptCount: 0,
            createdAt: now,
            updatedAt: now,
          });
          await repository.createRun({
            id: sentinels.run,
            orgId: tenantA.orgId,
            workspaceId: "workspace_default",
            chatId: "chat_welcome",
            agentId: runtime.agentId,
            agentVersionId: runtime.agentVersionId,
            modelId: runtime.modelId,
            providerId: runtime.providerId,
            status: "completed",
            createdBy: tenantA.id,
            createdAt: now,
            completedAt: now,
          });

          const privateFile = await services.files.create(tenantA, {
            workspaceId: "workspace_default",
            fileName: `${sentinels.file}.txt`,
            mimeType: "text/plain",
            sizeBytes: sentinels.file.length,
            dataBase64: Buffer.from(sentinels.file).toString("base64"),
            purpose: "general",
          });
          const memory = await services.workspaceContent.create(
            tenantA,
            "memory",
            {
              workspaceId: "workspace_default",
              scope: "workspace",
              title: sentinels.memory,
              body: sentinels.memory,
            },
          );
          const webSource = await services.files.create(tenantA, {
            workspaceId: "workspace_default",
            fileName: `${sentinels.webSource}.html`,
            mimeType: "text/html",
            sizeBytes: sentinels.webSource.length,
            dataBase64: Buffer.from(sentinels.webSource).toString("base64"),
            purpose: "web_source",
            metadata: { sourceUrl: "https://tenant-a.invalid/private" },
          });
          await repository.createResourceGrant({
            id: "grant_tenant_isolation_share",
            resourceType: "chat",
            resourceId: "chat_welcome",
            principalType: "group",
            principalId: sentinels.share,
            permission: "read",
          });

          const rejected: unknown[] = [];
          for (const operation of [
            () => services.runs.queuedForChat("chat_welcome", tenantB),
            () => services.runs.get(sentinels.run, tenantB),
            () => services.files.get(tenantB, privateFile.id),
            () => services.files.get(tenantB, webSource.id),
            () =>
              services.chats.search({
                workspaceId: "workspace_default",
                query: sentinels.search,
                subject: tenantB,
              }),
            () =>
              services.collaboration.listChatShares(tenantB, "chat_welcome"),
            () =>
              services.workspaceContent.list(
                tenantB,
                "memory",
                "workspace_default",
              ),
          ]) {
            try {
              await operation();
              throw new Error("Expected cross-tenant operation to fail.");
            } catch (error) {
              rejected.push(error);
              expect(error).toMatchObject({
                code: expect.stringMatching(/forbidden|not_found/),
              });
            }
          }

          const [tenantBChats, tenantBFiles, tenantBMemories] =
            await Promise.all([
              services.chats.search({
                workspaceId: tenantB.workspaceIds[0]!,
                query: "PG_TENANT_A_",
                subject: tenantB,
              }),
              services.files.listPage(tenantB, {
                workspaceId: tenantB.workspaceIds[0]!,
                query: "PG_TENANT_A_",
                limit: 100,
                offset: 0,
              }),
              services.workspaceContent.list(
                tenantB,
                "memory",
                tenantB.workspaceIds[0]!,
              ),
            ]);
          expect(tenantBChats).toEqual([]);
          expect(tenantBFiles).toMatchObject({ items: [], total: 0 });
          expect(tenantBMemories).toEqual([]);
          expect(memory.body).toBe(sentinels.memory);
          await expect(
            services.collaboration.listChatShares(tenantA, "chat_welcome"),
          ).resolves.toContainEqual(
            expect.objectContaining({ principalId: sentinels.share }),
          );

          const tenantBVisibleOutput = JSON.stringify({
            rejected: rejected.map((error) =>
              error instanceof Error ? error.message : String(error),
            ),
            tenantBChats,
            tenantBFiles,
            tenantBMemories,
          });
          for (const sentinel of Object.values(sentinels)) {
            expect(tenantBVisibleOutput).not.toContain(sentinel);
          }
        });
      });

      it("preserves tenancy and identity ordering, upserts, and deletes", async () => {
        await withRepository(subject, async (repository) => {
          expect(await repository.listOrganizations("org_default")).toEqual([
            {
              id: "org_default",
              name: "Romeo Local",
              slug: "romeo-local",
            },
          ]);
          expect(await repository.getOrganization("org_default")).toEqual({
            id: "org_default",
            name: "Romeo Local",
            slug: "romeo-local",
          });
          expect(
            (await repository.listAllOrganizations()).map(
              (organization) => organization.id,
            ),
          ).toContain("org_default");
          expect(
            await repository.createOrganization({
              id: "org_acme",
              name: "Acme Inc",
              slug: "acme",
            }),
          ).toEqual({
            id: "org_acme",
            name: "Acme Inc",
            slug: "acme",
          });
          expect(
            await repository.updateOrganization({
              id: "org_acme",
              name: "Acme",
              slug: "acme-updated",
            }),
          ).toEqual({
            id: "org_acme",
            name: "Acme",
            slug: "acme-updated",
          });
          expect(await repository.listWorkspaces("org_default")).toEqual([
            {
              id: "workspace_default",
              orgId: "org_default",
              name: "Default",
              slug: "default",
            },
          ]);
          expect(await repository.getWorkspace("workspace_default")).toEqual({
            id: "workspace_default",
            orgId: "org_default",
            name: "Default",
            slug: "default",
          });
          expect(
            await repository.createWorkspace({
              id: "workspace_analytics",
              orgId: "org_default",
              name: "Analytics",
              slug: "analytics",
            }),
          ).toEqual({
            id: "workspace_analytics",
            orgId: "org_default",
            name: "Analytics",
            slug: "analytics",
          });
          expect(
            await repository.updateWorkspace({
              id: "workspace_default",
              orgId: "org_default",
              name: "Default Renamed",
              slug: "default-renamed",
            }),
          ).toMatchObject({
            id: "workspace_default",
            name: "Default Renamed",
            slug: "default-renamed",
          });

          await repository.createUser({
            id: "user_zed",
            orgId: "org_default",
            email: "zed@example.com",
            name: "Zed User",
          });
          await repository.createUser({
            id: "user_ada",
            orgId: "org_default",
            email: "ada@example.com",
            name: "Ada User",
          });
          expect(
            (await repository.listUsers("org_default")).map((user) => user.id),
          ).toEqual(["user_ada", "user_dev_admin", "user_zed"]);

          const disabledAt = "2026-06-30T10:00:00.000Z";
          await repository.updateUser({
            id: "user_zed",
            orgId: "org_default",
            email: "zed@example.com",
            name: "Zed Disabled",
            disabledAt,
          });
          expect(await repository.getCurrentUser("user_zed")).toMatchObject({
            disabledAt,
            name: "Zed Disabled",
          });

          const group = await repository.createGroup({
            id: "group_ops",
            orgId: "org_default",
            name: "Operators",
            slug: "operators",
            createdAt: "2026-06-30T10:01:00.000Z",
          });
          const duplicate = await repository.createGroup({
            id: "group_ops_duplicate",
            orgId: "org_default",
            name: "Operators Duplicate",
            slug: "operators",
            createdAt: "2026-06-30T10:02:00.000Z",
          });
          expect(duplicate.id).toBe(group.id);
          expect(await repository.getGroup(group.id)).toEqual(group);
          await expect(
            repository.updateGroup({
              ...group,
              name: "Operations",
              slug: "operations",
            }),
          ).resolves.toMatchObject({
            id: group.id,
            name: "Operations",
            slug: "operations",
          });
          expect(
            (await repository.listGroups("org_default")).map((item) => item.id),
          ).toContain(group.id);

          const membership = {
            groupId: group.id,
            orgId: "org_default",
            userId: "user_ada",
            createdAt: "2026-06-30T10:03:00.000Z",
          };
          expect(
            await repository.createGroupMembership(membership),
          ).toMatchObject(membership);
          expect(
            await repository.createGroupMembership(membership),
          ).toMatchObject(membership);
          expect(
            await repository.listGroupMemberships(
              "org_default",
              group.id,
              "user_ada",
            ),
          ).toHaveLength(1);
          expect(
            await repository.deleteGroupMembership(group.id, "user_ada"),
          ).toMatchObject(membership);
          expect(
            await repository.deleteGroupMembership(group.id, "user_ada"),
          ).toBeUndefined();
          expect(await repository.deleteGroup(group.id)).toMatchObject({
            id: group.id,
          });
          expect(await repository.deleteGroup(group.id)).toBeUndefined();

          const settings = {
            orgId: "org_default",
            enabled: true,
            issuerUrl: "https://issuer.example.com",
            clientId: "romeo",
            groupClaim: "groups",
            adminGroups: ["admins"],
            groupMap: { admins: "group_admins" },
            workspaceGroupMap: { default: "workspace_default" },
            workspaceGroupPrefix: "workspace:",
            createdBy: "user_dev_admin",
            updatedBy: "user_dev_admin",
            createdAt: "2026-06-30T10:04:00.000Z",
            updatedAt: "2026-06-30T10:04:00.000Z",
          };
          expect(await repository.upsertSsoOidcSettings(settings)).toEqual(
            settings,
          );
          expect(
            await repository.upsertSsoOidcSettings({
              ...settings,
              enabled: false,
              updatedAt: "2026-06-30T10:05:00.000Z",
            }),
          ).toMatchObject({ enabled: false });
          expect(
            await repository.getSsoOidcSettings("org_default"),
          ).toMatchObject({
            enabled: false,
            issuerUrl: "https://issuer.example.com",
          });
        });
      });

      it("purges tenant-owned identity and lifecycle records", async () => {
        await withRepository(subject, async (repository) => {
          const orgId = "org_purge_conformance";
          const workspaceId = "workspace_purge_conformance";
          const userId = "user_purge_conformance";
          const lifecycleKey = `tenant_lifecycle.deletion_request.v1:${orgId}`;
          await repository.createOrganization({
            id: orgId,
            name: "Purge Conformance",
            slug: "purge-conformance",
          });
          await repository.createWorkspace({
            id: workspaceId,
            orgId,
            name: "Purge Workspace",
            slug: "purge",
          });
          await repository.createUser({
            id: userId,
            orgId,
            email: "purge@example.com",
            name: "Purge User",
          });
          await repository.upsertSsoOidcSettings({
            orgId,
            enabled: true,
            issuerUrl: "https://purge-idp.example.com",
            clientId: "romeo-purge",
            groupClaim: "groups",
            adminGroups: [],
            groupMap: {},
            workspaceGroupMap: {},
            workspaceGroupPrefix: "workspace:",
            createdBy: "user_dev_admin",
            updatedBy: "user_dev_admin",
            createdAt: "2026-06-30T10:06:00.000Z",
            updatedAt: "2026-06-30T10:06:00.000Z",
          });
          await repository.upsertSystemSetting({
            key: lifecycleKey,
            updatedAt: "2026-06-30T10:06:01.000Z",
            value: { orgId, status: "requested" },
          });

          const result = await repository.purgeTenantData(orgId);

          expect(result.organizationDeleted).toBe(true);
          expect(result.recordCounts.organizations).toBe(1);
          expect(
            Object.values(result.recordCounts).reduce(
              (total, count) => total + count,
              0,
            ),
          ).toBeGreaterThanOrEqual(5);
          expect(await repository.getOrganization(orgId)).toBeUndefined();
          expect(await repository.getWorkspace(workspaceId)).toBeUndefined();
          expect(await repository.getCurrentUser(userId)).toBeUndefined();
          expect(await repository.getSsoOidcSettings(orgId)).toBeUndefined();
          expect(
            await repository.getSystemSetting(lifecycleKey),
          ).toBeUndefined();
        });
      });

      it("preserves provider and model ordering plus model upserts", async () => {
        await withRepository(subject, async (repository) => {
          await repository.createProvider(provider("provider_zed", "Zed"));
          await repository.createProvider(provider("provider_ada", "Ada"));

          const createdProviders = (
            await repository.listProviders("org_default")
          ).filter((item) =>
            ["provider_ada", "provider_zed"].includes(item.id),
          );
          expect(createdProviders.map((item) => item.id)).toEqual([
            "provider_ada",
            "provider_zed",
          ]);
          expect(JSON.stringify(createdProviders)).not.toContain("secret");
          expect(
            await repository.updateProvider({
              ...createdProviders[0]!,
              name: "Ada Updated",
            }),
          ).toMatchObject({ name: "Ada Updated" });

          await repository.upsertModels([
            model("model_zed", "provider_zed", "zed-model", "Zed Model"),
            model("model_ada", "provider_ada", "ada-model", "Ada Model"),
          ]);
          await repository.upsertModels([
            {
              ...model(
                "model_ada",
                "provider_ada",
                "ada-model-renamed",
                "Ada Model Updated",
              ),
              enabled: false,
            },
          ]);

          const createdModels = (await repository.listModels("org_default"))
            .filter((item) => ["model_ada", "model_zed"].includes(item.id))
            .map((item) => ({
              displayName: item.displayName,
              enabled: item.enabled,
              id: item.id,
              name: item.name,
            }));
          expect(createdModels).toEqual([
            {
              displayName: "Ada Model Updated",
              enabled: false,
              id: "model_ada",
              name: "ada-model-renamed",
            },
            {
              displayName: "Zed Model",
              enabled: true,
              id: "model_zed",
              name: "zed-model",
            },
          ]);
          expect(
            await repository.listModelsPage("org_default", {
              limit: 10,
              offset: 0,
              providerId: "provider_ada",
              query: "updated",
            }),
          ).toMatchObject({
            items: [expect.objectContaining({ id: "model_ada" })],
            total: 1,
          });
        });
      });

      it("preserves auth credential, device authorization, and session lookups", async () => {
        await withRepository(subject, async (repository) => {
          const serviceAccount = await repository.createServiceAccount({
            id: "service_account_conformance",
            orgId: "org_default",
            name: "Conformance worker",
            scopes: ["admin:read", "agents:read"],
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T10:10:00.000Z",
          });
          expect(
            await repository.listServiceAccounts("org_default"),
          ).toContainEqual(serviceAccount);
          expect(await repository.getServiceAccount(serviceAccount.id)).toEqual(
            serviceAccount,
          );
          expect(
            await repository.updateServiceAccount({
              ...serviceAccount,
              disabledAt: "2026-06-30T10:11:00.000Z",
            }),
          ).toMatchObject({ disabledAt: "2026-06-30T10:11:00.000Z" });

          const userKey = await repository.createApiKey({
            id: "api_key_user_conformance",
            orgId: "org_default",
            userId: "user_dev_admin",
            name: "User key",
            hashedToken: "hash_user_conformance",
            scopes: ["admin:read"],
            createdAt: "2026-06-30T10:12:00.000Z",
          });
          const serviceKey = await repository.createApiKey({
            id: "api_key_service_conformance",
            orgId: "org_default",
            serviceAccountId: serviceAccount.id,
            name: "Service key",
            hashedToken: "hash_service_conformance",
            scopes: ["agents:read"],
            createdAt: "2026-06-30T10:13:00.000Z",
          });
          expect(await repository.getApiKey(userKey.id)).toEqual(userKey);
          expect(
            await repository.getApiKeyByHash("hash_service_conformance"),
          ).toEqual(serviceKey);
          expect(
            (await repository.listApiKeys("org_default")).map((key) => key.id),
          ).toEqual([
            "api_key_service_conformance",
            "api_key_user_conformance",
          ]);
          expect(
            await repository.updateApiKey({
              ...serviceKey,
              revokedAt: "2026-06-30T10:14:00.000Z",
            }),
          ).toMatchObject({ revokedAt: "2026-06-30T10:14:00.000Z" });

          const authorization = await repository.createDeviceAuthorization({
            id: "device_auth_conformance",
            orgId: "org_default",
            userId: "user_dev_admin",
            name: "Desktop",
            scopes: ["agents:read"],
            hashedRefreshToken: "refresh_hash_conformance",
            accessApiKeyId: userKey.id,
            expiresAt: "2026-07-30T10:15:00.000Z",
            createdAt: "2026-06-30T10:15:00.000Z",
            updatedAt: "2026-06-30T10:15:00.000Z",
          });
          expect(
            await repository.listDeviceAuthorizations(
              "org_default",
              "user_dev_admin",
            ),
          ).toEqual([authorization]);
          expect(
            await repository.getDeviceAuthorization(authorization.id),
          ).toEqual(authorization);
          expect(
            await repository.getDeviceAuthorizationByRefreshHash(
              "refresh_hash_conformance",
            ),
          ).toEqual(authorization);
          expect(
            await repository.updateDeviceAuthorization({
              ...authorization,
              lastRefreshedAt: "2026-06-30T10:16:00.000Z",
              updatedAt: "2026-06-30T10:16:00.000Z",
            }),
          ).toMatchObject({ lastRefreshedAt: "2026-06-30T10:16:00.000Z" });

          const session = await repository.createUserSession({
            id: "session_conformance",
            orgId: "org_default",
            userId: "user_dev_admin",
            name: "Browser",
            hashedToken: "session_hash_conformance",
            scopes: ["admin:read"],
            isAdmin: true,
            expiresAt: "2026-07-01T10:17:00.000Z",
            createdAt: "2026-06-30T10:17:00.000Z",
          });
          expect(
            await repository.listUserSessions("org_default", "user_dev_admin"),
          ).toEqual([session]);
          expect(await repository.getUserSession(session.id)).toEqual(session);
          expect(
            await repository.getUserSessionByHash("session_hash_conformance"),
          ).toEqual(session);
          expect(
            await repository.updateUserSession({
              ...session,
              lastSeenAt: "2026-06-30T10:18:00.000Z",
            }),
          ).toMatchObject({ lastSeenAt: "2026-06-30T10:18:00.000Z" });

          const localPassword = await repository.createLocalPasswordCredential({
            id: "local_password_conformance",
            orgId: "org_default",
            userId: "user_dev_admin",
            emailNormalized: "admin@romeo.local",
            passwordHash: "scrypt$v=1$hash",
            failedAttemptCount: 0,
            passwordUpdatedAt: "2026-06-30T10:19:00.000Z",
            createdAt: "2026-06-30T10:19:00.000Z",
            updatedAt: "2026-06-30T10:19:00.000Z",
          });
          expect(
            await repository.getLocalPasswordCredentialByUserId(
              "user_dev_admin",
            ),
          ).toEqual(localPassword);
          expect(
            await repository.getLocalPasswordCredentialByEmail(
              "org_default",
              "admin@romeo.local",
            ),
          ).toEqual(localPassword);
          expect(
            await repository.updateLocalPasswordCredential({
              ...localPassword,
              failedAttemptCount: 2,
              lockedUntil: "2026-06-30T10:35:00.000Z",
              updatedAt: "2026-06-30T10:20:00.000Z",
            }),
          ).toMatchObject({
            failedAttemptCount: 2,
            lockedUntil: "2026-06-30T10:35:00.000Z",
          });

          const factor = await repository.createLocalMfaFactor({
            id: "mfa_factor_conformance",
            orgId: "org_default",
            userId: "user_dev_admin",
            type: "totp",
            name: "Authenticator",
            status: "pending",
            secretEncrypted: '{"v":1}',
            createdAt: "2026-06-30T10:21:00.000Z",
            updatedAt: "2026-06-30T10:21:00.000Z",
          });
          expect(
            await repository.listLocalMfaFactors(
              "org_default",
              "user_dev_admin",
            ),
          ).toEqual([factor]);
          expect(
            await repository.listLocalMfaFactorsForOrg("org_default"),
          ).toEqual([factor]);
          expect(await repository.getLocalMfaFactor(factor.id)).toEqual(factor);
          expect(
            await repository.updateLocalMfaFactor({
              ...factor,
              status: "active",
              confirmedAt: "2026-06-30T10:22:00.000Z",
              lastUsedAt: "2026-06-30T10:23:00.000Z",
              updatedAt: "2026-06-30T10:23:00.000Z",
            }),
          ).toMatchObject({
            status: "active",
            confirmedAt: "2026-06-30T10:22:00.000Z",
            lastUsedAt: "2026-06-30T10:23:00.000Z",
          });
        });
      });

      it("preserves agent, binding, version, and eval lifecycle behavior", async () => {
        await withRepository(subject, async (repository) => {
          const createdProvider = await repository.createProvider(
            provider("provider_agent_conformance", "Agent Provider"),
          );
          const [createdModel] = await repository.upsertModels([
            model(
              "model_agent_conformance",
              createdProvider.id,
              "agent-model",
              "Agent Model",
            ),
          ]);
          expect(await repository.getProvider(createdProvider.id)).toEqual(
            createdProvider,
          );
          expect(await repository.getModel(createdModel!.id)).toEqual(
            createdModel,
          );
          expect(
            await repository.updateModel({
              ...createdModel!,
              enabled: false,
            }),
          ).toMatchObject({ enabled: false });

          const agent = await repository.createAgent({
            id: "agent_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            name: "Conformance Agent",
            createdBy: "user_dev_admin",
            baseModelId: createdModel!.id,
            systemPrompt: "Use safe defaults.",
            parameters: { temperature: 0.1 },
            memoryPolicy: { mode: "disabled" },
            safetySettings: {},
            updatedAt: "2026-06-30T11:10:00.000Z",
          });
          expect(await repository.getAgent(agent.id)).toEqual(agent);
          expect(
            (await repository.listAgents("workspace_default")).map(
              (item) => item.id,
            ),
          ).toContain(agent.id);
          expect(
            await repository.updateAgent({
              ...agent,
              name: "Conformance Agent Updated",
              updatedAt: "2026-06-30T11:11:00.000Z",
            }),
          ).toMatchObject({ name: "Conformance Agent Updated" });

          const knowledgeBase = await repository.createKnowledgeBase({
            id: "kb_agent_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            name: "Agent KB",
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T11:12:00.000Z",
            updatedAt: "2026-06-30T11:12:00.000Z",
          });
          const knowledgeBinding = await repository.upsertAgentKnowledgeBinding(
            {
              id: "agent_kb_binding_conformance",
              orgId: "org_default",
              agentId: agent.id,
              knowledgeBaseId: knowledgeBase.id,
              enabled: true,
              createdAt: "2026-06-30T11:13:00.000Z",
              updatedAt: "2026-06-30T11:13:00.000Z",
            },
          );
          expect(await repository.listAgentKnowledgeBindings(agent.id)).toEqual(
            [knowledgeBinding],
          );
          const toolBinding = await repository.upsertAgentToolBinding({
            id: "agent_tool_binding_conformance",
            orgId: "org_default",
            agentId: agent.id,
            toolId: "tool_conformance",
            enabled: true,
            approvalRequired: true,
            createdAt: "2026-06-30T11:14:00.000Z",
            updatedAt: "2026-06-30T11:14:00.000Z",
          });
          expect(await repository.listAgentToolBindings(agent.id)).toEqual([
            toolBinding,
          ]);

          const version = await repository.createAgentVersion({
            id: "agent_version_conformance",
            agentId: agent.id,
            orgId: "org_default",
            workspaceId: "workspace_default",
            version: 1,
            status: "published",
            baseModelId: createdModel!.id,
            systemPrompt: agent.systemPrompt,
            parameters: agent.parameters,
            memoryPolicy: agent.memoryPolicy,
            safetySettings: agent.safetySettings,
            knowledgeBaseBindings: [
              { knowledgeBaseId: knowledgeBase.id, enabled: true },
            ],
            toolBindings: [
              {
                toolId: "tool_conformance",
                enabled: true,
                approvalRequired: true,
              },
            ],
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T11:15:00.000Z",
            publishedAt: "2026-06-30T11:15:00.000Z",
          });
          expect(await repository.getAgentVersion(version.id)).toEqual(version);
          expect(await repository.listAgentVersions(agent.id)).toEqual([
            version,
          ]);

          const suite = await repository.createEvalSuite({
            id: "eval_suite_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            agentId: agent.id,
            name: "Safety",
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T11:16:00.000Z",
            updatedAt: "2026-06-30T11:16:00.000Z",
          });
          expect(await repository.getEvalSuite(suite.id)).toEqual(suite);
          expect(await repository.listEvalSuites(agent.id)).toEqual([suite]);
          const [evalCase] = await repository.createEvalCases([
            {
              id: "eval_case_conformance",
              orgId: "org_default",
              suiteId: suite.id,
              input: "Say hello",
              expectedContains: "hello",
              requiresCitation: false,
              createdAt: "2026-06-30T11:17:00.000Z",
            },
          ]);
          expect(await repository.listEvalCases(suite.id)).toEqual([evalCase]);
          const evalRun = await repository.createEvalRun({
            id: "eval_run_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            agentId: agent.id,
            suiteId: suite.id,
            modelId: createdModel!.id,
            status: "passed",
            score: 1,
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T11:18:00.000Z",
            completedAt: "2026-06-30T11:18:30.000Z",
          });
          expect(await repository.getEvalRun(evalRun.id)).toEqual(evalRun);
          expect(await repository.listEvalRuns(agent.id)).toEqual([evalRun]);
          const [result] = await repository.createEvalRunResults([
            {
              id: "eval_result_conformance",
              orgId: "org_default",
              runId: evalRun.id,
              caseId: evalCase!.id,
              status: "passed",
              score: 1,
              output: "hello",
              checks: { contains: true },
              createdAt: "2026-06-30T11:19:00.000Z",
            },
          ]);
          expect(await repository.getEvalRunResult(result!.id)).toEqual(result);
          expect(await repository.listEvalRunResults(evalRun.id)).toEqual([
            result,
          ]);
          const rating = await repository.upsertEvalResultHumanRating({
            id: "eval_rating_conformance",
            orgId: "org_default",
            runId: evalRun.id,
            resultId: result!.id,
            reviewerId: "user_dev_admin",
            rating: "pass",
            comment: "Looks safe",
            createdAt: "2026-06-30T11:20:00.000Z",
            updatedAt: "2026-06-30T11:20:00.000Z",
          });
          expect(
            await repository.getEvalResultHumanRating(
              result!.id,
              "user_dev_admin",
            ),
          ).toEqual(rating);
          expect(
            await repository.listEvalResultHumanRatings(evalRun.id),
          ).toEqual([rating]);

          const policy = await repository.upsertManagedModelCustomizationPolicy(
            {
              orgId: "org_default",
              agentId: agent.id,
              allowCommunicationStyle: true,
              allowResponseLength: true,
              allowLanguage: false,
              allowCustomInstructions: false,
              allowPersonalMemory: true,
              allowVoiceSelection: false,
              createdAt: "2026-06-30T11:21:00.000Z",
              updatedAt: "2026-06-30T11:21:00.000Z",
            },
          );
          expect(
            await repository.getManagedModelCustomizationPolicy(
              "org_default",
              agent.id,
            ),
          ).toEqual(policy);
          const preference = await repository.upsertManagedModelPreference({
            orgId: "org_default",
            agentId: agent.id,
            principalType: "user",
            principalId: "user_dev_admin",
            communicationStyle: "concise",
            personalMemoryEnabled: true,
            createdAt: "2026-06-30T11:22:00.000Z",
            updatedAt: "2026-06-30T11:22:00.000Z",
          });
          expect(
            await repository.getManagedModelPreference(
              "org_default",
              agent.id,
              "user",
              "user_dev_admin",
            ),
          ).toEqual(preference);
          expect(
            await repository.listManagedModelPreferences(
              "org_default",
              agent.id,
            ),
          ).toEqual([preference]);
          await repository.deleteManagedModelPreference(
            "org_default",
            agent.id,
            "user",
            "user_dev_admin",
          );
          expect(
            await repository.listManagedModelPreferences(
              "org_default",
              agent.id,
            ),
          ).toEqual([]);
          expect(
            await repository.archiveAgent(agent.id, "2026-06-30T11:23:00.000Z"),
          ).toMatchObject({ archivedAt: "2026-06-30T11:23:00.000Z" });
        });
      });

      it("preserves chat, message, part, and comment lifecycle ordering", async () => {
        await withRepository(subject, async (repository) => {
          const chat = await repository.createChat({
            id: "chat_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            title: "Conformance Chat",
            createdBy: "user_dev_admin",
            updatedAt: "2026-06-30T11:00:00.000Z",
          });
          expect(await repository.getChat(chat.id)).toMatchObject(chat);

          await repository.updateChat({
            ...chat,
            title: "Conformance Chat Updated",
            updatedAt: "2026-06-30T11:01:00.000Z",
          });
          expect(
            await repository.listChats("workspace_default"),
          ).toContainEqual(
            expect.objectContaining({
              id: chat.id,
              title: "Conformance Chat Updated",
            }),
          );

          await repository.createMessage({
            id: "message_second",
            chatId: chat.id,
            role: "assistant",
            content: "second",
            createdAt: "2026-06-30T11:03:00.000Z",
          });
          const firstMessage = await repository.createMessage({
            id: "message_first",
            chatId: chat.id,
            role: "user",
            content: "first",
            createdAt: "2026-06-30T11:02:00.000Z",
          });
          expect(
            (await repository.listMessages(chat.id)).map((item) => item.id),
          ).toEqual(["message_first", "message_second"]);
          expect(await repository.getMessage(firstMessage.id)).toEqual(
            firstMessage,
          );
          expect(
            await repository.listAuthorizedChatsPage({
              archived: "active",
              groupIds: [],
              isAdmin: true,
              limit: 10,
              now: "2026-06-30T11:03:30.000Z",
              offset: 0,
              orgId: "org_default",
              principalId: "user_dev_admin",
              principalType: "user",
              workspaceId: "workspace_default",
            }),
          ).toMatchObject({
            items: expect.arrayContaining([
              expect.objectContaining({ id: chat.id }),
            ]),
          });
          expect(
            await repository.searchChatContent("workspace_default", "first"),
          ).toContainEqual(
            expect.objectContaining({
              chatId: chat.id,
              messageId: firstMessage.id,
            }),
          );

          await repository.createMessageParts([
            {
              id: "part_two",
              messageId: firstMessage.id,
              type: "attachment",
              content: "s3://bucket/two",
              metadata: { fileName: "two.txt" },
            },
            {
              id: "part_one",
              messageId: firstMessage.id,
              type: "attachment",
              content: "s3://bucket/one",
              metadata: { fileName: "one.txt" },
            },
          ]);
          expect(
            (await repository.listMessageParts(firstMessage.id)).map(
              (item) => item.id,
            ),
          ).toEqual(["part_two", "part_one"]);
          expect(await repository.getMessagePart("part_one")).toMatchObject({
            id: "part_one",
          });
          expect(
            await repository.updateMessagePart({
              id: "part_one",
              messageId: firstMessage.id,
              type: "attachment",
              content: "s3://bucket/one-updated",
              metadata: { fileName: "one-updated.txt" },
            }),
          ).toMatchObject({ content: "s3://bucket/one-updated" });

          await repository.deleteMessage("message_second");
          expect(
            (await repository.listMessages(chat.id)).map((item) => item.id),
          ).toEqual(["message_first"]);
          expect(await repository.getMessage("message_second")).toBeUndefined();

          await repository.deleteMessage(firstMessage.id);
          expect(await repository.getMessage(firstMessage.id)).toBeUndefined();
          expect(await repository.listMessageParts(firstMessage.id)).toEqual(
            [],
          );

          const comment = await repository.createChatComment({
            id: "comment_one",
            orgId: "org_default",
            chatId: chat.id,
            authorId: "user_dev_admin",
            body: "Looks good",
            mentionedUserIds: ["user_dev_admin"],
            createdAt: "2026-06-30T11:04:00.000Z",
          });
          expect(await repository.listChatComments(chat.id)).toEqual([comment]);

          const file = await repository.createFileObject({
            id: "file_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            ownerType: "user",
            ownerId: "user_dev_admin",
            fileName: "notes.txt",
            mimeType: "text/plain",
            sizeBytes: 11,
            sha256:
              "64ec88ca00b268e5ba1a35678a1b5316d212f4f366b2477232534a8aeca37f3c",
            objectKey:
              "files/org_default/workspace_default/file_conformance/notes.txt",
            purpose: "general",
            status: "available",
            metadata: { source: "conformance" },
            createdAt: "2026-06-30T11:05:00.000Z",
            updatedAt: "2026-06-30T11:05:00.000Z",
          });
          expect(await repository.getFileObject(file.id)).toEqual(file);
          expect(
            (await repository.listFileObjects("org_default")).map(
              (item) => item.id,
            ),
          ).toContain(file.id);
          expect(
            (
              await repository.listFileObjects(
                "org_default",
                "workspace_default",
              )
            ).map((item) => item.id),
          ).toContain(file.id);
          expect(
            await repository.listAuthorizedFileObjectsPage({
              accessMode: "workspace_content",
              groupIds: [],
              isAdmin: true,
              limit: 10,
              offset: 0,
              orgId: "org_default",
              principalId: "user_dev_admin",
              principalType: "user",
              query: "notes",
              workspaceId: "workspace_default",
            }),
          ).toMatchObject({
            items: [expect.objectContaining({ id: file.id })],
            total: 1,
          });
          await repository.updateFileObject({
            ...file,
            status: "uploading",
            updatedAt: "2026-06-30T11:05:30.000Z",
          });
          expect(await repository.getFileObject(file.id)).toMatchObject({
            id: file.id,
            status: "uploading",
            updatedAt: "2026-06-30T11:05:30.000Z",
          });
          await repository.updateFileObject({
            ...file,
            status: "deleted",
            deletedAt: "2026-06-30T11:06:00.000Z",
            updatedAt: "2026-06-30T11:06:00.000Z",
          });
          expect(await repository.getFileObject(file.id)).toMatchObject({
            id: file.id,
            status: "deleted",
            deletedAt: "2026-06-30T11:06:00.000Z",
          });

          const tag = await repository.upsertChatTag({
            id: "chat_tag_conformance",
            orgId: "org_default",
            userId: "user_dev_admin",
            slug: "important_work",
            name: "Important Work",
            meta: { color: "red" },
            createdAt: "2026-06-30T11:05:00.000Z",
            updatedAt: "2026-06-30T11:05:00.000Z",
          });
          const assignment = await repository.createChatTagAssignment({
            id: "chat_tag_assignment_conformance",
            orgId: "org_default",
            userId: "user_dev_admin",
            chatId: chat.id,
            tagId: tag.id,
            createdAt: "2026-06-30T11:06:00.000Z",
          });
          expect(
            await repository.listChatTags("org_default", "user_dev_admin"),
          ).toEqual([tag]);
          expect(
            await repository.listChatTagsForChat(
              "org_default",
              "user_dev_admin",
              chat.id,
            ),
          ).toEqual([tag]);
          expect(
            await repository.listChatIdsByTag(
              "org_default",
              "user_dev_admin",
              "important_work",
            ),
          ).toEqual([chat.id]);
          expect(
            await repository.countChatTagAssignments(
              "org_default",
              "user_dev_admin",
              "important_work",
            ),
          ).toBe(1);
          expect(
            await repository.createChatTagAssignment({
              ...assignment,
              id: "chat_tag_assignment_duplicate",
            }),
          ).toEqual(assignment);
          expect(
            await repository.deleteChatTagAssignment(
              "org_default",
              "user_dev_admin",
              chat.id,
              "important_work",
            ),
          ).toEqual(assignment);
          expect(
            await repository.countChatTagAssignments(
              "org_default",
              "user_dev_admin",
              "important_work",
            ),
          ).toBe(0);
          expect(
            await repository.deleteChatTag(
              "org_default",
              "user_dev_admin",
              "important_work",
            ),
          ).toEqual(tag);

          const channelUser = await repository.createUser({
            id: "user_romeo_channel_member",
            orgId: "org_default",
            email: "channel-member@romeo.local",
            name: "Channel Member",
          });
          const collaborationChannel =
            await repository.createCollaborationChannel({
              id: "collaboration_channel_conformance",
              orgId: "org_default",
              workspaceId: "workspace_default",
              userId: "user_dev_admin",
              type: "group",
              name: "conformance",
              description: "Channel conformance",
              isPrivate: true,
              data: { topic: "storage" },
              meta: { color: "blue" },
              createdAt: "2026-06-30T11:07:00.000Z",
              updatedAt: "2026-06-30T11:07:00.000Z",
            });
          expect(
            await repository.getCollaborationChannel(collaborationChannel.id),
          ).toEqual(collaborationChannel);
          expect(
            await repository.listCollaborationChannels("org_default"),
          ).toContainEqual(collaborationChannel);
          const updatedCollaborationChannel =
            await repository.updateCollaborationChannel({
              ...collaborationChannel,
              name: "conformance-updated",
              updatedAt: "2026-06-30T11:08:00.000Z",
              updatedBy: "user_dev_admin",
            });
          expect(updatedCollaborationChannel).toMatchObject({
            name: "conformance-updated",
            updatedBy: "user_dev_admin",
          });

          const ownerMember = await repository.createCollaborationChannelMember(
            {
              id: "collaboration_channel_member_owner",
              orgId: "org_default",
              channelId: collaborationChannel.id,
              userId: "user_dev_admin",
              role: "manager",
              status: "joined",
              isActive: true,
              isChannelMuted: false,
              isChannelPinned: false,
              invitedAt: "2026-06-30T11:09:00.000Z",
              invitedBy: "user_dev_admin",
              joinedAt: "2026-06-30T11:09:00.000Z",
              lastReadAt: "2026-06-30T11:09:00.000Z",
              createdAt: "2026-06-30T11:09:00.000Z",
              updatedAt: "2026-06-30T11:09:00.000Z",
            },
          );
          const invitedMember =
            await repository.createCollaborationChannelMember({
              id: "collaboration_channel_member_invited",
              orgId: "org_default",
              channelId: collaborationChannel.id,
              userId: channelUser.id,
              status: "joined",
              isActive: true,
              isChannelMuted: false,
              isChannelPinned: false,
              invitedAt: "2026-06-30T11:10:00.000Z",
              invitedBy: "user_dev_admin",
              joinedAt: "2026-06-30T11:10:00.000Z",
              lastReadAt: "2026-06-30T11:10:00.000Z",
              createdAt: "2026-06-30T11:10:00.000Z",
              updatedAt: "2026-06-30T11:10:00.000Z",
            });
          expect(
            await repository.getCollaborationChannelMember(
              collaborationChannel.id,
              channelUser.id,
            ),
          ).toEqual(invitedMember);
          expect(
            await repository.listCollaborationChannelMembers(
              "org_default",
              collaborationChannel.id,
            ),
          ).toEqual([ownerMember, invitedMember]);
          expect(
            await repository.listCollaborationChannelMembers(
              "org_default",
              undefined,
              channelUser.id,
            ),
          ).toEqual([invitedMember]);
          expect(
            await repository.updateCollaborationChannelMember({
              ...invitedMember,
              isActive: false,
              status: "left",
              leftAt: "2026-06-30T11:11:00.000Z",
              updatedAt: "2026-06-30T11:11:00.000Z",
            }),
          ).toMatchObject({ isActive: false, status: "left" });
          expect(
            await repository.deleteCollaborationChannelMembers(
              collaborationChannel.id,
              [channelUser.id],
            ),
          ).toHaveLength(1);
          expect(
            await repository.deleteCollaborationChannel(
              collaborationChannel.id,
            ),
          ).toEqual(updatedCollaborationChannel);
        });
      });

      it("preserves notification ledger and delivery lifecycle", async () => {
        await withRepository(subject, async (repository) => {
          const chat = await repository.createChat({
            id: "chat_notification_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            title: "Notification Chat",
            createdBy: "user_dev_admin",
            updatedAt: "2026-06-30T11:30:00.000Z",
          });
          const notification = await repository.createUserNotification({
            id: "notification_conformance",
            orgId: "org_default",
            userId: "user_dev_admin",
            type: "chat_mention",
            actorId: "user_dev_admin",
            resourceType: "chat",
            resourceId: chat.id,
            metadata: { mentionCount: 1 },
            createdAt: "2026-06-30T11:31:00.000Z",
          });
          expect(
            await repository.listUserNotifications(
              "org_default",
              "user_dev_admin",
            ),
          ).toContainEqual(notification);
          expect(
            await repository.updateUserNotification({
              ...notification,
              readAt: "2026-06-30T11:32:00.000Z",
            }),
          ).toMatchObject({ readAt: "2026-06-30T11:32:00.000Z" });

          const channel = await repository.createNotificationDeliveryChannel({
            id: "notification_channel_conformance",
            orgId: "org_default",
            userId: "user_dev_admin",
            type: "webhook",
            name: "Ops webhook",
            config: { urlConfigured: true },
            enabled: true,
            createdAt: "2026-06-30T11:33:00.000Z",
            updatedAt: "2026-06-30T11:33:00.000Z",
          });
          expect(
            await repository.listNotificationDeliveryChannels(
              "org_default",
              "user_dev_admin",
            ),
          ).toEqual([channel]);

          const delivery = await repository.createNotificationDelivery({
            id: "notification_delivery_conformance",
            orgId: "org_default",
            userId: "user_dev_admin",
            notificationId: notification.id,
            channelId: channel.id,
            status: "pending",
            attemptCount: 0,
            metadata: { provider: "webhook" },
            createdAt: "2026-06-30T11:34:00.000Z",
            updatedAt: "2026-06-30T11:34:00.000Z",
          });
          expect(
            await repository.listNotificationDeliveries(
              "org_default",
              "user_dev_admin",
            ),
          ).toEqual([delivery]);
          expect(
            await repository.updateNotificationDelivery({
              ...delivery,
              status: "sent",
              attemptCount: 1,
              deliveredAt: "2026-06-30T11:35:00.000Z",
              updatedAt: "2026-06-30T11:35:00.000Z",
            }),
          ).toMatchObject({
            attemptCount: 1,
            deliveredAt: "2026-06-30T11:35:00.000Z",
            status: "sent",
          });
        });
      });

      it("preserves knowledge, embedding, and connector lifecycle behavior", async () => {
        await withRepository(subject, async (repository) => {
          const knowledgeBase = await repository.createKnowledgeBase({
            id: "kb_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            name: "Conformance KB",
            description: "Repository conformance",
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T11:40:00.000Z",
            updatedAt: "2026-06-30T11:40:00.000Z",
          });
          expect(await repository.getKnowledgeBase(knowledgeBase.id)).toEqual(
            knowledgeBase,
          );
          expect(
            await repository.listKnowledgeBases("workspace_default"),
          ).toContainEqual(knowledgeBase);
          expect(
            await repository.updateKnowledgeBase({
              ...knowledgeBase,
              name: "Conformance KB Updated",
              description: "Updated repository conformance",
              updatedAt: "2026-06-30T11:40:30.000Z",
            }),
          ).toMatchObject({
            description: "Updated repository conformance",
            name: "Conformance KB Updated",
          });

          const source = await repository.createKnowledgeSource({
            id: "knowledge_source_conformance",
            knowledgeBaseId: knowledgeBase.id,
            orgId: "org_default",
            workspaceId: "workspace_default",
            fileName: "runbook.md",
            mimeType: "text/markdown",
            sizeBytes: 42,
            status: "pending",
            objectKey: "knowledge/runbook.md",
            metadata: { classification: "internal" },
            createdAt: "2026-06-30T11:41:00.000Z",
            updatedAt: "2026-06-30T11:41:00.000Z",
          });
          expect(
            await repository.listKnowledgeSources(knowledgeBase.id),
          ).toEqual([source]);
          expect(
            await repository.updateKnowledgeSource({
              ...source,
              status: "indexed",
              chunkCount: 2,
              contentHash: "sha256:source",
              indexedAt: "2026-06-30T11:42:00.000Z",
              updatedAt: "2026-06-30T11:42:00.000Z",
            }),
          ).toMatchObject({ chunkCount: 2, status: "indexed" });

          const chunks = await repository.createKnowledgeChunks([
            {
              id: "knowledge_chunk_two",
              knowledgeBaseId: knowledgeBase.id,
              sourceId: source.id,
              orgId: "org_default",
              workspaceId: "workspace_default",
              sequence: 2,
              content: "Second chunk",
              tokenCount: 2,
              metadata: {},
              createdAt: "2026-06-30T11:43:00.000Z",
            },
            {
              id: "knowledge_chunk_one",
              knowledgeBaseId: knowledgeBase.id,
              sourceId: source.id,
              orgId: "org_default",
              workspaceId: "workspace_default",
              sequence: 1,
              content: "First chunk",
              tokenCount: 2,
              metadata: {},
              createdAt: "2026-06-30T11:43:01.000Z",
            },
          ]);
          expect(
            (await repository.listKnowledgeChunks(knowledgeBase.id)).map(
              (item) => item.id,
            ),
          ).toEqual(["knowledge_chunk_one", "knowledge_chunk_two"]);
          const vectorScopeWorkspace = await repository.createWorkspace({
            id: "workspace_vector_scope",
            orgId: "org_default",
            name: "Vector Scope",
            slug: "vector-scope",
          });

          const embedding = Array.from({ length: 1536 }, (_, index) =>
            index === 0 ? 1 : 0,
          );
          const [storedEmbedding] =
            await repository.upsertKnowledgeChunkEmbeddings([
              {
                id: "knowledge_embedding_conformance",
                knowledgeBaseId: knowledgeBase.id,
                sourceId: source.id,
                chunkId: chunks[1]!.id,
                orgId: "org_default",
                workspaceId: "workspace_default",
                embeddingProvider: "local",
                embeddingModel: "unit",
                dimensions: 1536,
                embedding,
                metadata: { rank: 1 },
                createdAt: "2026-06-30T11:44:00.000Z",
                updatedAt: "2026-06-30T11:44:00.000Z",
              },
              {
                id: "knowledge_embedding_wrong_workspace",
                knowledgeBaseId: knowledgeBase.id,
                sourceId: source.id,
                chunkId: chunks[0]!.id,
                orgId: "org_default",
                workspaceId: vectorScopeWorkspace.id,
                embeddingProvider: "local",
                embeddingModel: "unit",
                dimensions: 1536,
                embedding,
                metadata: { scopeFixture: "wrong_workspace" },
                createdAt: "2026-06-30T11:44:01.000Z",
                updatedAt: "2026-06-30T11:44:01.000Z",
              },
            ]);
          if (storedEmbedding === undefined) {
            throw new Error("Expected repository to return stored embedding.");
          }
          expect(
            (await repository.listKnowledgeChunkEmbeddings(knowledgeBase.id))
              .map((item) => item.id)
              .sort(),
          ).toEqual(
            ["knowledge_embedding_wrong_workspace", storedEmbedding.id].sort(),
          );
          expect(
            await repository.searchKnowledgeChunkEmbeddings({
              orgId: "org_default",
              workspaceId: "workspace_default",
              knowledgeBaseId: knowledgeBase.id,
              embeddingProvider: "local",
              embeddingModel: "unit",
              dimensions: 1536,
              queryEmbedding: embedding,
              maxResults: 1,
            }),
          ).toEqual([{ embedding: storedEmbedding, score: 1 }]);
          await repository.deleteKnowledgeChunkEmbeddingsForSource(source.id);
          expect(
            await repository.listKnowledgeChunkEmbeddings(knowledgeBase.id),
          ).toEqual([]);
          await repository.deleteKnowledgeChunksForSource(source.id);
          expect(
            await repository.listKnowledgeChunks(knowledgeBase.id),
          ).toEqual([]);

          const connector = await repository.createDataConnector({
            id: "data_connector_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            knowledgeBaseId: knowledgeBase.id,
            type: "local_import",
            name: "Local import",
            config: { source: "manual" },
            status: "active",
            syncIntervalMinutes: 60,
            nextSyncAt: "2026-06-30T12:45:00.000Z",
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T11:45:00.000Z",
            updatedAt: "2026-06-30T11:45:00.000Z",
          });
          expect(await repository.getDataConnector(connector.id)).toEqual(
            connector,
          );
          expect(
            await repository.listDataConnectors(
              "org_default",
              "workspace_default",
            ),
          ).toEqual([connector]);
          expect(
            await repository.updateDataConnector({
              ...connector,
              status: "disabled",
              lastSyncAt: "2026-06-30T11:46:00.000Z",
              updatedAt: "2026-06-30T11:46:00.000Z",
            }),
          ).toMatchObject({ status: "disabled" });

          const delegatedOAuthConnection =
            await repository.createDelegatedOAuthConnection({
              id: "delegated_oauth_connection_conformance",
              orgId: "org_default",
              workspaceId: "workspace_default",
              userId: "user_dev_admin",
              providerId: "github",
              connectorType: "github",
              providerAccountId: "12345",
              providerAccountLogin: "octocat",
              scopes: ["repo", "read:user"],
              status: "active",
              token: {
                v: 1,
                alg: "A256GCM",
                iv: "iv",
                ciphertext: "ciphertext",
                tag: "tag",
                createdAt: "2026-06-30T11:46:30.000Z",
              },
              accessTokenExpiresAt: "2026-06-30T12:46:30.000Z",
              createdAt: "2026-06-30T11:46:30.000Z",
              updatedAt: "2026-06-30T11:46:30.000Z",
            });
          expect(
            await repository.getDelegatedOAuthConnection(
              delegatedOAuthConnection.id,
            ),
          ).toEqual(delegatedOAuthConnection);
          expect(
            await repository.getDelegatedOAuthConnectionByProviderAccount({
              orgId: "org_default",
              workspaceId: "workspace_default",
              userId: "user_dev_admin",
              providerId: "github",
              connectorType: "github",
              providerAccountId: "12345",
            }),
          ).toEqual(delegatedOAuthConnection);
          expect(
            await repository.listDelegatedOAuthConnections(
              "org_default",
              "workspace_default",
              "user_dev_admin",
            ),
          ).toEqual([delegatedOAuthConnection]);
          expect(
            await repository.listDelegatedOAuthConnections(
              "org_default",
              "workspace_default",
              "user_other",
            ),
          ).toEqual([]);
          const lockedDelegatedOAuthConnection =
            await repository.withDelegatedOAuthConnectionRefreshLock(
              delegatedOAuthConnection.id,
              async (lockedRepository) =>
                lockedRepository.updateDelegatedOAuthConnection({
                  ...delegatedOAuthConnection,
                  lastUsedAt: "2026-06-30T11:46:40.000Z",
                  updatedAt: "2026-06-30T11:46:40.000Z",
                }),
            );
          expect(lockedDelegatedOAuthConnection).toMatchObject({
            lastUsedAt: "2026-06-30T11:46:40.000Z",
          });
          expect(
            await repository.updateDelegatedOAuthConnection({
              ...lockedDelegatedOAuthConnection,
              status: "revoked",
              revokedAt: "2026-06-30T11:46:45.000Z",
              updatedAt: "2026-06-30T11:46:45.000Z",
            }),
          ).toMatchObject({ status: "revoked" });

          const sync = await repository.createDataConnectorSync({
            id: "data_connector_sync_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            knowledgeBaseId: knowledgeBase.id,
            connectorId: connector.id,
            status: "running",
            createdBy: "user_dev_admin",
            itemCount: 0,
            sourceIds: [],
            summary: {},
            startedAt: "2026-06-30T11:47:00.000Z",
          });
          expect(
            await repository.listDataConnectorSyncs(
              "org_default",
              connector.id,
            ),
          ).toEqual([sync]);
          expect(
            await repository.updateDataConnectorSync({
              ...sync,
              status: "completed",
              itemCount: 1,
              sourceIds: [source.id],
              summary: { imported: 1 },
              completedAt: "2026-06-30T11:48:00.000Z",
            }),
          ).toMatchObject({ itemCount: 1, status: "completed" });

          expect(
            await repository.deleteKnowledgeSource(source.id),
          ).toMatchObject({ id: source.id });
          expect(
            await repository.deleteKnowledgeSource(source.id),
          ).toBeUndefined();
        });
      });

      it("preserves run, tool, and workflow lifecycle behavior", async () => {
        await withRepository(subject, async (repository) => {
          const runtime = await seedRuntimeGraph(repository, "runtime");
          const run = await repository.createRun({
            id: "run_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            chatId: runtime.chatId,
            agentId: runtime.agentId,
            agentVersionId: runtime.agentVersionId,
            modelId: runtime.modelId,
            providerId: runtime.providerId,
            status: "queued",
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T12:10:00.000Z",
          });
          expect(await repository.getRun(run.id)).toEqual(run);
          expect(await repository.listRuns(runtime.chatId)).toContainEqual(run);
          expect(
            await repository.updateRun({ ...run, status: "running" }),
          ).toMatchObject({ status: "running" });
          expect(
            await repository.finalizeRun({
              runId: run.id,
              status: "completed",
              completedAt: "2026-06-30T12:11:00.000Z",
            }),
          ).toMatchObject({
            completedAt: "2026-06-30T12:11:00.000Z",
            status: "completed",
          });
          expect(
            await repository.finalizeRun({
              runId: run.id,
              status: "failed",
              completedAt: "2026-06-30T12:12:00.000Z",
            }),
          ).toBeUndefined();

          await repository.appendRunEvents([
            {
              id: "run_event_started",
              runId: run.id,
              sequence: 1,
              type: "run.started",
              data: { status: "running" },
              createdAt: "2026-06-30T12:10:01.000Z",
            },
            {
              id: "run_event_completed",
              runId: run.id,
              sequence: 2,
              type: "run.completed",
              data: { status: "completed" },
              createdAt: "2026-06-30T12:11:00.000Z",
            },
          ]);
          expect(
            (await repository.listRunEvents(run.id)).map((item) => item.id),
          ).toEqual(["run_event_started", "run_event_completed"]);

          const toolCall = await repository.createToolCall({
            id: "tool_call_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            agentId: runtime.agentId,
            actorId: "user_dev_admin",
            toolId: "tool_connector_conformance",
            status: "success",
            riskLevel: "low",
            approvalRequired: false,
            inputKeys: ["query"],
            outputKeys: ["result"],
            runId: run.id,
            startedAt: "2026-06-30T12:12:00.000Z",
            completedAt: "2026-06-30T12:12:01.000Z",
          });
          expect(await repository.listToolCalls("org_default")).toContainEqual(
            toolCall,
          );

          const connector = await repository.createToolConnector({
            id: "tool_connector_conformance",
            orgId: "org_default",
            type: "webhook",
            name: "Webhook Tool",
            description: "Conformance webhook",
            schema: { openapi: "3.1.0" },
            authConfig: { mode: "none" },
            networkPolicy: {
              mode: "allow_hosts",
              allowedHosts: ["hooks.example.com"],
              allowPrivateNetwork: false,
            },
            riskLevel: "medium",
            approvalPolicy: "write_operations",
            visibility: "workspace",
            enabled: true,
            createdAt: "2026-06-30T12:13:00.000Z",
            updatedAt: "2026-06-30T12:13:00.000Z",
          });
          expect(await repository.listToolConnectors("org_default")).toEqual([
            connector,
          ]);
          expect(
            await repository.updateToolConnector({
              ...connector,
              enabled: false,
              updatedAt: "2026-06-30T12:14:00.000Z",
            }),
          ).toMatchObject({ enabled: false });

          const [operation] = await repository.createToolOperations([
            {
              id: "tool_operation_conformance",
              orgId: "org_default",
              connectorId: connector.id,
              operationId: "post-message",
              method: "POST",
              path: "/messages",
              name: "Post message",
              description: "Post a message",
              inputSchema: { type: "object" },
              outputSchema: { type: "object" },
              riskLevel: "medium",
              approvalPolicy: "write_operations",
              enabled: true,
              createdAt: "2026-06-30T12:15:00.000Z",
            },
          ]);
          expect(await repository.listToolOperations(connector.id)).toEqual([
            operation,
          ]);
          expect(
            await repository.updateToolOperation({
              ...operation!,
              enabled: false,
              name: "Post message disabled",
            }),
          ).toMatchObject({
            enabled: false,
            name: "Post message disabled",
          });

          const workflow = await repository.createWorkflowDefinition({
            id: "workflow_definition_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            name: "Run agent",
            description: "Conformance workflow",
            steps: [
              {
                id: "workflow_step_agent",
                type: "agent_run",
                name: "Run agent",
                agentId: runtime.agentId,
              },
            ],
            schedule: {
              enabled: true,
              intervalMinutes: 60,
              nextRunAt: "2026-06-30T13:15:00.000Z",
            },
            enabled: true,
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T12:16:00.000Z",
            updatedAt: "2026-06-30T12:16:00.000Z",
          });
          expect(await repository.getWorkflowDefinition(workflow.id)).toEqual(
            workflow,
          );
          expect(
            await repository.listWorkflowDefinitions(
              "org_default",
              "workspace_default",
            ),
          ).toEqual([workflow]);
          expect(
            await repository.updateWorkflowDefinition({
              ...workflow,
              enabled: false,
              updatedAt: "2026-06-30T12:17:00.000Z",
            }),
          ).toMatchObject({ enabled: false });

          const workflowRun = await repository.createWorkflowRun({
            id: "workflow_run_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            workflowId: workflow.id,
            status: "waiting_run",
            input: { prompt: "Summarize" },
            steps: [
              {
                stepId: "workflow_step_agent",
                type: "agent_run",
                status: "waiting_run",
                output: {},
              },
            ],
            currentStepId: "workflow_step_agent",
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T12:18:00.000Z",
            updatedAt: "2026-06-30T12:18:00.000Z",
          });
          expect(await repository.getWorkflowRun(workflowRun.id)).toEqual(
            workflowRun,
          );
          expect(
            await repository.listWorkflowRuns("org_default", workflow.id),
          ).toEqual([workflowRun]);
          expect(
            await repository.updateWorkflowRun({
              ...workflowRun,
              status: "completed",
              steps: [
                {
                  stepId: "workflow_step_agent",
                  type: "agent_run",
                  status: "completed",
                  output: { runId: run.id },
                  completedAt: "2026-06-30T12:19:00.000Z",
                },
              ],
              currentStepId: undefined,
              completedAt: "2026-06-30T12:19:00.000Z",
              updatedAt: "2026-06-30T12:19:00.000Z",
            }),
          ).toMatchObject({
            completedAt: "2026-06-30T12:19:00.000Z",
            status: "completed",
          });
        });
      });

      it("preserves collaboration, access, and governed deletion behavior", async () => {
        await withRepository(subject, async (repository) => {
          const runtime = await seedRuntimeGraph(repository, "collaboration");
          const grant = await repository.createResourceGrant({
            id: "resource_grant_conformance",
            resourceType: "agent",
            resourceId: runtime.agentId,
            principalType: "group",
            principalId: "group_access_conformance",
            permission: "read",
          });
          expect(
            await repository.listResourceGrants("org_default"),
          ).toContainEqual(grant);
          const singleGrant = await repository.createResourceGrant({
            ...grant,
            id: "resource_grant_single_delete_conformance",
            principalId: "group_single_delete_conformance",
          });
          expect(await repository.deleteResourceGrant(singleGrant.id)).toEqual(
            singleGrant,
          );
          expect(
            await repository.deleteResourceGrantsForPrincipal(
              "org_default",
              "group",
              "group_access_conformance",
            ),
          ).toEqual([grant]);
          expect(
            await repository.listResourceGrants("org_default"),
          ).not.toContainEqual(grant);

          const template = await repository.createPromptTemplate({
            id: "prompt_template_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            name: "Summarize",
            description: "Summary template",
            body: "Summarize {{input}}",
            tags: ["summary"],
            visibility: "workspace",
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T12:20:00.000Z",
            updatedAt: "2026-06-30T12:20:00.000Z",
          });
          expect(await repository.getPromptTemplate(template.id)).toEqual(
            template,
          );
          expect(
            await repository.listPromptTemplates(
              "org_default",
              "workspace_default",
            ),
          ).toEqual([template]);
          expect(
            await repository.listAuthorizedPromptTemplatesPage({
              groupIds: [],
              isAdmin: true,
              limit: 10,
              offset: 0,
              orgId: "org_default",
              principalId: "user_dev_admin",
              principalType: "user",
              query: "Summarize",
              workspaceId: "workspace_default",
            }),
          ).toMatchObject({ items: [template], total: 1 });
          expect(
            await repository.updatePromptTemplate({
              ...template,
              body: "Summarize safely {{input}}",
              updatedAt: "2026-06-30T12:21:00.000Z",
            }),
          ).toMatchObject({ body: "Summarize safely {{input}}" });
          expect(
            await repository.deletePromptTemplate(template.id),
          ).toMatchObject({ id: template.id });
          expect(
            await repository.deletePromptTemplate(template.id),
          ).toBeUndefined();

          const favorite = await repository.createResourceFavorite({
            id: "resource_favorite_conformance",
            orgId: "org_default",
            userId: "user_dev_admin",
            resourceType: "agent",
            resourceId: runtime.agentId,
            createdAt: "2026-06-30T12:22:00.000Z",
          });
          expect(
            await repository.listResourceFavorites(
              "org_default",
              "user_dev_admin",
            ),
          ).toEqual([favorite]);
          expect(
            await repository.deleteResourceFavorite(favorite.id),
          ).toMatchObject({ id: favorite.id });
          expect(
            await repository.deleteResourceFavorite(favorite.id),
          ).toBeUndefined();

          const folder = await repository.createWorkspaceFolder({
            id: "workspace_folder_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            name: "Shared",
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T12:23:00.000Z",
            updatedAt: "2026-06-30T12:23:00.000Z",
          });
          expect(await repository.getWorkspaceFolder(folder.id)).toEqual(
            folder,
          );
          expect(
            await repository.listWorkspaceFolders(
              "org_default",
              "workspace_default",
            ),
          ).toEqual([folder]);
          const updatedFolder = await repository.updateWorkspaceFolder({
            ...folder,
            name: "Shared Updated",
            meta: { icon: "folder" },
            data: { color: "blue" },
            isExpanded: true,
            updatedAt: "2026-06-30T12:23:30.000Z",
          });
          expect(updatedFolder).toMatchObject({
            id: folder.id,
            name: "Shared Updated",
            meta: { icon: "folder" },
            data: { color: "blue" },
            isExpanded: true,
          });

          const folderItem = await repository.createWorkspaceFolderItem({
            id: "workspace_folder_item_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            folderId: updatedFolder.id,
            resourceType: "chat",
            resourceId: runtime.chatId,
            createdAt: "2026-06-30T12:24:00.000Z",
          });
          expect(
            await repository.listWorkspaceFolderItems(updatedFolder.id),
          ).toEqual([folderItem]);
          expect(
            await repository.deleteWorkspaceFolderItem(folderItem.id),
          ).toMatchObject({ id: folderItem.id });
          expect(
            await repository.deleteWorkspaceFolderItem(folderItem.id),
          ).toBeUndefined();
          expect(
            await repository.deleteWorkspaceFolder(updatedFolder.id),
          ).toMatchObject({ id: updatedFolder.id });
          expect(
            await repository.deleteWorkspaceFolder(updatedFolder.id),
          ).toBeUndefined();

          const deletionFile = await repository.createFileObject({
            id: "file_data_deletion_conformance",
            orgId: "org_default",
            workspaceId: "workspace_default",
            ownerType: "user",
            ownerId: "user_dev_admin",
            fileName: "deletion.txt",
            mimeType: "text/plain",
            sizeBytes: 12,
            sha256:
              "6a7de7f86acce93a7d1a6d4a167d4733cf8b50153a483320df0f3f2f6f8514ca",
            objectKey:
              "files/org_default/workspace_default/file_data_deletion_conformance/deletion.txt",
            purpose: "general",
            status: "uploading",
            metadata: {
              partCount: 2,
              partSizeBytes: 6,
              uploadMode: "resumable_backend_composed",
            },
            createdAt: "2026-06-30T12:25:00.000Z",
            updatedAt: "2026-06-30T12:25:00.000Z",
          });
          await repository.createResourceGrant({
            id: "grant_file_data_deletion_conformance",
            resourceType: "file",
            resourceId: deletionFile.id,
            principalType: "user",
            principalId: "user_dev_admin",
            permission: "write",
          });
          expect(
            await repository.getDataDeletionPlan(
              "org_default",
              "file_object",
              deletionFile.id,
            ),
          ).toMatchObject({
            resourceId: deletionFile.id,
            resourceType: "file_object",
            counts: {
              fileObjects: 1,
              objectStoreObjects: 3,
              objectStoreBytes: 12,
              resourceGrants: 1,
            },
          });
          expect(
            await repository.deleteDataForResource(
              "org_default",
              "file_object",
              deletionFile.id,
            ),
          ).toMatchObject({
            resourceId: deletionFile.id,
            resourceType: "file_object",
          });
          expect(await repository.getFileObject(deletionFile.id)).toMatchObject(
            {
              id: deletionFile.id,
              status: "deleted",
              fileName: "deleted",
              sizeBytes: 0,
              metadata: { contentPurged: true },
            },
          );

          const deletionSource = await repository.createKnowledgeSource({
            id: "source_data_deletion_conformance",
            knowledgeBaseId: "kb_default",
            orgId: "org_default",
            workspaceId: "workspace_default",
            fileName: "source-delete.md",
            mimeType: "text/markdown",
            sizeBytes: 23,
            status: "indexed",
            objectKey:
              "knowledge/kb_default/source_data_deletion_conformance/source-delete.md",
            metadata: {},
            chunkCount: 1,
            contentHash: "source_delete_hash",
            indexedAt: "2026-06-30T12:26:00.000Z",
            createdAt: "2026-06-30T12:26:00.000Z",
            updatedAt: "2026-06-30T12:26:00.000Z",
          });
          await repository.createKnowledgeChunks([
            {
              id: "chunk_data_deletion_conformance",
              knowledgeBaseId: "kb_default",
              sourceId: deletionSource.id,
              orgId: "org_default",
              workspaceId: "workspace_default",
              sequence: 0,
              content: "source delete chunk text",
              tokenCount: 4,
              metadata: {},
              createdAt: "2026-06-30T12:26:00.000Z",
            },
          ]);
          await repository.upsertKnowledgeChunkEmbeddings([
            {
              id: "embedding_data_deletion_conformance",
              knowledgeBaseId: "kb_default",
              sourceId: deletionSource.id,
              chunkId: "chunk_data_deletion_conformance",
              orgId: "org_default",
              workspaceId: "workspace_default",
              embeddingProvider: "provider_ollama",
              embeddingModel: "nomic-embed-text",
              dimensions: 1536,
              embedding: Array.from({ length: 1536 }, () => 0),
              metadata: {},
              createdAt: "2026-06-30T12:26:00.000Z",
              updatedAt: "2026-06-30T12:26:00.000Z",
            },
          ]);
          expect(
            await repository.getDataDeletionPlan(
              "org_default",
              "knowledge_source",
              deletionSource.id,
            ),
          ).toMatchObject({
            resourceId: deletionSource.id,
            resourceType: "knowledge_source",
            knowledgeBaseId: "kb_default",
            counts: {
              knowledgeSources: 1,
              knowledgeChunks: 1,
              knowledgeEmbeddings: 1,
              objectStoreObjects: 1,
              objectStoreBytes: 23,
            },
          });

          expect(
            await repository.getDataDeletionPlan(
              "org_default",
              "chat",
              runtime.chatId,
            ),
          ).toMatchObject({
            resourceId: runtime.chatId,
            resourceType: "chat",
          });
          expect(
            await repository.deleteDataForResource(
              "org_default",
              "chat",
              runtime.chatId,
            ),
          ).toMatchObject({
            resourceId: runtime.chatId,
            resourceType: "chat",
          });
          expect(await repository.getChat(runtime.chatId)).toBeUndefined();
        });
      });

      it("preserves operational metadata lifecycle and retention deletion", async () => {
        await withRepository(subject, async (repository) => {
          await repository.createAuditLog({
            id: "audit_old",
            orgId: "org_default",
            actorId: "user_dev_admin",
            action: "agent.update",
            resourceType: "agent",
            resourceId: "agent_default",
            outcome: "success",
            metadata: { changedKeys: ["name"] },
            createdAt: "2026-06-30T12:00:00.000Z",
          });
          await repository.createAuditLog({
            id: "audit_new",
            orgId: "org_default",
            actorId: "user_dev_admin",
            action: "agent.publish",
            resourceType: "agent",
            resourceId: "agent_default",
            outcome: "success",
            metadata: { version: 2 },
            createdAt: "2026-06-30T12:01:00.000Z",
          });
          expect(
            (await repository.listAuditLogs("org_default")).map(
              (item) => item.id,
            ),
          ).toEqual(["audit_new", "audit_old"]);
          expect(
            await repository.deleteAuditLogsBefore(
              "org_default",
              "2026-06-30T12:01:00.000Z",
            ),
          ).toBe(1);
          expect(
            (await repository.listAuditLogs("org_default")).map(
              (item) => item.id,
            ),
          ).toEqual(["audit_new"]);

          expect(
            await repository.getSystemSetting(
              "auth_provider_settings.global.v1",
            ),
          ).toBeUndefined();
          const createdSetting = await repository.upsertSystemSetting({
            key: "auth_provider_settings.global.v1",
            value: {
              version: 1,
              providers: {
                keycloak: {
                  enabled: true,
                  secretRef: "env://KEYCLOAK_CLIENT_SECRET",
                },
              },
            },
            updatedAt: "2026-07-01T00:00:00.000Z",
          });
          expect(createdSetting).toMatchObject({
            key: "auth_provider_settings.global.v1",
            value: {
              version: 1,
              providers: {
                keycloak: {
                  enabled: true,
                  secretRef: "env://KEYCLOAK_CLIENT_SECRET",
                },
              },
            },
          });
          expect(
            await repository.upsertSystemSetting({
              key: createdSetting.key,
              value: {
                version: 1,
                providers: {
                  keycloak: {
                    enabled: true,
                    orgOverridesAllowed: true,
                  },
                },
              },
              updatedAt: "2026-07-01T00:01:00.000Z",
            }),
          ).toMatchObject({
            key: "auth_provider_settings.global.v1",
            updatedAt: "2026-07-01T00:01:00.000Z",
            value: {
              version: 1,
              providers: {
                keycloak: {
                  enabled: true,
                  orgOverridesAllowed: true,
                },
              },
            },
          });
          expect(
            await repository.getSystemSetting(createdSetting.key),
          ).toMatchObject({
            updatedAt: "2026-07-01T00:01:00.000Z",
            value: {
              version: 1,
              providers: {
                keycloak: {
                  enabled: true,
                  orgOverridesAllowed: true,
                },
              },
            },
          });
          expect(
            (await repository.listSystemSettings()).some(
              (setting) => setting.key === createdSetting.key,
            ),
          ).toBe(true);

          await repository.createUsageEvent({
            id: "usage_throughput",
            orgId: "org_default",
            workspaceId: "workspace_default",
            actorId: "user_dev_admin",
            sourceType: "run",
            sourceId: "run_1",
            metric: "run.output_throughput",
            quantity: 256.5,
            unit: "token_per_second",
            metadata: { providerId: "provider_1" },
            createdAt: "2026-06-30T12:02:00.000Z",
          });
          expect(
            await repository.listUsageEvents("org_default"),
          ).toContainEqual(
            expect.objectContaining({
              id: "usage_throughput",
              metadata: { providerId: "provider_1" },
              quantity: 256.5,
              workspaceId: "workspace_default",
            }),
          );
          expect(
            await repository.updateUsageEvent({
              id: "usage_throughput",
              orgId: "org_default",
              workspaceId: "workspace_default",
              actorId: "user_dev_admin",
              sourceType: "run",
              sourceId: "run_1",
              metric: "run.output_throughput",
              quantity: 512.25,
              unit: "token_per_second",
              metadata: { providerId: "provider_1", redacted: true },
              createdAt: "2026-06-30T12:02:00.000Z",
            }),
          ).toMatchObject({
            id: "usage_throughput",
            quantity: 512.25,
            metadata: { providerId: "provider_1", redacted: true },
          });

          const job = await repository.createBackgroundJob({
            id: "job_connector_sync",
            orgId: "org_default",
            type: "data_connector.sync",
            status: "queued",
            payload: { connectorId: "connector_1" },
            createdAt: "2026-06-30T12:03:00.000Z",
            updatedAt: "2026-06-30T12:03:00.000Z",
          });
          expect(await repository.listBackgroundJobs("org_default")).toEqual([
            job,
          ]);
          expect(
            await repository.updateBackgroundJob({
              ...job,
              payload: { ...job.payload, reviewed: true },
              updatedAt: "2026-06-30T12:03:30.000Z",
            }),
          ).toMatchObject({ payload: { reviewed: true } });
          const claimed = await repository.claimBackgroundJob({
            orgId: "org_default",
            type: "data_connector.sync",
            workerId: "svc_worker",
            leaseSeconds: 300,
            now: "2026-06-30T12:04:00.000Z",
          });
          expect(claimed).toMatchObject({
            id: job.id,
            status: "running",
            payload: {
              workerLease: {
                attempt: 1,
                claimedAt: "2026-06-30T12:04:00.000Z",
                expiresAt: "2026-06-30T12:09:00.000Z",
                leaseSeconds: 300,
                renewedAt: "2026-06-30T12:04:00.000Z",
                workerId: "svc_worker",
              },
            },
          });
          expect(
            await repository.claimBackgroundJob({
              orgId: "org_default",
              type: "data_connector.sync",
              workerId: "svc_other",
              leaseSeconds: 300,
              now: "2026-06-30T12:05:00.000Z",
            }),
          ).toBeUndefined();
          const renewed = await repository.renewBackgroundJobLease({
            orgId: "org_default",
            jobId: job.id,
            workerId: "svc_worker",
            leaseSeconds: 600,
            now: "2026-06-30T12:05:00.000Z",
          });
          expect(renewed).toMatchObject({
            id: job.id,
            status: "running",
            payload: {
              workerLease: {
                attempt: 1,
                expiresAt: "2026-06-30T12:15:00.000Z",
                leaseSeconds: 600,
                renewedAt: "2026-06-30T12:05:00.000Z",
                workerId: "svc_worker",
              },
            },
          });
          expect(
            await repository.updateBackgroundJobWithLease({
              workerId: "svc_other",
              now: "2026-06-30T12:06:00.000Z",
              job: {
                ...(renewed ?? job),
                status: "completed",
                updatedAt: "2026-06-30T12:06:00.000Z",
                completedAt: "2026-06-30T12:06:00.000Z",
              },
            }),
          ).toBeUndefined();
          expect(
            await repository.updateBackgroundJobWithLease({
              workerId: "svc_worker",
              now: "2026-06-30T12:06:00.000Z",
              job: {
                ...(renewed ?? job),
                status: "completed",
                updatedAt: "2026-06-30T12:06:00.000Z",
                completedAt: "2026-06-30T12:06:00.000Z",
              },
            }),
          ).toMatchObject({
            completedAt: "2026-06-30T12:06:00.000Z",
            status: "completed",
          });

          await repository.createBackgroundJob({
            id: "job_dispatch_external_payload",
            orgId: "org_default",
            type: "tool.operation.dispatch_request",
            status: "queued",
            payload: {
              payloadStorage: "external_worker_secret_store_required",
            },
            createdAt: "2026-06-30T12:07:00.000Z",
            updatedAt: "2026-06-30T12:07:00.000Z",
          });
          await repository.createBackgroundJob({
            id: "job_dispatch_managed_payload",
            orgId: "org_default",
            type: "tool.operation.dispatch_request",
            status: "queued",
            payload: { payloadStorage: "managed_encrypted_object_store" },
            createdAt: "2026-06-30T12:08:00.000Z",
            updatedAt: "2026-06-30T12:08:00.000Z",
          });
          expect(
            await repository.claimBackgroundJob({
              orgId: "org_default",
              type: "tool.operation.dispatch_request",
              workerId: "svc_payload_worker",
              leaseSeconds: 300,
              payloadEquals: {
                payloadStorage: "managed_encrypted_object_store",
              },
              now: "2026-06-30T12:09:00.000Z",
            }),
          ).toMatchObject({
            id: "job_dispatch_managed_payload",
            status: "running",
          });
        });
      });

      it("preserves webhook subscription and delivery lifecycle", async () => {
        await withRepository(subject, async (repository) => {
          const subscription = await repository.createWebhookSubscription({
            id: "webhook_sub_conformance",
            orgId: "org_default",
            url: "https://hooks.example.com/romeo",
            eventTypes: ["run.completed", "webhook.test"],
            createdBy: "user_dev_admin",
            createdAt: "2026-06-30T13:00:00.000Z",
            updatedAt: "2026-06-30T13:00:00.000Z",
          });
          expect(
            await repository.getWebhookSubscription(subscription.id),
          ).toEqual(subscription);
          expect(
            await repository.listWebhookSubscriptions("org_default"),
          ).toEqual([subscription]);
          expect(
            await repository.updateWebhookSubscription({
              ...subscription,
              disabledAt: "2026-06-30T13:01:00.000Z",
              updatedAt: "2026-06-30T13:01:00.000Z",
            }),
          ).toMatchObject({ disabledAt: "2026-06-30T13:01:00.000Z" });

          const delivery = await repository.createWebhookDelivery({
            id: "webhook_delivery_conformance",
            orgId: "org_default",
            subscriptionId: subscription.id,
            eventType: "run.completed",
            payload: { runId: "run_1" },
            status: "pending",
            attemptCount: 0,
            createdAt: "2026-06-30T13:02:00.000Z",
            updatedAt: "2026-06-30T13:02:00.000Z",
          });
          expect(
            await repository.createWebhookDelivery({
              ...delivery,
              payload: { runId: "must_not_replace_existing_delivery" },
            }),
          ).toEqual(delivery);
          expect(
            await repository.updateWebhookDelivery({
              ...delivery,
              attemptCount: 1,
              errorCode: "provider_timeout",
              nextAttemptAt: "2026-06-30T13:10:00.000Z",
              responseStatus: 504,
              status: "failed",
              updatedAt: "2026-06-30T13:03:00.000Z",
            }),
          ).toMatchObject({
            attemptCount: 1,
            errorCode: "provider_timeout",
            responseStatus: 504,
            status: "failed",
          });
          expect(
            await repository.listWebhookDeliveries(
              "org_default",
              subscription.id,
            ),
          ).toHaveLength(1);
        });
      });

      it("preserves governance, billing, quota, and voice upsert semantics", async () => {
        await withRepository(subject, async (repository) => {
          expect(
            await repository.upsertRetentionPolicy({
              orgId: "org_default",
              auditLogRetentionDays: 365,
              fileRetentionDays: null,
              workspaceFileRetentionDays: {},
              userFileRetentionDays: {},
              updatedBy: "user_dev_admin",
              updatedAt: "2026-06-30T14:00:00.000Z",
            }),
          ).toMatchObject({ auditLogRetentionDays: 365 });
          expect(
            await repository.upsertRetentionPolicy({
              orgId: "org_default",
              auditLogRetentionDays: 180,
              fileRetentionDays: 90,
              workspaceFileRetentionDays: { workspace_default: 30 },
              userFileRetentionDays: { user_dev_admin: null },
              updatedBy: "user_dev_admin",
              updatedAt: "2026-06-30T14:01:00.000Z",
            }),
          ).toMatchObject({ auditLogRetentionDays: 180 });
          expect(
            await repository.getRetentionPolicy("org_default"),
          ).toMatchObject({ auditLogRetentionDays: 180 });

          await repository.upsertBillingPlan({
            id: "billing_plan_conformance",
            orgId: "org_default",
            code: "enterprise",
            name: "Enterprise",
            status: "trialing",
            source: "manual",
            quotaTemplates: [
              { metric: "run.started", limit: 1000, resetInterval: "monthly" },
            ],
            metadata: { salesAssisted: true },
            createdAt: "2026-06-30T14:02:00.000Z",
            updatedAt: "2026-06-30T14:02:00.000Z",
          });
          expect(await repository.getBillingPlan("org_default")).toMatchObject({
            code: "enterprise",
            metadata: { salesAssisted: true },
          });

          const bucket = await repository.createQuotaBucket({
            id: "quota_bucket_conformance",
            orgId: "org_default",
            scopeType: "workspace",
            scopeId: "workspace_default",
            metric: "run.started",
            limit: 100,
            used: 10,
            resetInterval: "daily",
            resetAt: "2026-07-01T00:00:00.000Z",
            createdAt: "2026-06-30T14:03:00.000Z",
            updatedAt: "2026-06-30T14:03:00.000Z",
          });
          expect(
            await repository.listQuotaBuckets("org_default"),
          ).toContainEqual(bucket);
          expect(
            await repository.updateQuotaBucket({
              ...bucket,
              used: 11,
              updatedAt: "2026-06-30T14:04:00.000Z",
            }),
          ).toMatchObject({ used: 11 });
          expect(await repository.deleteQuotaBucket(bucket.id)).toMatchObject({
            id: bucket.id,
          });
          expect(await repository.deleteQuotaBucket(bucket.id)).toBeUndefined();

          const voice = await repository.createVoiceProfile({
            id: "voice_conformance",
            orgId: "org_default",
            providerId: "provider_voices",
            providerVoiceId: "narrator",
            name: "Narrator",
            language: "en-US",
            styleTags: ["calm"],
            cloningAllowed: false,
            enabled: true,
            createdAt: "2026-06-30T14:05:00.000Z",
            updatedAt: "2026-06-30T14:05:00.000Z",
          });
          expect(await repository.getVoiceProfile(voice.id)).toEqual(voice);
          expect(
            await repository.createVoiceProfile({
              ...voice,
              id: "voice_conformance_duplicate",
              name: "Narrator Updated",
              styleTags: ["calm", "studio"],
            }),
          ).toMatchObject({
            id: voice.id,
            name: "Narrator Updated",
            styleTags: ["calm", "studio"],
          });
          expect(
            (await repository.listVoiceProfiles("org_default")).filter(
              (item) => item.providerVoiceId === "narrator",
            ),
          ).toHaveLength(1);
        });
      });
    });
  }
});

describe("live Postgres API readiness smoke", () => {
  if (livePostgresUrl === undefined) {
    it.skip(`runs when ${POSTGRES_CONFORMANCE_DATABASE_URL_ENV} is set`, () =>
      undefined);
  } else {
    it("passes production readiness through the API on a migrated Postgres repository", async () => {
      const fixture =
        await createLivePostgresRepositoryFixture(livePostgresUrl);
      try {
        await seedReadinessData(fixture.repository);
        const devApi = createRomeoApi(fixture.repository, {
          startBackgroundWorkers: false,
        });
        const keyResponse = await devApi.request("/api/v1/api-keys", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            name: "Postgres readiness smoke",
            scopes: ["admin:read"],
          }),
        });
        const key = await keyResponse.json();
        const api = createRomeoApi(fixture.repository, {
          env: readEnv({
            DATABASE_URL: fixture.databaseUrl,
            DEV_SEEDED_LOGIN: "false",
            LOCAL_AUTH_SECRET_ENCRYPTION_KEY:
              "prod-local-auth-secret-key-32-bytes",
            OBJECT_STORE_DRIVER: "s3",
            REPOSITORY_DRIVER: "postgres",
            SESSION_SECRET: "prod-session-secret-32-bytes-long",
            WEBHOOK_SIGNING_KEY: "prod-webhook-signing-key-32-bytes",
          }),
          startBackgroundWorkers: false,
        });
        const response = await api.request("/api/v1/admin/readiness", {
          headers: { authorization: `Bearer ${key.data.token}` },
        });
        const body = await response.json();

        expect(keyResponse.status).toBe(201);
        expect(response.status).toBe(200);
        expect(
          body.data.checks.filter(
            (check: { status: string }) => check.status !== "pass",
          ),
        ).toEqual([]);
        expect(body.data.status).toBe("ready");
        expect(
          body.data.checks.every(
            (check: { status: string }) => check.status === "pass",
          ),
        ).toBe(true);
      } finally {
        await fixture.close();
      }
    });
  }
});

describe("live Postgres queued-turn API concurrency", () => {
  if (livePostgresUrl === undefined) {
    it.skip(`runs when ${POSTGRES_CONFORMANCE_DATABASE_URL_ENV} is set`, () =>
      undefined);
  } else {
    it("preserves API queue races and expired-lease recovery across workers", async () => {
      const fixture =
        await createLivePostgresRepositoryFixture(livePostgresUrl);
      try {
        const graph = await seedRuntimeGraph(fixture.repository, "queue_api");
        await fixture.repository.createRun({
          id: "run_queue_api_blocker",
          orgId: "org_default",
          workspaceId: "workspace_default",
          chatId: graph.chatId,
          agentId: graph.agentId,
          agentVersionId: graph.agentVersionId,
          modelId: graph.modelId,
          providerId: graph.providerId,
          status: "running",
          createdBy: "user_dev_admin",
          createdAt: new Date().toISOString(),
        });
        const firstApi = createRomeoApi(fixture.repository, {
          startBackgroundWorkers: false,
        });
        const secondApi = createRomeoApi(fixture.repository, {
          startBackgroundWorkers: false,
        });
        const enqueue = (
          api: ReturnType<typeof createRomeoApi>,
          suffix: string,
        ) =>
          api.request(`/api/v1/chats/${graph.chatId}/queue`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              agentId: graph.agentId,
              content: `Postgres queue ${suffix}`,
              idempotencyKey: `postgres-queue-${suffix}`,
            }),
          });
        const [firstResponse, secondResponse] = await Promise.all([
          enqueue(firstApi, "first"),
          enqueue(secondApi, "second"),
        ]);
        const [first, second] = await Promise.all([
          firstResponse.json(),
          secondResponse.json(),
        ]);

        expect(firstResponse.status).toBe(202);
        expect(secondResponse.status).toBe(202);
        const claims = await Promise.all([
          fixture.repository.claimNextQueuedChatTurn({
            chatId: graph.chatId,
            leaseOwner: "postgres_api_worker_1",
            leaseToken: "postgres_api_lease_1",
            now: "2099-07-16T12:01:00.000Z",
            leaseExpiresAt: "2099-07-16T12:02:00.000Z",
          }),
          fixture.repository.claimNextQueuedChatTurn({
            chatId: graph.chatId,
            leaseOwner: "postgres_api_worker_2",
            leaseToken: "postgres_api_lease_2",
            now: "2099-07-16T12:01:00.000Z",
            leaseExpiresAt: "2099-07-16T12:02:00.000Z",
          }),
        ]);
        const claimed = claims.find((claim) => claim !== undefined);
        expect(claims.filter((claim) => claim !== undefined)).toHaveLength(1);
        expect([first.data.id, second.data.id]).toContain(claimed?.id);

        const blockedCancellation = await secondApi.request(
          `/api/v1/chats/${graph.chatId}/queue/${claimed!.id}`,
          { method: "DELETE" },
        );
        expect(blockedCancellation.status).toBe(409);

        const reclaimed = await fixture.repository.claimNextQueuedChatTurn({
          chatId: graph.chatId,
          leaseOwner: "postgres_api_recovery_worker",
          leaseToken: "postgres_api_recovery_lease",
          now: "2099-07-16T12:02:01.000Z",
          leaseExpiresAt: "2099-07-16T12:03:01.000Z",
        });
        expect(reclaimed).toMatchObject({
          id: claimed!.id,
          attemptCount: 2,
          leaseOwner: "postgres_api_recovery_worker",
        });
      } finally {
        await fixture.close();
      }
    });
  }
});

describe("live Postgres portable chat deployment transfer", () => {
  if (livePostgresUrl === undefined) {
    it.skip(`runs when ${POSTGRES_CONFORMANCE_DATABASE_URL_ENV} is set`, () =>
      undefined);
  } else {
    it("round-trips citations and attachment bytes across two clean databases", async () => {
      const [source, target] = await Promise.all([
        createLivePostgresRepositoryFixture(livePostgresUrl),
        createLivePostgresRepositoryFixture(livePostgresUrl),
      ]);
      try {
        const sourceApi = createRomeoApi(source.repository, {
          objectStore: new MemoryObjectStore(),
          startBackgroundWorkers: false,
        });
        const targetApi = createRomeoApi(target.repository, {
          objectStore: new MemoryObjectStore(),
          startBackgroundWorkers: false,
        });
        const attachmentText = "portable deployment attachment sentinel";
        const importedResponse = await sourceApi.request(
          "/api/v1/chats/import",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              workspaceId: "workspace_default",
              title: "Portable deployment source",
              messages: [
                {
                  role: "assistant",
                  content: "Portable cited response",
                  citations: [
                    {
                      chunkId: "portable-chunk",
                      documentId: "portable-document",
                      title: "Portable source",
                      sourceUri: "https://docs.example.invalid/portable",
                      sourceType: "web_search",
                      provider: "controlled-fixture",
                      retrievedAt: "2026-07-17T00:00:00.000Z",
                    },
                  ],
                  attachments: [
                    {
                      fileName: "portable.txt",
                      mimeType: "text/plain",
                      sizeBytes: Buffer.byteLength(attachmentText),
                      dataBase64:
                        Buffer.from(attachmentText).toString("base64"),
                      retainedInContext: true,
                    },
                  ],
                },
              ],
            }),
          },
        );
        const imported = await importedResponse.json();
        const sourceExportResponse = await sourceApi.request(
          `/api/v1/chats/${imported.data.id}/export`,
        );
        const sourceExport = await sourceExportResponse.json();
        const targetImportResponse = await targetApi.request(
          "/api/v1/chats/import",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              workspaceId: "workspace_default",
              title: "Portable deployment target",
              messages: sourceExport.data.messages,
            }),
          },
        );
        const targetImport = await targetImportResponse.json();
        const targetExportResponse = await targetApi.request(
          `/api/v1/chats/${targetImport.data.id}/export`,
        );
        const targetExport = await targetExportResponse.json();

        expect(importedResponse.status).toBe(201);
        expect(sourceExportResponse.status).toBe(200);
        expect(targetImportResponse.status).toBe(201);
        expect(targetExportResponse.status).toBe(200);
        expect(targetExport.data.schema).toBe("romeo.chat-export.v1");
        expect(targetExport.data.messages[0].citations[0]).toMatchObject({
          chunkId: "portable-chunk",
          documentId: "portable-document",
          sourceType: "web_search",
          provider: "controlled-fixture",
        });
        expect(
          Buffer.from(
            targetExport.data.messages[0].attachments[0].dataBase64,
            "base64",
          ).toString(),
        ).toBe(attachmentText);
        expect(
          targetExport.data.messages[0].attachments[0].retainedInContext,
        ).toBe(true);
      } finally {
        await Promise.all([source.close(), target.close()]);
      }
    });
  }
});

async function withRepository(
  subject: RepositorySubject,
  test: (repository: RomeoRepository) => Promise<void>,
): Promise<void> {
  const fixture = await subject.create();
  try {
    await test(fixture.repository);
  } finally {
    await fixture.close?.();
  }
}

interface RuntimeGraphFixture {
  agentId: string;
  agentVersionId: string;
  chatId: string;
  modelId: string;
  providerId: string;
}

async function seedRuntimeGraph(
  repository: RomeoRepository,
  suffix: string,
): Promise<RuntimeGraphFixture> {
  const providerId = `provider_${suffix}_conformance`;
  const modelId = `model_${suffix}_conformance`;
  const agentId = `agent_${suffix}_conformance`;
  const agentVersionId = `agent_version_${suffix}_conformance`;
  const chatId = `chat_${suffix}_conformance`;
  const createdProvider = await repository.createProvider(
    provider(providerId, `Provider ${suffix}`),
  );
  const [createdModel] = await repository.upsertModels([
    model(modelId, createdProvider.id, `${suffix}-model`, `${suffix} Model`),
  ]);
  const agent = await repository.createAgent({
    id: agentId,
    orgId: "org_default",
    workspaceId: "workspace_default",
    name: `${suffix} Agent`,
    createdBy: "user_dev_admin",
    baseModelId: createdModel!.id,
    systemPrompt: "Follow the workspace policy.",
    parameters: { temperature: 0 },
    memoryPolicy: { mode: "disabled" },
    safetySettings: {},
    updatedAt: "2026-06-30T12:00:00.000Z",
  });
  const version = await repository.createAgentVersion({
    id: agentVersionId,
    agentId: agent.id,
    orgId: "org_default",
    workspaceId: "workspace_default",
    version: 1,
    status: "published",
    baseModelId: createdModel!.id,
    systemPrompt: agent.systemPrompt,
    parameters: agent.parameters,
    memoryPolicy: agent.memoryPolicy,
    safetySettings: agent.safetySettings,
    createdBy: "user_dev_admin",
    createdAt: "2026-06-30T12:00:01.000Z",
    publishedAt: "2026-06-30T12:00:01.000Z",
  });
  const chat = await repository.createChat({
    id: chatId,
    orgId: "org_default",
    workspaceId: "workspace_default",
    title: `${suffix} Chat`,
    createdBy: "user_dev_admin",
    updatedAt: "2026-06-30T12:00:02.000Z",
  });

  return {
    agentId: agent.id,
    agentVersionId: version.id,
    chatId: chat.id,
    modelId: createdModel!.id,
    providerId: createdProvider.id,
  };
}

function provider(id: string, name: string) {
  return {
    id,
    orgId: "org_default",
    type: "openai-compatible" as const,
    name,
    baseUrl: `https://${name.toLowerCase()}.example.com/v1`,
    enabled: true,
    capabilities: providerCapabilities(),
  };
}

function model(
  id: string,
  providerId: string,
  name: string,
  displayName: string,
) {
  return {
    id,
    providerId,
    name,
    displayName,
    enabled: true,
    capabilities: providerCapabilities(),
    contextWindow: 8192,
  };
}

async function seedReadinessData(repository: RomeoRepository): Promise<void> {
  await repository.createProvider(provider("provider_readiness", "Readiness"));
  await repository.upsertModels([
    model(
      "model_readiness",
      "provider_readiness",
      "readiness-model",
      "Readiness Model",
    ),
  ]);
  await repository.upsertRetentionPolicy({
    orgId: "org_default",
    auditLogRetentionDays: 365,
    fileRetentionDays: null,
    workspaceFileRetentionDays: {},
    userFileRetentionDays: {},
    updatedBy: "user_dev_admin",
    updatedAt: "2026-06-30T15:00:00.000Z",
  });
  await repository.createQuotaBucket({
    id: "quota_readiness_runs",
    orgId: "org_default",
    scopeType: "org",
    scopeId: "org_default",
    metric: "run.started",
    limit: 1000,
    used: 0,
    resetInterval: "monthly",
    resetAt: "2026-07-01T00:00:00.000Z",
    createdAt: "2026-06-30T15:01:00.000Z",
    updatedAt: "2026-06-30T15:01:00.000Z",
  });
}

function providerCapabilities() {
  return {
    audioInput: false,
    deployment: {
      credentialRequired: true,
      mode: "hosted-api" as const,
      networkAccess: "external-http" as const,
    },
    modalities: ["text" as const],
    reasoning: false,
    streaming: true,
    structuredJson: true,
    toolCalling: true,
    vision: false,
  };
}
