import type { AuthSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import {
  assertValidAuditLog,
  auditActionRegistry,
  type AuditAction,
} from "./audit-taxonomy";
import type { AuditLog } from "./domain/entities";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { writeAuditLog } from "./services/audit-log";

const subject: AuthSubject = {
  id: "user_dev_admin",
  type: "user",
  orgId: "org_default",
  workspaceIds: ["workspace_default"],
  groupIds: [],
  scopes: ["admin:write"],
};
const privacyForbiddenKeys = [
  "prompt",
  "output",
  "media",
  "sourceText",
  "sourceContent",
  "sourceUrl",
  "secretValue",
  "accessToken",
  "refreshToken",
  "password",
  "credentialValue",
  "errorMessage",
  "errorText",
  "stack",
] as const;

describe("audit taxonomy", () => {
  it("registers bounded semantics and context for the enterprise action classes", () => {
    expect(Object.keys(auditActionRegistry)).toHaveLength(
      new Set(Object.keys(auditActionRegistry)).size,
    );
    const semantics = new Set(
      Object.values(auditActionRegistry).map(({ semantic }) => semantic),
    );
    expect(semantics).toEqual(
      new Set([
        "acl_filtering",
        "compare",
        "compute_or_tool",
        "encryption",
        "lifecycle",
        "media",
        "policy_decision",
        "provider_routing",
        "start",
      ]),
    );
    for (const definition of Object.values(auditActionRegistry)) {
      expect(definition.sensitivity).toBe("metadata_only");
      expect(definition.redaction).toBe("reject_forbidden");
      expect(definition.requiredContext).toEqual([
        "actor",
        "organization",
        "outcome",
        "resource",
      ]);
    }
  });

  it("enforces the registry in the canonical write path", async () => {
    const repository = new InMemoryRomeoRepository();
    await expect(
      writeAuditLog(repository, {
        subject,
        action: "unregistered.audit.action" as AuditAction,
        resourceType: "model",
        resourceId: "model_example",
      }),
    ).rejects.toThrowError("Audit action is not registered.");
    expect(await repository.listAuditLogs(subject.orgId)).toEqual([]);

    await writeAuditLog(repository, {
      subject,
      action: "model.pricing.update",
      resourceType: "model",
      resourceId: "model_example",
      metadata: { providerId: "provider_example" },
    });
    expect((await repository.listAuditLogs(subject.orgId))[0]?.action).toBe(
      "model.pricing.update",
    );
  });

  it("enforces the taxonomy at the in-memory repository boundary", async () => {
    const repository = new InMemoryRomeoRepository();
    const privateSentinel = "PRIVATE_DIRECT_AUDIT_SENTINEL";
    for (const log of [
      auditLog("unregistered.audit.action" as AuditAction, {}),
      auditLog("model.pricing.update", { arbitraryNewField: privateSentinel }),
      ...privacyForbiddenKeys.map((key) =>
        auditLog("model.pricing.update", { [key]: privateSentinel }),
      ),
    ]) {
      await expect(repository.createAuditLog(log)).rejects.toThrow(TypeError);
      try {
        await repository.createAuditLog(log);
      } catch (error) {
        expect(String(error)).not.toContain(privateSentinel);
        expect(String(error)).not.toContain(log.action);
      }
    }
    expect(await repository.listAuditLogs(subject.orgId)).toEqual([]);
  });

  it("rejects unregistered metadata without exposing its value", () => {
    const sentinel = "PRIVATE_UNKNOWN_METADATA_VALUE";
    expectPrivacySafeRejection({ arbitraryNewField: sentinel });
  });

  it.each(privacyForbiddenKeys)(
    "rejects raw %s metadata with privacy-safe errors",
    (key) => {
      expectPrivacySafeRejection({ [key]: `PRIVATE_${key}_SENTINEL` });
    },
  );

  it("rejects secret-shaped strings even through an allowed key", () => {
    expectPrivacySafeRejection({
      providerId: "sk-private-secret-value-123456789",
    });
  });
});

function expectPrivacySafeRejection(metadata: Record<string, unknown>): void {
  const log = auditLog("model.pricing.update", metadata);
  expect(() => assertValidAuditLog(log)).toThrow(TypeError);
  try {
    assertValidAuditLog(log);
  } catch (error) {
    for (const value of Object.values(metadata))
      expect(String(error)).not.toContain(String(value));
  }
}

function auditLog(
  action: AuditAction,
  metadata: Record<string, unknown>,
): AuditLog {
  return {
    id: "audit_example",
    orgId: subject.orgId,
    actorId: subject.id,
    action,
    resourceType: "group",
    resourceId: "group_example",
    outcome: "success",
    metadata,
    createdAt: "2026-08-14T00:00:00.000Z",
  };
}
