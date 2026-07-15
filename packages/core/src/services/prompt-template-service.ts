import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
  type ResourceGrant,
} from "@romeo/auth";

import type {
  PromptTemplate,
  PromptTemplateVisibility,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { assertWorkspaceActive } from "./workspace-guard";

export interface PromptTemplateInput {
  workspaceId: string;
  name: string;
  body: string;
  description?: string | undefined;
  tags?: string[] | undefined;
  visibility?: PromptTemplateVisibility | undefined;
}

export interface PromptTemplateUpdate {
  name?: string | undefined;
  body?: string | undefined;
  description?: string | null | undefined;
  tags?: string[] | undefined;
  visibility?: PromptTemplateVisibility | undefined;
}

export interface PromptTemplateShareInput {
  principalType: ResourceGrant["principalType"];
  principalId: string;
  permissions: ResourceGrant["permission"][];
}

export class PromptTemplateService {
  constructor(private readonly repository: RomeoRepository) {}

  async list(
    subject: AuthSubject,
    workspaceId: string,
    query = "",
  ): Promise<PromptTemplate[]> {
    assertScope(subject, "agents:read");
    if (!hasWorkspaceAccess(subject, workspaceId))
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    const [templates, grants] = await Promise.all([
      this.repository.listPromptTemplates(subject.orgId, workspaceId),
      this.repository.listResourceGrants(subject.orgId),
    ]);
    const normalizedQuery = query.trim().toLowerCase();
    return templates
      .filter((template) => canReadPrompt(subject, grants, template))
      .filter((template) => promptMatches(template, normalizedQuery));
  }

  async marketplace(
    subject: AuthSubject,
    workspaceId: string,
    query = "",
  ): Promise<PromptTemplate[]> {
    const templates = await this.list(subject, workspaceId, query);
    return templates.filter(
      (template) => template.visibility === "marketplace",
    );
  }

  async get(
    subject: AuthSubject,
    promptTemplateId: string,
  ): Promise<PromptTemplate> {
    const { template } = await this.authorizedPrompt(
      subject,
      promptTemplateId,
      "read",
    );
    return template;
  }

  async create(
    subject: AuthSubject,
    input: PromptTemplateInput,
  ): Promise<PromptTemplate> {
    assertScope(subject, "agents:write");
    if (!hasWorkspaceAccess(subject, input.workspaceId))
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    await assertWorkspaceActive(this.repository, {
      orgId: subject.orgId,
      workspaceId: input.workspaceId,
    });
    return this.repository.transaction(async (repository) => {
      const now = new Date().toISOString();
      const template = await repository.createPromptTemplate({
        id: createId("prompt"),
        orgId: subject.orgId,
        workspaceId: input.workspaceId,
        name: input.name.trim(),
        body: input.body,
        tags: normalizeTags(input.tags ?? []),
        visibility: input.visibility ?? "private",
        createdBy: subject.id,
        createdAt: now,
        updatedAt: now,
        ...(input.description === undefined
          ? {}
          : { description: input.description.trim() }),
      });
      await Promise.all(
        (["read", "use", "write"] as const).map((permission) =>
          repository.createResourceGrant({
            id: createId("grant"),
            resourceType: "prompt_template",
            resourceId: template.id,
            principalType: subject.type,
            principalId: subject.id,
            permission,
          }),
        ),
      );
      await this.audit(
        repository,
        subject,
        "prompt_template.create",
        template.id,
        {
          workspaceId: template.workspaceId,
          visibility: template.visibility,
          tagCount: template.tags.length,
        },
      );
      return template;
    });
  }

  async update(
    subject: AuthSubject,
    promptTemplateId: string,
    input: PromptTemplateUpdate,
  ): Promise<PromptTemplate> {
    const { template } = await this.authorizedPrompt(
      subject,
      promptTemplateId,
      "write",
    );
    const updated: PromptTemplate = {
      ...template,
      updatedAt: new Date().toISOString(),
    };
    if (input.name !== undefined) updated.name = input.name.trim();
    if (input.body !== undefined) updated.body = input.body;
    if (input.description !== undefined) {
      if (input.description === null) delete updated.description;
      else updated.description = input.description.trim();
    }
    if (input.tags !== undefined) updated.tags = normalizeTags(input.tags);
    if (input.visibility !== undefined) updated.visibility = input.visibility;
    return this.repository.transaction(async (repository) => {
      const stored = await repository.updatePromptTemplate(updated);
      await this.audit(
        repository,
        subject,
        "prompt_template.update",
        stored.id,
        {
          changedFields: Object.keys(input).sort(),
          visibility: stored.visibility,
          tagCount: stored.tags.length,
        },
      );
      return stored;
    });
  }

  async delete(
    subject: AuthSubject,
    promptTemplateId: string,
  ): Promise<PromptTemplate> {
    const { template } = await this.authorizedPrompt(
      subject,
      promptTemplateId,
      "write",
    );
    return this.repository.transaction(async (repository) => {
      const deleted = await repository.deletePromptTemplate(template.id);
      if (!deleted) throw notFound("Prompt template");
      await this.audit(
        repository,
        subject,
        "prompt_template.delete",
        template.id,
        {
          workspaceId: template.workspaceId,
          visibility: template.visibility,
        },
      );
      return deleted;
    });
  }

  async shares(
    subject: AuthSubject,
    promptTemplateId: string,
  ): Promise<ResourceGrant[]> {
    const { template } = await this.authorizedPrompt(
      subject,
      promptTemplateId,
      "read",
    );
    return this.promptShares(template.id, subject.orgId);
  }

  async share(input: {
    subject: AuthSubject;
    promptTemplateId: string;
    share: PromptTemplateShareInput;
  }): Promise<ResourceGrant[]> {
    const { template } = await this.authorizedPrompt(
      input.subject,
      input.promptTemplateId,
      "write",
    );
    validateShare(input.share);
    return this.repository.transaction(async (repository) => {
      const existing = await this.promptShares(
        template.id,
        input.subject.orgId,
        repository,
      );
      const grants: ResourceGrant[] = [];
      for (const permission of [...new Set(input.share.permissions)]) {
        const grant = existing.find(
          (candidate) =>
            candidate.principalType === input.share.principalType &&
            candidate.principalId === input.share.principalId &&
            candidate.permission === permission,
        );
        if (grant) grants.push(grant);
        else {
          grants.push(
            await repository.createResourceGrant({
              id: createId("grant"),
              resourceType: "prompt_template",
              resourceId: template.id,
              principalType: input.share.principalType,
              principalId: input.share.principalId,
              permission,
            }),
          );
        }
      }
      await this.audit(
        repository,
        input.subject,
        "prompt_template.share",
        template.id,
        {
          principalType: input.share.principalType,
          permissions: grants.map((grant) => grant.permission),
        },
      );
      return grants;
    });
  }

  private async authorizedPrompt(
    subject: AuthSubject,
    promptTemplateId: string,
    permission: "read" | "write",
  ): Promise<{ template: PromptTemplate; grants: ResourceGrant[] }> {
    assertScope(
      subject,
      permission === "read" ? "agents:read" : "agents:write",
    );
    const template = await this.repository.getPromptTemplate(promptTemplateId);
    if (!template || !canAccessOrg(subject, template.orgId))
      throw notFound("Prompt template");
    if (!hasWorkspaceAccess(subject, template.workspaceId))
      throw new AuthorizationError(
        "The prompt template is outside the caller workspace access.",
      );
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (
      permission === "read"
        ? !canReadPrompt(subject, grants, template)
        : !canWritePrompt(subject, grants, template)
    ) {
      throw new AuthorizationError(
        `Missing ${permission} permission for prompt_template:${template.id}`,
      );
    }
    return { template, grants };
  }

  private async promptShares(
    promptTemplateId: string,
    orgId: string,
    repository: RomeoRepository = this.repository,
  ): Promise<ResourceGrant[]> {
    return (await repository.listResourceGrants(orgId)).filter(
      (grant) =>
        grant.resourceType === "prompt_template" &&
        grant.resourceId === promptTemplateId,
    );
  }

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
    promptTemplateId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await repository.createAuditLog({
      id: createId("audit"),
      orgId: subject.orgId,
      actorId: subject.id,
      action,
      resourceType: "prompt_template",
      resourceId: promptTemplateId,
      outcome: "success",
      metadata,
      createdAt: new Date().toISOString(),
    });
  }
}

function canReadPrompt(
  subject: AuthSubject,
  grants: ResourceGrant[],
  template: PromptTemplate,
): boolean {
  return (
    subject.isAdmin === true ||
    template.createdBy === subject.id ||
    template.visibility !== "private" ||
    hasGrant(subject, grants, "prompt_template", template.id, "read") ||
    hasGrant(subject, grants, "prompt_template", template.id, "use") ||
    hasGrant(subject, grants, "prompt_template", template.id, "write")
  );
}

function canWritePrompt(
  subject: AuthSubject,
  grants: ResourceGrant[],
  template: PromptTemplate,
): boolean {
  return (
    subject.isAdmin === true ||
    template.createdBy === subject.id ||
    hasGrant(subject, grants, "prompt_template", template.id, "write")
  );
}

function promptMatches(template: PromptTemplate, query: string): boolean {
  if (query.length === 0) return true;
  const haystack = [template.name, template.description ?? "", ...template.tags]
    .join(" ")
    .toLowerCase();
  return haystack.includes(query);
}

function normalizeTags(tags: string[]): string[] {
  return [
    ...new Set(
      tags
        .map((tag) => tag.trim().toLowerCase())
        .filter((tag) => tag.length > 0),
    ),
  ].slice(0, 20);
}

function validateShare(share: PromptTemplateShareInput): void {
  if (share.principalId.trim().length === 0)
    throw new ApiError(
      "invalid_share_principal",
      "Share principal ID is required.",
      400,
    );
  const permissions = new Set<ResourceGrant["permission"]>([
    "read",
    "use",
    "write",
  ]);
  const invalid = share.permissions.filter(
    (permission) => !permissions.has(permission),
  );
  if (invalid.length > 0)
    throw new ApiError(
      "invalid_share_permission",
      "Share includes an unsupported permission.",
      400,
      { permissions: invalid },
    );
}
