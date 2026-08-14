import { assertScope, type AuthSubject } from "@romeo/auth";
import {
  CapabilityFlagIdSchema,
  type CapabilityFlagId,
  type CapabilityFlagState,
  type CapabilityFlagSubject,
} from "@romeo/contracts";

import { CapabilityFlagVersionConflictError } from "../domain/capability-flags";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import type { CapabilityPlatformPolicy } from "./capability-platform-policy";
import { capabilityFlagUsageStore } from "./capability-flag-observability";

const DEFAULT_ENABLED = new Set<CapabilityFlagId>([
  "stream_transport_v2",
  "router_query_hydration_v1",
  "server_table_v2",
  "content_firewall_v2",
  "knowledge_acl_v2",
  "multimodal_parts_v2",
  "image_jobs_v2",
]);

const enforcedFlagIds = new Set<CapabilityFlagId>([
  "image_jobs_v2",
  "content_firewall_v2",
  "knowledge_acl_v2",
  "realtime_voice_v1",
  "compute_artifacts_v1",
  "compare_consensus_v1",
  "trust_plane_v1",
  "reasoning_policy_v1",
  "multimodal_parts_v2",
  "stream_transport_v2",
  "router_query_hydration_v1",
  "server_table_v2",
]);

export const capabilityFlagDefinitions = CapabilityFlagIdSchema.options.map(
  (id) => ({
    id,
    defaultState: DEFAULT_ENABLED.has(id)
      ? ("enabled" as const)
      : ("disabled" as const),
    consumerStatus: enforcedFlagIds.has(id)
      ? ("enforced" as const)
      : ("reserved" as const),
    ...(platformCapabilityId(id) === undefined
      ? {}
      : { platformCapabilityId: platformCapabilityId(id)! }),
  }),
);

export interface EffectiveCapabilityFlag {
  flagId: CapabilityFlagId;
  configuredState: CapabilityFlagState;
  effectiveState: "disabled" | "enabled";
  reasonCode:
    | "enabled"
    | "disabled"
    | "preview_allowlisted"
    | "preview_not_allowlisted"
    | "platform_disabled";
  version?: number;
}

export class OrganizationCapabilityFlagService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly platformPolicy: CapabilityPlatformPolicy,
  ) {}

  async listEffective(
    subject: AuthSubject,
  ): Promise<EffectiveCapabilityFlag[]> {
    const configured =
      await this.repository.listActiveOrganizationCapabilityFlags({
        orgId: subject.orgId,
      });
    const byId = new Map(configured.map((flag) => [flag.flagId, flag]));
    const resolved = capabilityFlagDefinitions.map((definition) =>
      resolveEffectiveFlag(
        subject,
        definition,
        byId.get(definition.id),
        this.platformPolicy,
      ),
    );
    for (const flag of resolved) capabilityFlagUsageStore.record(flag);
    return resolved;
  }

  async resolve(
    subject: AuthSubject,
    flagId: CapabilityFlagId,
  ): Promise<EffectiveCapabilityFlag> {
    const definition = requiredDefinition(flagId);
    const [configured] =
      await this.repository.listActiveOrganizationCapabilityFlags({
        orgId: subject.orgId,
        flagIds: [flagId],
      });
    const resolved = resolveEffectiveFlag(
      subject,
      definition,
      configured,
      this.platformPolicy,
    );
    capabilityFlagUsageStore.record(resolved);
    return resolved;
  }

  async adminReport(subject: AuthSubject) {
    assertScope(subject, "capabilities:read");
    return {
      definitions: capabilityFlagDefinitions,
      configured: await this.repository.listActiveOrganizationCapabilityFlags({
        orgId: subject.orgId,
      }),
      platformDisabledFlagIds: capabilityFlagDefinitions
        .filter(
          (definition) =>
            definition.platformCapabilityId !== undefined &&
            this.platformPolicy.disabledCapabilityIds.includes(
              definition.platformCapabilityId,
            ),
        )
        .map((definition) => definition.id),
    };
  }

  async history(subject: AuthSubject, flagId: CapabilityFlagId) {
    assertScope(subject, "capabilities:read");
    requiredDefinition(flagId);
    return this.repository.listOrganizationCapabilityFlagHistory({
      orgId: subject.orgId,
      flagId,
      limit: 100,
    });
  }

  async update(input: {
    subject: AuthSubject;
    flagId: CapabilityFlagId;
    state: CapabilityFlagState;
    allowlistedSubjects: CapabilityFlagSubject[];
    reason: string;
    expectedVersion?: number;
  }) {
    assertScope(input.subject, "capabilities:manage");
    requiredDefinition(input.flagId);
    const reason = input.reason.trim();
    if (reason.length === 0 || reason.length > 1_000)
      throw new ApiError(
        "capability_flag_invalid",
        "A bounded capability flag reason is required.",
        400,
      );
    const allowlistedSubjects = normalizeAllowlist(input.allowlistedSubjects);
    if (input.state === "preview" && allowlistedSubjects.length === 0)
      throw new ApiError(
        "capability_flag_invalid",
        "Preview requires at least one allowlisted subject.",
        400,
      );
    if (input.state !== "preview" && allowlistedSubjects.length > 0)
      throw new ApiError(
        "capability_flag_invalid",
        "Allowlists are only valid for preview flags.",
        400,
      );
    await Promise.all(
      allowlistedSubjects.map((candidate) =>
        this.assertSubjectInOrganization(input.subject.orgId, candidate),
      ),
    );
    const createdAt = new Date().toISOString();
    try {
      return await this.repository.transaction(async (repository) => {
        const stored = await repository.replaceOrganizationCapabilityFlag({
          flag: {
            id: createId("capability_flag"),
            orgId: input.subject.orgId,
            flagId: input.flagId,
            state: input.state,
            allowlistedSubjects,
            actorId: input.subject.id,
            reason,
            createdAt,
          },
          ...(input.expectedVersion === undefined
            ? {}
            : { expectedVersion: input.expectedVersion }),
        });
        await writeAuditLog(repository, {
          subject: input.subject,
          action: "admin.capability_flag.replace",
          resourceType: "capability_flag",
          resourceId: stored.id,
          metadata: {
            flagId: stored.flagId,
            state: stored.state,
            version: stored.version,
            allowlistedSubjectCount: stored.allowlistedSubjects.length,
          },
        });
        return stored;
      });
    } catch (caught) {
      if (caught instanceof CapabilityFlagVersionConflictError)
        throw new ApiError(
          "capability_flag_version_conflict",
          "The capability flag changed. Refresh and try again.",
          409,
        );
      throw caught;
    }
  }

  private async assertSubjectInOrganization(
    orgId: string,
    candidate: CapabilityFlagSubject,
  ): Promise<void> {
    const principal =
      candidate.subjectType === "user"
        ? await this.repository.getCurrentUser(candidate.subjectId)
        : await this.repository.getServiceAccount(candidate.subjectId);
    if (
      principal === undefined ||
      principal.orgId !== orgId ||
      principal.disabledAt !== undefined
    )
      throw notFound("Allowlisted subject");
  }
}

function normalizeAllowlist(
  input: CapabilityFlagSubject[],
): CapabilityFlagSubject[] {
  const byKey = new Map<string, CapabilityFlagSubject>();
  for (const subject of input)
    byKey.set(`${subject.subjectType}\u001f${subject.subjectId}`, {
      ...subject,
    });
  return [...byKey.values()].sort(
    (left, right) =>
      left.subjectType.localeCompare(right.subjectType) ||
      left.subjectId.localeCompare(right.subjectId),
  );
}

function requiredDefinition(flagId: CapabilityFlagId) {
  const definition = capabilityFlagDefinitions.find(
    (candidate) => candidate.id === flagId,
  );
  if (definition === undefined) throw notFound("Capability flag");
  return definition;
}

function resolveEffectiveFlag(
  subject: AuthSubject,
  definition: (typeof capabilityFlagDefinitions)[number],
  configured:
    | Awaited<
        ReturnType<RomeoRepository["listActiveOrganizationCapabilityFlags"]>
      >[number]
    | undefined,
  platformPolicy: CapabilityPlatformPolicy,
): EffectiveCapabilityFlag {
  const state = configured?.state ?? definition.defaultState;
  const platformId = definition.platformCapabilityId;
  if (
    platformId !== undefined &&
    platformPolicy.disabledCapabilityIds.includes(platformId)
  )
    return result("disabled", "platform_disabled");
  if (state === "disabled") return result("disabled", "disabled");
  if (state === "enabled") return result("enabled", "enabled");
  const allowlisted =
    configured?.allowlistedSubjects.some(
      (candidate) =>
        candidate.subjectType === subject.type &&
        candidate.subjectId === subject.id,
    ) ?? false;
  return result(
    allowlisted ? "enabled" : "disabled",
    allowlisted ? "preview_allowlisted" : "preview_not_allowlisted",
  );

  function result(
    effectiveState: "disabled" | "enabled",
    reasonCode: EffectiveCapabilityFlag["reasonCode"],
  ): EffectiveCapabilityFlag {
    return {
      flagId: definition.id,
      configuredState: state,
      effectiveState,
      reasonCode,
      ...(configured === undefined ? {} : { version: configured.version }),
    };
  }
}

function platformCapabilityId(flagId: CapabilityFlagId): string | undefined {
  switch (flagId) {
    case "provider_capabilities_v2":
      return "external_provider_use";
    case "image_jobs_v2":
      return "image_generation";
    case "realtime_voice_v1":
      return "realtime_voice";
    case "compute_artifacts_v1":
      return "secure_compute";
    case "compare_consensus_v1":
      return "multi_model_compare";
    case "content_firewall_v2":
      return "streamed_output_policy";
    default:
      return undefined;
  }
}
