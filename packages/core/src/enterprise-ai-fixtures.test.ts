import { createHash } from "node:crypto";

import {
  hasGrant,
  seededSubject,
  type AuthSubject,
  type ResourceGrant,
  type ResourceType,
} from "@romeo/auth";
import type { RunEvent, RunEventType } from "@romeo/ai-runtime";
import { defaultProviderCapabilities } from "@romeo/providers";
import { describe, expect, it } from "vitest";

import fixtures from "../../../test/fixtures/enterprise-ai-fixtures.json";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { ContentPolicyService } from "./services/content-policy-service";

describe("shared enterprise AI fixture corpus", () => {
  it("exercises model, media, ACL, streaming, DLP and compute boundaries in memory", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = "2026-08-14T12:00:00.000Z";
    const primaryModel = fixtures.models[0]!;

    const providerCapabilities = defaultProviderCapabilities("ollama");
    await repository.createProvider({
      id: primaryModel.providerId,
      orgId: seededSubject.orgId,
      type: "ollama",
      name: "Synthetic fixture provider",
      baseUrl: "http://localhost:11434",
      enabled: true,
      capabilities: providerCapabilities,
    });
    await repository.upsertModels(
      fixtures.models.map((model) => ({
        id: model.id,
        providerId: model.providerId,
        name: model.name,
        displayName: model.name,
        enabled: true,
        capabilities: {
          ...providerCapabilities,
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
    expect(
      (await repository.listModels(seededSubject.orgId)).filter((model) =>
        model.id.startsWith("fx_"),
      ),
    ).toHaveLength(fixtures.models.length);

    for (const media of fixtures.media) {
      const bytes = Buffer.from(media.payloadBase64, "base64");
      await repository.createFileObject({
        id: media.id,
        orgId: seededSubject.orgId,
        workspaceId: seededSubject.workspaceIds[0]!,
        ownerType: seededSubject.type,
        ownerId: seededSubject.id,
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
      expect(createHash("sha256").update(bytes).digest("hex")).toBe(
        media.sha256,
      );
      expect(await repository.getFileObject(media.id)).toMatchObject({
        id: media.id,
        sizeBytes: bytes.length,
        sha256: media.sha256,
      });
    }

    const resource = fixtures.acl.resources[0]!;
    for (const testCase of fixtures.acl.cases) {
      const subject: AuthSubject = {
        id: testCase.subjectId,
        type: "user",
        orgId: testCase.subjectOrgId,
        workspaceIds: testCase.subjectWorkspaceIds,
        groupIds: testCase.subjectGroupIds,
        scopes: [],
      };
      const tenantAllowed =
        subject.orgId === resource.orgId &&
        subject.workspaceIds.includes(resource.workspaceId);
      const granted = hasGrant(
        subject,
        fixtures.acl.grants as ResourceGrant[],
        resource.type as ResourceType,
        resource.id,
        testCase.permission as ResourceGrant["permission"],
      );
      expect(tenantAllowed && granted).toBe(testCase.expectedAllowed);
    }

    const stream = fixtures.streaming[0]!;
    await repository.createRun({
      id: stream.runId,
      orgId: seededSubject.orgId,
      workspaceId: seededSubject.workspaceIds[0]!,
      chatId: "chat_welcome",
      agentId: "agent_default",
      agentVersionId: "agent_version_default",
      modelId: primaryModel.id,
      providerId: primaryModel.providerId,
      status: "running",
      createdBy: seededSubject.id,
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
      subject: seededSubject,
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
        subject: seededSubject,
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
      orgId: seededSubject.orgId,
      workspaceId: seededSubject.workspaceIds[0]!,
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
      (await repository.listBackgroundJobs(seededSubject.orgId)).find(
        (job) => job.id === compute.id,
      ),
    ).toMatchObject({
      id: compute.id,
      payload: {
        networkPolicy: "none",
        limits: compute.limits,
      },
    });

    const serializedEvidence = JSON.stringify({
      files: await repository.listFileObjects(seededSubject.orgId),
      jobs: await repository.listBackgroundJobs(seededSubject.orgId),
      streams: await repository.listRunEvents(stream.runId),
    });
    for (const testCase of fixtures.dlp)
      expect(serializedEvidence).not.toContain(testCase.segments.join(""));
  });
});
