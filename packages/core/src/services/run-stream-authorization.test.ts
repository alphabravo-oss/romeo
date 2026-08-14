import { describe, expect, it, vi } from "vitest";

import type { AuthSubject, ResourceGrant } from "@romeo/auth";
import type { RunEvent } from "@romeo/ai-runtime";

import type { RunRecord, UserSession } from "../domain/entities";
import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { createSeedData } from "../repositories/seed-data";
import { RunAccessService, RunStreamAccessEnded } from "./run-access-service";
import { replayRunEvents } from "./run-events";
import type { RunEventSequencer } from "./run-event-sequencer";

const now = "2026-08-14T12:00:00.000Z";
const memberId = "user_stream_member";
const runId = "run_stream_authorization";
const chatId = "chat_welcome";

describe("long-lived run stream authorization", () => {
  it("terminates with a detail-free error after its session is revoked", async () => {
    const { repository, run } = await setupRepository();
    const session: UserSession = {
      id: "session_stream_secret_identifier",
      orgId: run.orgId,
      userId: memberId,
      name: "browser",
      hashedToken: "never-log-this-session-secret",
      scopes: ["runs:read"],
      isAdmin: false,
      expiresAt: "2099-08-14T12:00:00.000Z",
      createdAt: now,
    };
    await repository.createUserSession(session);
    const subject = memberSubject({ sessionId: session.id });
    const access = new RunAccessService(repository);
    const stream = replayRunEvents(repository, sequencer(), run.id, 0, {
      authorize: () => access.assertCurrentStreamAccess(run.id, subject),
      authorizationRecheckMs: 10,
      fallbackPollMs: 10,
    })[Symbol.asyncIterator]();

    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: { sequence: 1 },
    });
    await repository.updateUserSession({
      ...session,
      revokedAt: "2026-08-14T12:00:01.000Z",
    });

    const error = await stream.next().catch((cause: unknown) => cause);
    expect(error).toBeInstanceOf(RunStreamAccessEnded);
    expect(error).toMatchObject({
      code: "run_stream_access_ended",
      message: "Run stream access ended.",
    });
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("terminates after its API key is revoked", async () => {
    const { repository, run } = await setupRepository();
    const apiKey = await repository.createApiKey({
      id: "api_key_stream_secret_identifier",
      orgId: run.orgId,
      userId: memberId,
      name: "stream key",
      hashedToken: "never-log-this-api-key-secret",
      scopes: ["runs:read"],
      createdAt: now,
    });
    const access = new RunAccessService(repository);
    const stream = replayRunEvents(repository, sequencer(), run.id, 0, {
      authorize: () =>
        access.assertCurrentStreamAccess(
          run.id,
          memberSubject({ apiKeyId: apiKey.id }),
        ),
      authorizationRecheckMs: 10,
      fallbackPollMs: 10,
    })[Symbol.asyncIterator]();

    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: { sequence: 1 },
    });
    await repository.updateApiKey({
      ...apiKey,
      revokedAt: "2026-08-14T12:00:01.000Z",
    });

    const error = await stream.next().catch((cause: unknown) => cause);
    expect(error).toMatchObject({
      code: "run_stream_access_ended",
      message: "Run stream access ended.",
    });
    expect(JSON.stringify(error)).not.toContain("secret");
  });

  it("terminates after a live chat grant is removed", async () => {
    const { repository, run, chatGrant } = await setupRepository();
    const subject = memberSubject();
    const access = new RunAccessService(repository);
    const stream = replayRunEvents(repository, sequencer(), run.id, 0, {
      authorize: () => access.assertCurrentStreamAccess(run.id, subject),
      authorizationRecheckMs: 10,
      fallbackPollMs: 10,
    })[Symbol.asyncIterator]();

    await expect(stream.next()).resolves.toMatchObject({
      done: false,
      value: { sequence: 1 },
    });
    await repository.deleteResourceGrant(chatGrant.id);

    await expect(stream.next()).rejects.toMatchObject({
      code: "run_stream_access_ended",
      message: "Run stream access ended.",
    });
  });

  it("checks authorization by cadence rather than once per replayed event", async () => {
    const events: RunEvent[] = Array.from({ length: 32 }, (_, index) => ({
      id: `evt_${index + 1}`,
      runId,
      sequence: index + 1,
      type: index === 31 ? "run.completed" : "message.delta",
      createdAt: now,
      data: {},
    }));
    const repository = {
      listRunEventsAfter: vi.fn(async (_runId, after, limit) =>
        events.filter((event) => event.sequence > after).slice(0, limit),
      ),
    } as unknown as InMemoryRomeoRepository;
    const authorize = vi.fn(async () => undefined);
    const received: RunEvent[] = [];

    for await (const event of replayRunEvents(
      repository,
      sequencer(),
      runId,
      0,
      { authorize, authorizationRecheckMs: 30_000, pageSize: 4 },
    ))
      received.push(event);

    expect(received).toHaveLength(32);
    expect(authorize).toHaveBeenCalledOnce();
  });
});

async function setupRepository(): Promise<{
  chatGrant: ResourceGrant;
  repository: InMemoryRomeoRepository;
  run: RunRecord;
}> {
  const seed = createSeedData(now);
  seed.users.push({
    id: memberId,
    orgId: "org_default",
    email: "stream-member@example.test",
    name: "Stream Member",
    role: "user",
  });
  const workspaceGrant: ResourceGrant = {
    id: "grant_stream_workspace",
    resourceType: "workspace",
    resourceId: "workspace_default",
    principalType: "user",
    principalId: memberId,
    permission: "read",
  };
  const chatGrant: ResourceGrant = {
    id: "grant_stream_chat",
    resourceType: "chat",
    resourceId: chatId,
    principalType: "user",
    principalId: memberId,
    permission: "read",
  };
  seed.grants.push(workspaceGrant, chatGrant);
  const repository = new InMemoryRomeoRepository(seed);
  const run: RunRecord = {
    id: runId,
    orgId: "org_default",
    workspaceId: "workspace_default",
    chatId,
    agentId: "agent_default",
    agentVersionId: "agent_version_default_v1",
    modelId: "model_openai_compatible_default",
    providerId: "provider_openai_compatible",
    status: "running",
    createdBy: "user_dev_admin",
    createdAt: now,
  };
  await repository.createRun(run);
  await repository.appendRunEvents([
    {
      id: "evt_stream_1",
      runId,
      sequence: 1,
      type: "message.delta",
      createdAt: now,
      data: {},
    },
  ]);
  return { chatGrant, repository, run };
}

function memberSubject(
  identifiers: Pick<AuthSubject, "apiKeyId" | "sessionId"> = {},
): AuthSubject {
  return {
    id: memberId,
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: [],
    scopes: ["runs:read"],
    isAdmin: false,
    ...identifiers,
  };
}

function sequencer(): RunEventSequencer {
  return {
    subscribe: async () => () => undefined,
  } as unknown as RunEventSequencer;
}
