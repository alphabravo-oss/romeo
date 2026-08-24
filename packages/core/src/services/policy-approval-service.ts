import { assertScope, type AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { publicPolicyApproval } from "./policy-approval";

export interface PolicyApprovalResolutionPort {
  resolve(input: {
    subject: AuthSubject;
    approvalId: string;
    decision: "approve" | "deny";
    runId?: string;
  }): Promise<ReturnType<typeof publicPolicyApproval>>;
  expireDue(subject: AuthSubject): Promise<void>;
}

export class PolicyApprovalService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly resolution: PolicyApprovalResolutionPort,
  ) {}

  async list(subject: AuthSubject) {
    assertScope(subject, "admin:read");
    await this.resolution.expireDue(subject);
    return (
      await this.repository.listContentPolicyApprovals(subject.orgId, 100)
    ).map(publicPolicyApproval);
  }

  async request(input: {
    subject: AuthSubject;
    runId: string;
    decisionId: string;
    expiresAt: string;
    matchTextPresent?: boolean;
  }): Promise<ReturnType<typeof publicPolicyApproval>> {
    assertScope(input.subject, "admin:write");
    throw new ApiError(
      "content_policy_approval_required",
      "Content-policy approvals are created only by a run-bound runtime decision.",
      403,
    );
  }

  async resolve(input: {
    subject: AuthSubject;
    approvalId: string;
    decision: "approve" | "deny";
    runId?: string;
  }) {
    assertScope(input.subject, "admin:write");
    return this.resolution.resolve(input);
  }
}
