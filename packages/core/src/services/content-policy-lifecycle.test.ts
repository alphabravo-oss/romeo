import { describe, expect, it } from "vitest";

import {
  createPolicyVersionDraft,
  dryRunPolicyVersion,
  publishPolicyVersion,
  rollbackPolicyVersion,
} from "./content-policy-versioning";
import { requestPolicyApproval, resolvePolicyApproval } from "./policy-approval";
import { gateStreamedOutputDelta } from "./run-output-policy-gate";
import { OutputPolicyBuffer } from "./output-policy-buffer";

const detectors = {
  credit_card: "disabled",
  email_address: "redact",
  us_ssn: "disabled",
  api_token: "block",
} as const;

describe("content policy versioning and approval", () => {
  it("creates an immutable draft, dry-runs without match text, publishes, then rolls back", () => {
    const drafted = createPolicyVersionDraft({
      store: { versions: [] },
      id: "ver_1",
      now: "2026-08-14T12:00:00.000Z",
      actorId: "user_admin",
      detectors,
    });
    expect(drafted.versions[0]?.state).toBe("draft");
    const dry = dryRunPolicyVersion({
      version: drafted.versions[0]!,
      content: "email private@example.com token sk-abcdefghijklmnopqrstuvwxyz123456",
      decisionId: "dec_1",
      now: "2026-08-14T12:00:01.000Z",
    });
    expect(dry.evaluation.action).toBe("block");
    expect(JSON.stringify(dry.decision)).not.toContain("private@example.com");
    expect(JSON.stringify(dry.decision)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");
    const published = publishPolicyVersion({
      store: drafted,
      versionId: "ver_1",
      now: "2026-08-14T12:00:02.000Z",
      actorId: "user_admin",
    });
    expect(published.outcome).toBe("published");
    if (published.outcome !== "published") return;
    const next = createPolicyVersionDraft({
      store: published.store,
      id: "ver_2",
      now: "2026-08-14T12:00:03.000Z",
      actorId: "user_admin",
      detectors: { ...detectors, api_token: "audit" },
    });
    const second = publishPolicyVersion({
      store: next,
      versionId: "ver_2",
      now: "2026-08-14T12:00:04.000Z",
      actorId: "user_admin",
    });
    expect(second.outcome).toBe("published");
    if (second.outcome !== "published") return;
    const rolled = rollbackPolicyVersion({
      store: second.store,
      versionId: "ver_1",
      now: "2026-08-14T12:00:05.000Z",
      actorId: "user_admin",
    });
    expect(rolled.outcome).toBe("published");
    if (rolled.outcome !== "published") return;
    expect(rolled.store.publishedVersionId).toBe("ver_1");
    expect(rolled.store.versions.find((item) => item.id === "ver_2")?.state).toBe(
      "retired",
    );
  });

  it("pauses a run for a scoped expiring content-minimized approval", () => {
    const requested = requestPolicyApproval({
      id: "appr_1",
      orgId: "org_default",
      runId: "run_1",
      decisionId: "dec_1",
      actorId: "user_admin",
      expiresAt: "2027-08-14T13:00:00.000Z",
      now: "2026-08-14T12:00:00.000Z",
      matchTextPresent: false,
    });
    expect(requested.outcome).toBe("paused");
    if (requested.outcome !== "paused") return;
    expect(JSON.stringify(requested.approval)).not.toContain("sk-");
    const resolved = resolvePolicyApproval({
      approval: requested.approval,
      actorId: "user_reviewer",
      now: "2026-08-14T12:30:00.000Z",
      decision: "approve",
      runId: "run_1",
    });
    expect(resolved.outcome).toBe("approved");
    expect(
      resolvePolicyApproval({
        approval: requested.approval,
        actorId: "user_reviewer",
        now: "2026-08-14T12:30:00.000Z",
        decision: "approve",
        runId: "run_other",
      }),
    ).toMatchObject({
      outcome: "denied",
      code: "content_policy_approval_scope_mismatch",
    });
  });

  it("refuses to persist or emit a blocked streamed delta", () => {
    const buffer = new OutputPolicyBuffer({
      mode: "rolling",
      detectors,
      failClosed: true,
    });
    const result = gateStreamedOutputDelta({
      buffer,
      text: "token sk-abcdefghijklmnopqrstuvwxyz123456 trailing",
    });
    expect(result.outcome).toBe("block");
    expect(buffer.persisted()).toBe("");
  });
});
