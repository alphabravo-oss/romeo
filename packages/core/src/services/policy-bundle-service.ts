import { assertScope, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import type { CapabilityAssignmentState } from "./capability-definition-registry";
import { getCapabilityDefinition } from "./capability-definition-registry";
import {
  applyPolicyBundleApproval,
  evaluatePolicyBundlePublication,
  publicationClassForCapability,
  publishApprovedPolicyBundle,
  type PolicyBundle,
  type PolicyBundleAssignmentPayload,
  type PolicyBundleChange,
} from "./policy-bundle";

const SCHEMA = "romeo.policy-bundle.v1";

export class PolicyBundleService {
  constructor(private readonly repository: RomeoRepository) {}

  async propose(input: {
    subject: AuthSubject;
    capabilityId: string;
    currentState: CapabilityAssignmentState | "unset";
    nextState: CapabilityAssignmentState;
    reason: string;
    scopeType?: "organization" | "workspace" | "agent" | "group" | "user";
    assignment?: PolicyBundleAssignmentPayload;
  }): Promise<{ outcome: "publish" } | { outcome: "pending"; bundle: PolicyBundle }> {
    assertScope(input.subject, "capabilities:manage");
    const definition = getCapabilityDefinition(input.capabilityId);
    if (definition === undefined) throw notFound("Capability");
    const publicationClass = publicationClassForCapability(
      definition,
      input.currentState,
      input.nextState,
      input.scopeType,
    );
    const change: PolicyBundleChange = {
      capabilityId: input.capabilityId,
      currentState: input.currentState,
      nextState: input.nextState,
      ...(publicationClass === undefined ? {} : { publicationClass }),
      ...(input.assignment === undefined ? {} : { assignment: input.assignment }),
    };
    const decision = evaluatePolicyBundlePublication({ changes: [change] });
    if (decision.outcome === "publish") return { outcome: "publish" };
    const now = new Date().toISOString();
    const bundle: PolicyBundle = {
      id: createId("policy_bundle"),
      orgId: input.subject.orgId,
      state: "pending_approval",
      proposerId: input.subject.id,
      reason: input.reason,
      changes: [change],
      createdAt: now,
      updatedAt: now,
    };
    await this.save(bundle);
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "admin.policy_bundle.propose",
      resourceType: "policy_bundle",
      resourceId: bundle.id,
      metadata: {
        capabilityId: input.capabilityId,
        publicationRequired: true,
        classCount: decision.classes.length,
      },
    });
    return { outcome: "pending", bundle };
  }

  async approve(input: {
    subject: AuthSubject;
    bundleId: string;
    reason: string;
  }): Promise<PolicyBundle> {
    assertScope(input.subject, "capabilities:approve");
    const bundle = await this.read(input.subject.orgId, input.bundleId);
    if (bundle === undefined) throw notFound("Policy bundle");
    const decided = applyPolicyBundleApproval({
      bundle,
      actorId: input.subject.id,
      now: new Date().toISOString(),
    });
    if ("outcome" in decided)
      throw new ApiError(
        decided.code,
        "The policy bundle could not be approved.",
        decided.code === "policy_bundle_self_approval_forbidden" ? 403 : 409,
      );
    const published = publishApprovedPolicyBundle({
      bundle: decided,
      now: new Date().toISOString(),
    });
    if ("outcome" in published)
      throw new ApiError(
        published.code,
        "The policy bundle is not approved.",
        409,
      );
    await this.save(published);
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "admin.policy_bundle.approve",
      resourceType: "policy_bundle",
      resourceId: published.id,
      metadata: {
        capabilityId: published.changes[0]?.capabilityId ?? "unknown",
        publicationRequired: true,
        reasonLength: input.reason.length,
      },
    });
    return published;
  }

  publicBundle(bundle: PolicyBundle) {
    return {
      id: bundle.id,
      orgId: bundle.orgId,
      state: bundle.state,
      proposerId: bundle.proposerId,
      ...(bundle.approverId === undefined ? {} : { approverId: bundle.approverId }),
      reason: bundle.reason,
      capabilityId: bundle.changes[0]?.capabilityId ?? "data_export",
      publicationRequired: true,
    };
  }

  private async read(
    orgId: string,
    bundleId: string,
  ): Promise<PolicyBundle | undefined> {
    const value = (await this.repository.getSystemSetting(settingKey(orgId, bundleId)))
      ?.value;
    if (value === null || typeof value !== "object" || Array.isArray(value))
      return undefined;
    const candidate = value as Record<string, unknown>;
    if (candidate.schema !== SCHEMA || candidate.orgId !== orgId) return undefined;
    return candidate.bundle as PolicyBundle;
  }

  private async save(bundle: PolicyBundle): Promise<void> {
    await this.repository.upsertSystemSetting({
      key: settingKey(bundle.orgId, bundle.id),
      value: { schema: SCHEMA, orgId: bundle.orgId, bundle },
      updatedAt: bundle.updatedAt,
    });
  }
}

function settingKey(orgId: string, bundleId: string): string {
  return `policy_bundle.v1:${orgId}:${bundleId}`;
}
