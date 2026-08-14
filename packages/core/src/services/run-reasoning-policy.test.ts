import { describe, expect, it } from "vitest";

import type { RunRecord } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import {
  reasoningPolicyFromUnknown,
  reasoningPolicyLayersForContinuation,
  reasoningPolicyLayersForStart,
  reasoningPolicySettingKey,
} from "./run-reasoning-policy";

describe("run reasoning policy", () => {
  it("builds organization, immutable agent, and per-run layers without merging them", async () => {
    const repository = repositoryFixture({
      setting: {
        key: reasoningPolicySettingKey("org_default"),
        value: {
          policy: { schemaVersion: 1, mode: "auto", effort: "low" },
        },
        updatedAt: "2026-08-14T00:00:00.000Z",
      },
    });

    await expect(
      reasoningPolicyLayersForStart(repository, {
        orgId: "org_default",
        workspaceId: "workspace_default",
        agentParameters: {
          reasoningPolicy: {
            schemaVersion: 1,
            mode: "auto",
            effort: "medium",
          },
        },
        runRequest: { schemaVersion: 1, mode: "off" },
      }),
    ).resolves.toEqual({
      organizationMaximum: {
        schemaVersion: 1,
        mode: "auto",
        effort: "low",
        maxReasoningTokens: 200_000,
      },
      agentDefault: {
        schemaVersion: 1,
        mode: "auto",
        effort: "medium",
      },
      runRequest: { schemaVersion: 1, mode: "off" },
    });
  });

  it("recovers a per-run request from safe run-started evidence for continuations", async () => {
    const repository = repositoryFixture({
      events: [
        {
          type: "run.started",
          data: {
            parameterResolution: {
              reasoningPolicy: {
                source: "run_request",
                requested: {
                  schemaVersion: 1,
                  mode: "auto",
                  effort: "high",
                },
              },
            },
          },
        },
      ],
    });

    await expect(
      reasoningPolicyLayersForContinuation(repository, run, {
        reasoningPolicy: {
          schemaVersion: 1,
          mode: "auto",
          effort: "low",
        },
      }),
    ).resolves.toMatchObject({
      agentDefault: { mode: "auto", effort: "low" },
      runRequest: { mode: "auto", effort: "high" },
    });
  });

  it("rejects raw, malformed, out-of-range, and mode-incompatible stored values", () => {
    expect(
      reasoningPolicyFromUnknown({ schemaVersion: 1, mode: "raw" }),
    ).toBeUndefined();
    expect(
      reasoningPolicyFromUnknown({
        schemaVersion: 1,
        mode: "auto",
        maxReasoningTokens: 200_001,
      }),
    ).toBeUndefined();
    expect(
      reasoningPolicyFromUnknown({
        schemaVersion: 1,
        mode: "off",
        effort: "high",
      }),
    ).toBeUndefined();
    expect(
      reasoningPolicyFromUnknown({
        schemaVersion: 1,
        mode: "summary",
        retainSummary: true,
        rawPrompt: "private-secret",
      }),
    ).toBeUndefined();
  });
});

function repositoryFixture(input: {
  events?: Array<{ type: string; data: unknown }>;
  setting?: { key: string; value: Record<string, unknown>; updatedAt: string };
}): RomeoRepository {
  return {
    async getSystemSetting(key: string) {
      return input.setting?.key === key ? input.setting : undefined;
    },
    async listRunEvents() {
      return input.events ?? [];
    },
    async listActiveCapabilityAssignments() {
      return [];
    },
  } as unknown as RomeoRepository;
}

const run = {
  id: "run_reasoning",
  orgId: "org_default",
  workspaceId: "workspace_default",
  chatId: "chat_default",
  agentId: "agent_default",
  agentVersionId: "agent_version_default_v1",
  modelId: "model_default",
  providerId: "provider_default",
  status: "running",
  createdBy: "user_default",
  createdAt: "2026-08-14T00:00:00.000Z",
} satisfies RunRecord;
