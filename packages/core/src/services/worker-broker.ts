import type { AuthSubject, Scope } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import type { RepositoryRequestScope } from "../domain/repository-request-scope";
import { ApiError } from "../errors";
import type { RomeoServices } from "./service-registry-types";
import { settingKey as abuseControlSettingKey } from "./abuse-control-policy-helpers";
import { ensureSystemAuditActor } from "./system-audit-actor";
import { deletionRequestKey } from "./tenant-admin-support";
import {
  assertCurrentLease,
  browserCompletionResult,
  claimKnowledge,
  completeKnowledgeExtraction,
  renewBackground,
  renewKnowledge,
} from "./worker-broker-operations";
import {
  type WorkerBrokerAudience,
  type WorkerBrokerClaimTokenPayload,
  type WorkerBrokerCredential,
  WorkerBrokerTokenCodec,
} from "./worker-broker-token";

export interface WorkerBrokerClaimInput {
  audience: WorkerBrokerAudience;
  authorization: string | undefined;
  leaseSeconds: number;
  payloadStorage?:
    | "external_worker_secret_store_required"
    | "managed_encrypted_object_store";
  workerId: string;
}

export interface WorkerBrokerClaimResult {
  audience: WorkerBrokerAudience;
  claim?: unknown;
  claimToken?: string;
  claimed: boolean;
}

export interface WorkerBrokerRenewInput {
  audience: WorkerBrokerAudience;
  authorization: string | undefined;
  claimToken: string;
  leaseSeconds: number;
  workerId: string;
}

export interface WorkerBrokerCompleteInput {
  audience: WorkerBrokerAudience;
  authorization: string | undefined;
  claimToken: string;
  errorCode?: string;
  result?: Record<string, unknown>;
  response?: {
    bodyBytes: number;
    contentType?: string;
    ok: boolean;
    schemaValidation: { errorCode?: string; status: "failed" | "passed" };
    status: number;
    truncated: boolean;
  };
  success: boolean;
  workerId: string;
}

interface WorkerBrokerOptions {
  credentials: Partial<Record<WorkerBrokerAudience, WorkerBrokerCredential>>;
  maxTenantsPerClaim?: number;
  now?: () => Date;
}

interface ClaimedTenantWork {
  claim: unknown;
  payload: WorkerBrokerClaimTokenPayload;
}

const brokerScopes: Record<WorkerBrokerAudience, Scope[]> = {
  browser_automation: ["tools:manage"],
  knowledge_extraction: ["knowledge:read", "knowledge:write"],
  tool_dispatch: ["tools:manage", "runs:read"],
};

export class WorkerBrokerService {
  private readonly codecs = new Map<
    WorkerBrokerAudience,
    WorkerBrokerTokenCodec
  >();

  constructor(
    private readonly scope: RepositoryRequestScope,
    private readonly createServices: (
      repository: RomeoRepository,
    ) => RomeoServices,
    private readonly options: WorkerBrokerOptions,
  ) {
    for (const [audience, credential] of Object.entries(options.credentials)) {
      if (credential !== undefined)
        this.codecs.set(
          audience as WorkerBrokerAudience,
          new WorkerBrokerTokenCodec(credential),
        );
    }
  }

  isConfigured(audience: WorkerBrokerAudience): boolean {
    return this.codecs.has(audience);
  }

  async claim(input: WorkerBrokerClaimInput): Promise<WorkerBrokerClaimResult> {
    const codec = this.authenticate(input.audience, input.authorization);
    assertWorkerId(input.workerId);
    const leaseSeconds = boundedLeaseSeconds(input.leaseSeconds);
    const tenantIds = await this.candidateTenantIds(input.audience);
    let lastVisited: string | undefined;
    for (const orgId of tenantIds) {
      lastVisited = orgId;
      const claimed = await this.scope.runAsTenant(orgId, (repository) =>
        this.claimForTenant(repository, {
          ...input,
          leaseSeconds,
          orgId,
        }),
      );
      if (claimed === undefined) continue;
      await this.saveCursor(input.audience, orgId);
      return {
        audience: input.audience,
        claim: claimed.claim,
        claimed: true,
        claimToken: codec.issue(claimed.payload),
      };
    }
    if (lastVisited !== undefined)
      await this.saveCursor(input.audience, lastVisited);
    return { audience: input.audience, claimed: false };
  }

  async renew(input: WorkerBrokerRenewInput): Promise<WorkerBrokerClaimResult> {
    const codec = this.authenticate(input.audience, input.authorization);
    assertWorkerId(input.workerId);
    const token = codec.verify(input.claimToken, input, this.now());
    const renewed = await this.scope.runAsTenant(token.orgId, (repository) =>
      this.renewForTenant(
        repository,
        token,
        boundedLeaseSeconds(input.leaseSeconds),
      ),
    );
    if (renewed === undefined) throw leaseLost();
    return {
      audience: input.audience,
      claim: renewed.claim,
      claimed: true,
      claimToken: codec.issue(renewed.payload),
    };
  }

  async complete(input: WorkerBrokerCompleteInput): Promise<unknown> {
    const codec = this.authenticate(input.audience, input.authorization);
    assertWorkerId(input.workerId);
    const token = codec.verify(input.claimToken, input, this.now());
    return this.scope.runAsTenant(token.orgId, async (repository) => {
      await assertCurrentLease(repository, token, this.now());
      const services = this.createServices(repository);
      const subject = await brokerSubject(
        repository,
        input.audience,
        token.orgId,
      );
      if (input.audience === "tool_dispatch") {
        const result = input.success
          ? await services.toolConnectors.completeDispatchRequest({
              subject,
              jobId: token.workId,
              response: requiredToolResponse(input.response),
            })
          : await services.toolConnectors.failDispatchRequest({
              subject,
              jobId: token.workId,
              errorCode: normalizedErrorCode(input.errorCode),
            });
        await services.runs.resumeAfterDispatchRequestReadback({
          subject,
          jobId: token.workId,
          ...(input.success
            ? { response: requiredToolResponse(input.response) }
            : { errorCode: normalizedErrorCode(input.errorCode) }),
        });
        return result;
      }
      if (input.audience === "browser_automation") {
        return input.success
          ? services.browserAutomation.complete({
              subject,
              jobId: token.workId,
              result: browserCompletionResult(input.result),
            })
          : services.browserAutomation.fail({
              subject,
              jobId: token.workId,
              errorCode: normalizedErrorCode(input.errorCode),
            });
      }
      return completeKnowledgeExtraction(
        repository,
        services,
        subject,
        token,
        input,
        this.now(),
      );
    });
  }

  private authenticate(
    audience: WorkerBrokerAudience,
    authorization: string | undefined,
  ): WorkerBrokerTokenCodec {
    const codec = this.codecs.get(audience);
    if (codec === undefined)
      throw new ApiError(
        "worker_broker_audience_unavailable",
        "The worker broker audience is not configured.",
        404,
      );
    codec.authenticateBearer(authorization);
    return codec;
  }

  private async candidateTenantIds(
    audience: WorkerBrokerAudience,
  ): Promise<string[]> {
    return this.scope.runAsSystem(async (repository) => {
      const organizations = (await repository.listAllOrganizations()).sort(
        (left, right) => left.id.localeCompare(right.id),
      );
      const cursorSetting = await repository.getSystemSetting(
        cursorKey(audience),
        null,
      );
      const cursor =
        typeof cursorSetting?.value.cursorOrgId === "string"
          ? cursorSetting.value.cursorOrgId
          : undefined;
      const pivot = organizations.findIndex(
        (organization) => cursor === undefined || organization.id > cursor,
      );
      const ordered =
        pivot <= 0
          ? organizations
          : [...organizations.slice(pivot), ...organizations.slice(0, pivot)];
      const candidates: string[] = [];
      for (const organization of ordered) {
        if (await tenantEligible(repository, organization.id))
          candidates.push(organization.id);
        if (candidates.length >= (this.options.maxTenantsPerClaim ?? 100))
          break;
      }
      return candidates;
    });
  }

  private saveCursor(
    audience: WorkerBrokerAudience,
    cursorOrgId: string,
  ): Promise<unknown> {
    const now = this.now().toISOString();
    return this.scope.runAsSystem((repository) =>
      repository.upsertSystemSetting(
        {
          key: cursorKey(audience),
          updatedAt: now,
          value: { cursorOrgId, updatedAt: now, version: 1 },
        },
        null,
      ),
    );
  }

  private async claimForTenant(
    repository: RomeoRepository,
    input: WorkerBrokerClaimInput & { orgId: string },
  ): Promise<ClaimedTenantWork | undefined> {
    if (input.audience === "knowledge_extraction") {
      const subject = await brokerSubject(
        repository,
        input.audience,
        input.orgId,
      );
      return claimKnowledge(
        repository,
        { ...input, leaseOwner: subject.id },
        this.now(),
      );
    }
    return this.claimBackgroundJob(repository, input);
  }

  private async claimBackgroundJob(
    repository: RomeoRepository,
    input: WorkerBrokerClaimInput & { orgId: string },
  ): Promise<ClaimedTenantWork | undefined> {
    const services = this.createServices(repository);
    const subject = await brokerSubject(
      repository,
      input.audience,
      input.orgId,
    );
    const claim =
      input.audience === "tool_dispatch"
        ? await services.toolConnectors.claimDispatchRequest({
            subject,
            leaseSeconds: input.leaseSeconds,
            ...(input.payloadStorage === undefined
              ? {}
              : { payloadStorage: input.payloadStorage }),
          })
        : await services.browserAutomation.claim({
            subject,
            leaseSeconds: input.leaseSeconds,
          });
    if (!claim.claimed || claim.job === undefined || claim.lease === undefined)
      return undefined;
    let publicClaim: unknown = claim;
    if (input.audience === "tool_dispatch") {
      const toolClaim = claim as Awaited<
        ReturnType<RomeoServices["toolConnectors"]["claimDispatchRequest"]>
      >;
      if (
        toolClaim.request?.payloadStorage !== "managed_encrypted_object_store"
      )
        return {
          claim: publicClaim,
          payload: tokenPayload(input, claim.job.id, claim.lease),
        };
      const payload = await services.toolConnectors.readDispatchRequestPayload({
        subject,
        jobId: claim.job.id,
      });
      publicClaim = { ...toolClaim, payload: payload.payload };
    }
    return {
      claim: publicClaim,
      payload: tokenPayload(input, claim.job.id, claim.lease),
    };
  }

  private renewForTenant(
    repository: RomeoRepository,
    token: WorkerBrokerClaimTokenPayload,
    leaseSeconds: number,
  ): Promise<ClaimedTenantWork | undefined> {
    if (token.audience === "knowledge_extraction")
      return renewKnowledge(repository, token, leaseSeconds, this.now());
    return renewBackground(
      repository,
      this.createServices(repository),
      token,
      leaseSeconds,
    );
  }

  private now(): Date {
    return this.options.now?.() ?? new Date();
  }
}

async function brokerSubject(
  repository: RomeoRepository,
  audience: WorkerBrokerAudience,
  orgId: string,
): Promise<AuthSubject> {
  const [actor, workspaces] = await Promise.all([
    ensureSystemAuditActor(repository, {
      kind: `worker_broker_${audience}`,
      name: `${audience.replaceAll("_", " ")} broker`,
      orgId,
      scopes: brokerScopes[audience],
    }),
    repository.listWorkspaces(orgId),
  ]);
  return {
    groupIds: [],
    id: actor.id,
    isAdmin: false,
    orgId,
    scopes: brokerScopes[audience],
    type: "service_account",
    workspaceIds: workspaces.map((workspace) => workspace.id),
  };
}

async function tenantEligible(
  repository: RomeoRepository,
  orgId: string,
): Promise<boolean> {
  const [abuseControl, deletion] = await Promise.all([
    repository.getSystemSetting(abuseControlSettingKey(orgId), orgId),
    repository.getSystemSetting(deletionRequestKey(orgId), orgId),
  ]);
  const suspension = abuseControl?.value.suspension;
  const suspended =
    typeof suspension === "object" &&
    suspension !== null &&
    !Array.isArray(suspension) &&
    (suspension as Record<string, unknown>).suspended === true;
  return !suspended && deletion?.value.status !== "requested";
}

function tokenPayload(
  input: WorkerBrokerClaimInput & { orgId: string },
  workId: string,
  lease: { attempt: number; expiresAt: string },
): WorkerBrokerClaimTokenPayload {
  return {
    attempt: lease.attempt,
    audience: input.audience,
    expiresAt: lease.expiresAt,
    fence: lease.attempt,
    orgId: input.orgId,
    version: 1,
    workerId: input.workerId,
    workId,
  };
}

function cursorKey(audience: WorkerBrokerAudience): string {
  return `worker-broker.${audience}.cursor.v1`;
}

function boundedLeaseSeconds(value: number): number {
  if (!Number.isInteger(value) || value < 30 || value > 900)
    throw new ApiError(
      "worker_broker_lease_invalid",
      "Worker broker leases must be between 30 and 900 seconds.",
      400,
    );
  return value;
}

function assertWorkerId(workerId: string): void {
  if (!/^[A-Za-z0-9_.:-]{1,160}$/u.test(workerId))
    throw new ApiError(
      "worker_broker_worker_id_invalid",
      "The worker identifier is invalid.",
      400,
    );
}

function normalizedErrorCode(value: string | undefined): string {
  return value !== undefined && /^[a-z0-9_.:-]{1,120}$/u.test(value)
    ? value
    : "worker_execution_failed";
}

function requiredToolResponse(
  response: WorkerBrokerCompleteInput["response"],
): NonNullable<WorkerBrokerCompleteInput["response"]> {
  if (response === undefined)
    throw new ApiError(
      "worker_broker_completion_invalid",
      "A tool dispatch response is required for successful completion.",
      400,
    );
  return response;
}

function leaseLost(): ApiError {
  return new ApiError(
    "worker_broker_lease_lost",
    "The worker no longer owns this claim.",
    409,
  );
}
