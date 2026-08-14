import { assertScope, type AuthSubject } from "@romeo/auth";
import type { CapabilityAssignment } from "../domain/capabilities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { assertGlobalAdmin } from "./auth-provider-settings-storage";
import { updateCapabilityAssignment } from "./capability-assignment-update";
import {
  summarizeCapabilityImpact,
  type CapabilityImpactPreview,
} from "./capability-impact-preview";
import { PolicyBundleService } from "./policy-bundle-service";
import type { CapabilityResolutionCacheEntry } from "./capability-resolution-cache";
import type { CapabilityPlatformPolicy } from "./capability-platform-policy";
import type { OrganizationCapabilityFlagService } from "./organization-capability-flag-service";
import { assignmentSubjectForAdminScope } from "./capability-assignment-context";
import {
  CAPABILITY_REGISTRY_VERSION,
  listCapabilityDefinitions,
  parseCapabilityConfigurationPatch,
  type CapabilityDefinition,
  type CapabilityId,
} from "./capability-definition-registry";
import { enforceGenericCapability } from "./capability-generic-resolution";
import {
  invalidateCapabilityResolutionCache,
  previewAssignmentExpiry,
  resolveCapabilityWithDetails,
} from "./capability-resolve-with-details";
import {
  assertCapabilityScopeRef,
  controllingAssignment,
  layerForAssignment,
  requiredCapabilityDefinition,
  workspaceForCapabilityScope,
  type AuthorizeImageGenerationInput,
  type CapabilityExplainInput,
  type CapabilityHistoryInput,
  type CapabilityLayer,
  type CapabilityScopeContextInput,
  type EffectiveCapability,
  type ResolutionDetails,
  type ResolveCapabilityInput,
  type ResolveManyCapabilityInput,
  type PreviewCapabilityAssignmentInput,
  type UpdateCapabilityAssignmentInput,
} from "./capability-resolution-model";
import {
  authorizeImageGenerationCapability,
  resolveManyCapabilities,
} from "./capability-request-resolution";

export class CapabilityService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly platformPolicy: CapabilityPlatformPolicy = {
      disabledCapabilityIds: [],
    },
    private readonly organizationFlags?: OrganizationCapabilityFlagService,
    private readonly policyBundles = new PolicyBundleService(repository),
  ) {}

  private readonly resolutionCache = new Map<
    string,
    CapabilityResolutionCacheEntry
  >();

  definitions(subject: AuthSubject): CapabilityDefinition[] {
    assertScope(subject, "capabilities:read");
    return listCapabilityDefinitions();
  }

  platformPosture(subject: AuthSubject) {
    assertScope(subject, "capabilities:read");
    assertGlobalAdmin(subject);
    const disabled = new Set(this.platformPolicy.disabledCapabilityIds);
    return {
      registryVersion: CAPABILITY_REGISTRY_VERSION,
      controlPlane: "deployment_environment" as const,
      mutableViaApi: false as const,
      capabilities: listCapabilityDefinitions().map((definition) => {
        const platformDisabled = disabled.has(definition.id);
        return {
          capabilityId: definition.id,
          lifecycle: definition.lifecycle,
          risk: definition.risk,
          state: platformDisabled
            ? ("disabled" as const)
            : ("enabled" as const),
          reason: platformDisabled
            ? ("platform_disabled" as const)
            : ("allowed" as const),
        };
      }),
    };
  }

  async resolve(input: ResolveCapabilityInput): Promise<EffectiveCapability> {
    return (await this.resolveWithDetails(input)).effective;
  }

  async resolveMany(
    input: ResolveManyCapabilityInput,
  ): Promise<EffectiveCapability[]> {
    return resolveManyCapabilities(input, (item) => this.resolve(item));
  }

  async authorizeImageGeneration(
    input: AuthorizeImageGenerationInput,
  ): Promise<{ count: number }> {
    return authorizeImageGenerationCapability(input, (item) =>
      this.resolve(item),
    );
  }

  async authorizeOperation(input: ResolveCapabilityInput) {
    if (input.capabilityId === "image_generation")
      throw new Error("Image generation uses its typed authorization path.");
    return enforceGenericCapability(await this.resolve(input));
  }

  async adminOverview(input: CapabilityScopeContextInput) {
    assertScope(input.subject, "capabilities:read");
    await assertCapabilityScopeRef(this.repository, input.subject, input.scope);
    const workspaceId = await workspaceForCapabilityScope(
      this.repository,
      input.subject,
      input.scope,
      input.workspaceId,
    );
    const definitions = listCapabilityDefinitions();
    const rows = await Promise.all(
      definitions.map(async (definition) => {
        const details = await this.resolveWithDetails(
          {
            subject: input.subject,
            capabilityId: definition.id,
            workspaceId,
            ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
            ...(input.scope.scopeType === "agent"
              ? { agentId: input.scope.scopeId }
              : {}),
            assignmentSubject: await assignmentSubjectForAdminScope(
              this.repository,
              input.subject,
              input.scope,
            ),
          },
          input.scope,
        );
        const configuredAssignment = details.assignments.find(
          (assignment) =>
            assignment.scopeType === input.scope.scopeType &&
            assignment.scopeId === input.scope.scopeId,
        );
        const inheritedAssignment =
          input.scope.scopeType === "workspace"
            ? details.assignments.find(
                (assignment) => assignment.scopeType === "organization",
              )
            : undefined;
        const controlling = controllingAssignment(details.assignments);
        return {
          definition,
          ...(configuredAssignment === undefined
            ? {}
            : { configuredAssignment }),
          ...(inheritedAssignment === undefined ? {} : { inheritedAssignment }),
          effective: details.effective,
          ...(controlling === undefined
            ? {}
            : { controllingLayer: layerForAssignment(controlling) }),
          canOverride:
            definition.allowedStates.length > 0 &&
            definition.controllingLayers.includes(input.scope.scopeType),
        };
      }),
    );
    return {
      scopeType: input.scope.scopeType,
      scopeId: input.scope.scopeId,
      registryVersion: CAPABILITY_REGISTRY_VERSION,
      capabilities: rows,
    };
  }

  async history(
    input: CapabilityHistoryInput,
  ): Promise<CapabilityAssignment[]> {
    assertScope(input.subject, "capabilities:read");
    requiredCapabilityDefinition(input.capabilityId);
    await assertCapabilityScopeRef(this.repository, input.subject, input.scope);
    return this.repository.listCapabilityAssignmentHistory({
      orgId: input.subject.orgId,
      scope: input.scope,
      capabilityId: input.capabilityId,
      limit: 100,
    });
  }

  async explain(input: CapabilityExplainInput) {
    assertScope(input.subject, "capabilities:read");
    await assertCapabilityScopeRef(this.repository, input.subject, input.scope);
    const workspaceId = await workspaceForCapabilityScope(
      this.repository,
      input.subject,
      input.scope,
      input.workspaceId,
    );
    const details = await this.resolveWithDetails(
      {
        subject: input.subject,
        capabilityId: input.capabilityId,
        workspaceId,
        ...(input.modelId === undefined ? {} : { modelId: input.modelId }),
        ...(input.scope.scopeType === "agent"
          ? { agentId: input.scope.scopeId }
          : {}),
        assignmentSubject: await assignmentSubjectForAdminScope(
          this.repository,
          input.subject,
          input.scope,
        ),
      },
      input.scope,
    );
    const assignments: Array<{
      id: string;
      layer: CapabilityLayer;
      version: number;
      state: CapabilityAssignment["state"];
      expiresAt?: string;
    }> = details.assignments.map((assignment) => ({
      id: assignment.id,
      layer: layerForAssignment(assignment),
      version: assignment.version,
      state: assignment.state,
      ...(assignment.expiresAt === undefined
        ? {}
        : { expiresAt: assignment.expiresAt }),
    }));
    if (details.agentVersionDefault !== undefined) {
      assignments.push({
        id: details.agentVersionDefault.agentVersionId,
        layer: "agent_version" as const,
        version: details.agentVersionDefault.assignmentVersion,
        state: details.agentVersionDefault.state,
        ...(details.agentVersionDefault.expiresAt === undefined
          ? {}
          : { expiresAt: details.agentVersionDefault.expiresAt }),
      });
    }
    return {
      effective: details.effective,
      assignments,
    };
  }

  async updateAssignment(
    input: UpdateCapabilityAssignmentInput,
  ): Promise<CapabilityAssignment> {
    const published = await this.publishAssignment(input);
    if ("publicationRequired" in published) {
      throw new ApiError(
        "policy_bundle_approval_required",
        "This change requires a distinct approver before it can take effect.",
        403,
        { bundleId: published.id },
      );
    }
    this.dropResolutionCache(input.subject.orgId);
    return published;
  }

  async previewImpact(
    input: PreviewCapabilityAssignmentInput & {
      samples: Array<{
        role: "admin" | "member" | "service_account";
        workspaceClass: "default" | "regulated" | "general";
      }>;
    },
  ): Promise<CapabilityImpactPreview> {
    const workspaceId =
      input.workspaceId ??
      (input.scope.scopeType === "workspace" ? input.scope.scopeId : undefined);
    const current = await this.resolve({
      subject: input.subject,
      capabilityId: input.capabilityId,
      ...(workspaceId === undefined ? {} : { workspaceId }),
      ...(input.requested === undefined ? {} : { requested: input.requested }),
    });
    const proposed = await this.previewAssignment({
      ...input,
      ...(workspaceId === undefined ? {} : { workspaceId }),
    });
    return summarizeCapabilityImpact([
      {
        role: "admin",
        workspaceClass: "default",
        effective: current,
      },
      ...input.samples.map((sample) => ({
        role: sample.role,
        workspaceClass: sample.workspaceClass,
        effective: proposed,
      })),
    ]);
  }

  async publishAssignment(input: UpdateCapabilityAssignmentInput) {
    const current = (
      await this.repository.listActiveCapabilityAssignments({
        orgId: input.subject.orgId,
        scopes: [input.scope],
        capabilityIds: [input.capabilityId],
        at: new Date().toISOString(),
      })
    )[0];
    const proposed = await this.policyBundles.propose({
      subject: input.subject,
      capabilityId: input.capabilityId,
      currentState: current?.state ?? "unset",
      nextState: input.state,
      reason: input.reason,
      scopeType: input.scope.scopeType,
      assignment: {
        scopeType: input.scope.scopeType,
        scopeId: input.scope.scopeId,
        configuration: input.configuration,
        reason: input.reason,
        ...(input.expectedVersion === undefined
          ? {}
          : { expectedVersion: input.expectedVersion }),
        ...(input.expiresAt === undefined ? {} : { expiresAt: input.expiresAt }),
        ...(input.workspaceId === undefined
          ? {}
          : { workspaceId: input.workspaceId }),
      },
    });
    if (proposed.outcome === "pending")
      return this.policyBundles.publicBundle(proposed.bundle);
    const stored = await updateCapabilityAssignment(this.repository, input);
    this.dropResolutionCache(input.subject.orgId);
    return stored;
  }

  async approvePublication(input: {
    subject: import("@romeo/auth").AuthSubject;
    bundleId: string;
    reason: string;
  }) {
    const published = await this.policyBundles.approve(input);
    const change = published.changes[0];
    const assignment = change?.assignment;
    if (change !== undefined && assignment !== undefined) {
      await updateCapabilityAssignment(this.repository, {
        subject: input.subject,
        capabilityId: change.capabilityId as CapabilityId,
        scope: {
          scopeType: assignment.scopeType,
          scopeId: assignment.scopeId,
        },
        state: change.nextState,
        configuration: assignment.configuration,
        reason: assignment.reason,
        ...(assignment.expectedVersion === undefined
          ? {}
          : { expectedVersion: assignment.expectedVersion }),
        ...(assignment.expiresAt === undefined
          ? {}
          : { expiresAt: assignment.expiresAt }),
        ...(assignment.workspaceId === undefined
          ? {}
          : { workspaceId: assignment.workspaceId }),
      });
    }
    this.dropResolutionCache(input.subject.orgId);
    return this.policyBundles.publicBundle(published);
  }

  async previewAssignment(
    input: PreviewCapabilityAssignmentInput,
  ): Promise<EffectiveCapability> {
    assertScope(input.subject, "capabilities:manage");
    const definition = requiredCapabilityDefinition(input.capabilityId);
    await assertCapabilityScopeRef(this.repository, input.subject, input.scope);
    if (!definition.allowedStates.includes(input.state))
      throw new ApiError(
        "capability_assignment_state_unsupported",
        "The assignment state is not supported by this capability.",
        400,
      );
    if (!definition.controllingLayers.includes(input.scope.scopeType))
      throw new ApiError(
        "capability_assignment_invalid",
        "The capability cannot be assigned at the requested scope.",
        400,
      );
    const configuration = parseCapabilityConfigurationPatch(
      definition.id,
      input.configuration,
    );
    const now = new Date().toISOString();
    const expiresAt = previewAssignmentExpiry(input.expiresAt, now);
    const preview: CapabilityAssignment = {
      id: "capability_assignment_preview",
      orgId: input.subject.orgId,
      scopeType: input.scope.scopeType,
      scopeId: input.scope.scopeId,
      capabilityId: input.capabilityId,
      state: input.state,
      configuration: { ...configuration },
      version: 1,
      actorId: input.subject.id,
      reason: "preview",
      effectiveAt: now,
      createdAt: now,
      ...(expiresAt === undefined ? {} : { expiresAt }),
    };
    return (
      await this.resolveWithDetails(
        {
          subject: input.subject,
          capabilityId: input.capabilityId,
          ...(input.workspaceId === undefined
            ? {}
            : { workspaceId: input.workspaceId }),
          ...(input.requested === undefined
            ? {}
            : { requested: input.requested }),
        },
        input.scope,
        preview,
      )
    ).effective;
  }

  private async resolveWithDetails(
    input: ResolveCapabilityInput,
    previewScope?: import("../domain/capabilities").CapabilityScopeRef,
    assignmentOverride?: CapabilityAssignment,
  ): Promise<ResolutionDetails> {
    return resolveCapabilityWithDetails(
      {
        repository: this.repository,
        platformPolicy: this.platformPolicy,
        ...(this.organizationFlags === undefined
          ? {}
          : { organizationFlags: this.organizationFlags }),
        resolutionCache: this.resolutionCache,
      },
      input,
      previewScope,
      assignmentOverride,
    );
  }

  private dropResolutionCache(orgId: string): void {
    invalidateCapabilityResolutionCache(this.resolutionCache, orgId);
  }
}
