import {
  ContentPolicyService,
  InMemoryRomeoRepository,
  type RunEvent,
  type RunEventType,
  type RomeoRepository,
} from "@romeo/core";
import { defaultProviderCapabilities } from "@romeo/providers";
import { describe, expect, it } from "vitest";

import fixtures from "../../../test/fixtures/enterprise-ai-fixtures.json";
import {
  createLivePostgresRepositoryFixture,
  POSTGRES_CONFORMANCE_DATABASE_URL_ENV,
  postgresConformanceDatabaseUrl,
} from "./test-support/postgres-conformance-harness";

interface RepositorySubject {
  name: string;
  create: () => Promise<{
    repository: RomeoRepository;
    close?: () => Promise<void>;
  }>;
}

const livePostgresUrl = postgresConformanceDatabaseUrl();
const fixtureSubject: Parameters<ContentPolicyService["update"]>[0]["subject"] =
  {
    id: "user_dev_admin",
    type: "user",
    email: "admin@romeo.local",
    name: "Romeo Admin",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["admin:read", "admin:write"],
    isAdmin: true,
    adminRole: "global_admin",
  };
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

describe("enterprise AI fixture repository parity", () => {
  if (livePostgresUrl === undefined) {
    it.skip(`runs live Postgres fixtures when ${POSTGRES_CONFORMANCE_DATABASE_URL_ENV} is set`, () =>
      undefined);
  }

  for (const subject of subjects) {
    it(`${subject.name} persists the shared model, media, ACL, stream, DLP and compute corpus`, async () => {
      const fixture = await subject.create();
      try {
        await exerciseFixtureCorpus(fixture.repository);
      } finally {
        await fixture.close?.();
      }
    });
  }
});

async function exerciseFixtureCorpus(repository: RomeoRepository) {
  const now = "2026-08-14T13:00:00.000Z";
  const capabilities = defaultProviderCapabilities("ollama");
  const firstModel = fixtures.models[0]!;
  await repository.createProvider({
    id: firstModel.providerId,
    orgId: fixtureSubject.orgId,
    type: "ollama",
    name: "Synthetic parity provider",
    baseUrl: "http://localhost:11434",
    enabled: true,
    capabilities,
  });
  const models = await repository.upsertModels(
    fixtures.models.map((model) => ({
      id: model.id,
      providerId: model.providerId,
      name: model.name,
      displayName: model.name,
      enabled: true,
      capabilities: {
        ...capabilities,
        reasoning: model.reasoning,
        toolCalling: model.tools,
        structuredJson: model.structuredOutput,
        vision: model.modalities.includes("image"),
        audioInput: model.modalities.includes("audio"),
        modalities: [
          "text" as const,
          ...(model.modalities.includes("image")
            ? (["vision" as const] as const)
            : []),
          ...(model.modalities.includes("audio")
            ? (["audio-input" as const] as const)
            : []),
        ],
      },
      contextWindow: model.contextWindow,
    })),
  );
  expect(models.map((model) => model.id)).toEqual(
    fixtures.models.map((model) => model.id),
  );

  for (const media of fixtures.media) {
    await repository.createFileObject({
      id: media.id,
      orgId: fixtureSubject.orgId,
      workspaceId: fixtureSubject.workspaceIds[0]!,
      ownerType: fixtureSubject.type,
      ownerId: fixtureSubject.id,
      fileName: media.fileName,
      mimeType: media.mimeType,
      sizeBytes: media.sizeBytes,
      sha256: media.sha256,
      objectKey: `fixtures/${media.id}`,
      purpose: "general",
      status: "available",
      metadata: { fixtureKind: media.kind },
      createdAt: now,
      updatedAt: now,
    });
  }
  expect(
    (await repository.listFileObjects(fixtureSubject.orgId)).filter((file) =>
      file.id.startsWith("fx_media_"),
    ),
  ).toHaveLength(fixtures.media.length);

  const agent = await repository.createAgent({
    id: "fx_agent_stream",
    orgId: fixtureSubject.orgId,
    workspaceId: fixtureSubject.workspaceIds[0]!,
    name: "Synthetic stream agent",
    createdBy: fixtureSubject.id,
    baseModelId: firstModel.id,
    systemPrompt: "Synthetic fixture instruction.",
    parameters: { temperature: 0 },
    memoryPolicy: { mode: "disabled" },
    safetySettings: {},
    updatedAt: now,
  });
  const version = await repository.createAgentVersion({
    id: "fx_agent_version_stream",
    agentId: agent.id,
    orgId: fixtureSubject.orgId,
    workspaceId: fixtureSubject.workspaceIds[0]!,
    version: 1,
    status: "published",
    baseModelId: firstModel.id,
    systemPrompt: agent.systemPrompt,
    parameters: agent.parameters,
    memoryPolicy: agent.memoryPolicy,
    safetySettings: agent.safetySettings,
    createdBy: fixtureSubject.id,
    createdAt: now,
    publishedAt: now,
  });
  const sourceGrant = fixtures.acl.grants[0]!;
  type ResourceGrantInput = Parameters<
    RomeoRepository["createResourceGrant"]
  >[0];
  await repository.createResourceGrant({
    id: sourceGrant.id,
    resourceType:
      sourceGrant.resourceType as ResourceGrantInput["resourceType"],
    resourceId: agent.id,
    principalType:
      sourceGrant.principalType as ResourceGrantInput["principalType"],
    principalId: fixtureSubject.id,
    permission: sourceGrant.permission as ResourceGrantInput["permission"],
    createdAt: now,
  });
  expect(
    await repository.listResourceGrants(fixtureSubject.orgId),
  ).toContainEqual(
    expect.objectContaining({
      resourceId: agent.id,
      principalId: fixtureSubject.id,
      permission: sourceGrant.permission,
    }),
  );

  const stream = fixtures.streaming[0]!;
  await repository.createRun({
    id: stream.runId,
    orgId: fixtureSubject.orgId,
    workspaceId: fixtureSubject.workspaceIds[0]!,
    chatId: "chat_welcome",
    agentId: agent.id,
    agentVersionId: version.id,
    modelId: firstModel.id,
    providerId: firstModel.providerId,
    status: "running",
    createdBy: fixtureSubject.id,
    createdAt: now,
  });
  await repository.appendRunEvents(
    stream.events.map(
      (event): RunEvent => ({
        ...event,
        runId: stream.runId,
        schemaVersion: 1,
        type: event.type as RunEventType,
        createdAt: now,
      }),
    ),
  );
  expect(
    (
      await repository.listRunEventsAfter(
        stream.runId,
        stream.resumeAfterSequence,
        100,
      )
    ).map((event) => event.sequence),
  ).toEqual(stream.expectedReplaySequences);

  const policy = new ContentPolicyService(repository);
  await policy.update({
    subject: fixtureSubject,
    detectors: {
      api_token: "audit",
      credit_card: "audit",
      email_address: "audit",
      us_ssn: "audit",
    },
  });
  for (const testCase of fixtures.dlp) {
    const joined = testCase.segments.join("");
    const result = await policy.simulate({
      subject: fixtureSubject,
      content: joined,
    });
    expect(result.detections).toContainEqual({
      code: testCase.detector,
      count: testCase.expectedCount,
      action: "audit",
    });
    expect(JSON.stringify(result)).not.toContain(joined);
  }

  const compute = fixtures.compute[0]!;
  await repository.createBackgroundJob({
    id: compute.id,
    orgId: fixtureSubject.orgId,
    workspaceId: fixtureSubject.workspaceIds[0]!,
    type: "fixture.compute.contract",
    status: "queued",
    payload: {
      runtime: compute.runtime,
      sourceFragments: compute.sourceFragments,
      networkPolicy: compute.networkPolicy,
      limits: compute.limits,
      expected: compute.expected,
    },
    createdAt: now,
    updatedAt: now,
  });
  expect(
    (await repository.listBackgroundJobs(fixtureSubject.orgId)).find(
      (job) => job.id === compute.id,
    ),
  ).toMatchObject({
    id: compute.id,
    payload: { networkPolicy: "none", limits: compute.limits },
  });
}
