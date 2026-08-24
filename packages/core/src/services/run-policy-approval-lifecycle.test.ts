import { seededSubject } from "@romeo/auth";
import { MemoryObjectStore } from "@romeo/storage";
import { afterEach, describe, expect, it, vi } from "vitest";

import type { AuditLog, RunRecord } from "../domain/entities";
import {
  createRuntimeSeedData,
  InMemoryRomeoRepository,
} from "../repositories/in-memory";
import { RunAccessService } from "./run-access-service";
import { RunEventSequencer } from "./run-event-sequencer";
import { RunExecutionStateService } from "./run-execution-state-service";
import { RunPolicyApprovalLifecycle } from "./run-policy-approval-lifecycle";

describe("durable content-policy run approvals", () => {
  afterEach(() => vi.useRealTimers());

  it("creates only a sanitized run/job/version-bound approval", async () => {
    const fixture = await approvalFixture();
    expect(fixture.approval).toMatchObject({
      runId: fixture.run.id,
      policyVersionId: "policy_version_active",
      executionJobId: fixture.job.id,
      state: "pending",
    });
    expect(
      await fixture.repository.listContentPolicyApprovals(
        fixture.run.orgId,
        100,
      ),
    ).toHaveLength(1);
    const decisions = await fixture.repository.listContentPolicyDecisions(
      fixture.run.orgId,
      100,
    );
    expect(decisions).toEqual([
      expect.objectContaining({
        runId: fixture.run.id,
        executionJobId: fixture.job.id,
        policyVersionId: "policy_version_active",
        surface: "run_output",
        detectors: [{ action: "block", code: "api_token", count: 1 }],
      }),
    ]);
    expect(
      JSON.stringify({ approvals: [fixture.approval], decisions }),
    ).not.toContain("sk-sensitive");
    expect(
      await fixture.repository.getSystemSetting(
        `content_policy.approvals.v1:${fixture.run.orgId}`,
        fixture.run.orgId,
      ),
    ).toBeUndefined();
    expect((await fixture.repository.getRun(fixture.run.id))?.status).toBe(
      "waiting_tool_approval",
    );
    expect(
      (await fixture.repository.listBackgroundJobs(fixture.run.orgId)).find(
        (job) => job.id === fixture.job.id,
      ),
    ).toMatchObject({ status: "queued" });
  });

  it("allows one concurrent approval winner and resumes the fenced job once", async () => {
    const fixture = await approvalFixture();
    const [left, right] = await Promise.all([
      fixture.lifecycle.resolve({
        subject: seededSubject,
        approvalId: fixture.approval.id,
        decision: "approve",
      }),
      fixture.lifecycle.resolve({
        subject: seededSubject,
        approvalId: fixture.approval.id,
        decision: "approve",
      }),
    ]);
    expect(left.state).toBe("approved");
    expect(right.state).toBe("approved");
    expect(fixture.execute).toHaveBeenCalledTimes(1);
    const claimed = await fixture.repository.claimBackgroundJob({
      orgId: fixture.run.orgId,
      type: `run.execution:${fixture.run.id}`,
      workerId: "assert_one_claim",
      leaseSeconds: 60,
    });
    expect(claimed).toBeDefined();
    expect(
      await fixture.repository.claimBackgroundJob({
        orgId: fixture.run.orgId,
        type: `run.execution:${fixture.run.id}`,
        workerId: "assert_loser",
        leaseSeconds: 60,
      }),
    ).toBeUndefined();
    expect(
      (await fixture.repository.listAuditLogs(fixture.run.orgId)).filter(
        (log) => log.action === "admin.content_policy.approval.resolve",
      ),
    ).toHaveLength(1);
  });

  it("serializes conflicting approve/deny decisions and terminates on denial", async () => {
    const fixture = await approvalFixture();
    const outcomes = await Promise.allSettled([
      fixture.lifecycle.resolve({
        subject: seededSubject,
        approvalId: fixture.approval.id,
        decision: "deny",
      }),
      fixture.lifecycle.resolve({
        subject: seededSubject,
        approvalId: fixture.approval.id,
        decision: "approve",
      }),
    ]);
    expect(
      outcomes.filter((outcome) => outcome.status === "fulfilled"),
    ).toHaveLength(1);
    expect(
      outcomes.filter((outcome) => outcome.status === "rejected"),
    ).toHaveLength(1);
    expect((await fixture.repository.getRun(fixture.run.id))?.status).toBe(
      "failed",
    );
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(await fixture.repository.listRunEvents(fixture.run.id)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          type: "run.failed",
          data: expect.objectContaining({
            errorCode: "content_policy_approval_denied",
          }),
        }),
      ]),
    );
  });

  it("expires a stale approval and durably terminates its waiting run", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-23T12:00:00.000Z"));
    const fixture = await approvalFixture();
    await vi.advanceTimersByTimeAsync(61_000);
    await expect(
      fixture.lifecycle.resolve({
        subject: seededSubject,
        approvalId: fixture.approval.id,
        decision: "approve",
      }),
    ).rejects.toMatchObject({ code: "content_policy_approval_expired" });
    expect(
      await fixture.repository.getContentPolicyApproval(
        fixture.run.orgId,
        fixture.approval.id,
      ),
    ).toMatchObject({ state: "expired" });
    expect((await fixture.repository.getRun(fixture.run.id))?.status).toBe(
      "failed",
    );
  });

  it("rolls approval, run, job, event, and audit back together on audit failure", async () => {
    const repository = new FaultInjectingRepository(createRuntimeSeedData());
    const fixture = await approvalFixture(repository);
    repository.failResolutionAudit = true;
    await expect(
      fixture.lifecycle.resolve({
        subject: seededSubject,
        approvalId: fixture.approval.id,
        decision: "approve",
      }),
    ).rejects.toThrow("injected resolution audit failure");
    expect(
      await repository.getContentPolicyApproval(
        fixture.run.orgId,
        fixture.approval.id,
      ),
    ).toMatchObject({ state: "pending" });
    expect((await repository.getRun(fixture.run.id))?.status).toBe(
      "waiting_tool_approval",
    );
    expect(fixture.execute).not.toHaveBeenCalled();
    expect(
      (await repository.listAuditLogs(fixture.run.orgId)).filter(
        (log) => log.action === "admin.content_policy.approval.resolve",
      ),
    ).toEqual([]);
  });
});

async function approvalFixture(
  repository: InMemoryRomeoRepository = new InMemoryRomeoRepository(
    createRuntimeSeedData(),
  ),
) {
  const run: RunRecord = {
    id: `run_policy_${crypto.randomUUID()}`,
    orgId: seededSubject.orgId,
    workspaceId: "workspace_default",
    chatId: "chat_welcome",
    agentId: "agent_default",
    agentVersionId: "agent_version_default_v1",
    modelId: "model_openai_compatible_default",
    providerId: "provider_openai_compatible",
    status: "running",
    createdBy: seededSubject.id,
    createdAt: new Date().toISOString(),
  };
  await repository.createRun(run);
  const sequencer = new RunEventSequencer();
  const executionState = new RunExecutionStateService(
    repository,
    sequencer,
    new MemoryObjectStore(),
    "policy_worker",
    60,
  );
  const claimed = await executionState.claim({
    run,
    messages: [{ role: "user", content: "safe request" }],
    citations: [],
    providerTools: [],
    subject: seededSubject,
  });
  if (claimed === undefined) throw new Error("Expected an execution claim.");
  const execute = vi.fn();
  const lifecycle = new RunPolicyApprovalLifecycle(
    repository,
    sequencer,
    executionState,
    new RunAccessService(repository),
    { disabledProviderIds: new Set() },
    "policy_worker",
    execute,
  );
  const approval = await lifecycle.pause({
    run,
    executionJob: claimed.job,
    checkpoint: {
      ...claimed.checkpoint,
      assistantContent: "safe prefix",
    },
    policyVersionId: "policy_version_active",
    approvalTtlSeconds: 60,
    detectors: [{ action: "block", code: "api_token", count: 1 }],
  });
  const job = (await repository.listBackgroundJobs(run.orgId)).find(
    (candidate) => candidate.id === claimed.job.id,
  )!;
  return { approval, execute, job, lifecycle, repository, run };
}

class FaultInjectingRepository extends InMemoryRomeoRepository {
  failResolutionAudit = false;

  override async createAuditLog(log: AuditLog): Promise<AuditLog> {
    if (
      this.failResolutionAudit &&
      log.action === "admin.content_policy.approval.resolve"
    )
      throw new Error("injected resolution audit failure");
    return super.createAuditLog(log);
  }
}
