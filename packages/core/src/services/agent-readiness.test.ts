import { seededSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { createSeedData } from "../repositories/seed-data";
import { AgentService } from "./agent-service";

describe("managed-model effective-access readiness", () => {
  it("reports a fully authorized published assistant as ready", async () => {
    const repository = new InMemoryRomeoRepository(createSeedData());
    const report = await new AgentService(repository).readiness({
      agentId: "agent_default",
      subject: seededSubject,
      principalType: "group",
      principalId: "group_admins",
    });

    expect(report.status).toBe("ready");
    expect(report.blockingCount).toBe(0);
    expect(report.principal).toMatchObject({
      principalType: "group",
      principalId: "group_admins",
      simulated: true,
    });
    expect(report.checks).toHaveLength(9);
  });

  it("identifies every missing downstream grant for a shared group", async () => {
    const seed = createSeedData();
    seed.groups.push({
      id: "group_readiness_without_grants",
      orgId: "org_default",
      name: "Unconfigured reviewers",
      slug: "unconfigured-reviewers",
      createdAt: new Date().toISOString(),
    });
    const repository = new InMemoryRomeoRepository(seed);
    const report = await new AgentService(repository).readiness({
      agentId: "agent_default",
      subject: seededSubject,
      principalType: "group",
      principalId: "group_readiness_without_grants",
    });

    expect(report.status).toBe("blocked");
    expect(blockedKeys(report)).toEqual(
      expect.arrayContaining([
        "assistant_access",
        "base_model",
        "provider",
        "knowledge",
        "voice",
      ]),
    );
  });

  it("blocks readiness when the published provider is disabled", async () => {
    const repository = new InMemoryRomeoRepository(createSeedData());
    const provider = await repository.getProvider("provider_openai_compatible");
    expect(provider).toBeDefined();
    await repository.updateProvider({ ...provider!, enabled: false });

    const report = await new AgentService(repository).readiness({
      agentId: "agent_default",
      subject: seededSubject,
    });

    expect(report.status).toBe("blocked");
    expect(
      report.checks.find((check) => check.key === "provider"),
    ).toMatchObject({
      status: "blocked",
      code: "provider_blocked",
    });
  });

  it("does not treat an unpublished draft as runnable", async () => {
    const repository = new InMemoryRomeoRepository(createSeedData());
    const agent = await repository.getAgent("agent_default");
    expect(agent).toBeDefined();
    const { publishedVersionId: _publishedVersionId, ...draft } = agent!;
    await repository.updateAgent(draft);

    const report = await new AgentService(repository).readiness({
      agentId: "agent_default",
      subject: seededSubject,
    });

    expect(report.status).toBe("blocked");
    expect(
      report.checks.find((check) => check.key === "published_version"),
    ).toMatchObject({
      status: "blocked",
      code: "assistant_not_published",
    });
  });
});

function blockedKeys(
  report: Awaited<ReturnType<AgentService["readiness"]>>,
): string[] {
  return report.checks
    .filter((check) => check.status === "blocked")
    .map((check) => check.key);
}
