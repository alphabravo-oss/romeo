import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";

import type { Workspace } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";

export interface WorkspaceExportDocument {
  schema: "romeo.workspace-export.v1";
  orgId: string;
  workspace: Pick<Workspace, "archivedAt" | "id" | "name" | "orgId" | "slug">;
  counts: {
    agents: number;
    chats: number;
    messages: number;
    knowledgeBases: number;
    dataConnectors: number;
    workflows: number;
  };
  resources: {
    agents: Array<{
      id: string;
      publishedVersionId?: string;
      updatedAt: string;
    }>;
    chats: Array<{ id: string; archivedAt?: string; updatedAt: string }>;
    knowledgeBases: Array<{ id: string; createdAt: string; updatedAt: string }>;
    dataConnectors: Array<{
      id: string;
      knowledgeBaseId: string;
      status: string;
      type: string;
    }>;
    workflows: Array<{
      enabled: boolean;
      id: string;
      stepCount: number;
      updatedAt: string;
    }>;
  };
  exportedAt: string;
}

export class WorkspaceService {
  constructor(private readonly repository: RomeoRepository) {}

  async bootstrap(subject: AuthSubject) {
    const [user, organizations, workspaces] = await Promise.all([
      this.repository.getCurrentUser(subject.id),
      this.repository.listOrganizations(subject.orgId),
      this.repository.listWorkspaces(subject.orgId),
    ]);

    return { user, organizations, workspaces };
  }

  async create(input: {
    subject: AuthSubject;
    name: string;
    slug?: string | undefined;
  }): Promise<Workspace> {
    assertScope(input.subject, "admin:write");
    const slug = normalizeSlug(input.slug ?? input.name);
    if (slug.length === 0)
      throw new ApiError(
        "invalid_workspace_slug",
        "Workspace slug must contain letters or numbers.",
        400,
      );
    const existing = (
      await this.repository.listWorkspaces(input.subject.orgId)
    ).find(
      (workspace) =>
        workspace.slug === slug || workspace.id === `workspace_${slug}`,
    );
    if (existing !== undefined) return existing;
    const archivedWithSameId = await this.repository.getWorkspace(
      `workspace_${slug}`,
    );
    if (archivedWithSameId !== undefined) {
      throw new ApiError(
        "workspace_slug_unavailable",
        "Workspace slug is already reserved.",
        409,
        {
          slug,
        },
      );
    }
    return this.repository.transaction(async (repository) => {
      const workspace = await repository.createWorkspace({
        id: `workspace_${slug}`,
        orgId: input.subject.orgId,
        name: input.name.trim(),
        slug,
      });
      await this.audit(
        repository,
        input.subject,
        "workspace.create",
        workspace.id,
        {
          slug: workspace.slug,
        },
      );
      return workspace;
    });
  }

  async archive(input: {
    subject: AuthSubject;
    workspaceId: string;
  }): Promise<Workspace> {
    assertScope(input.subject, "admin:write");
    const workspace = await this.workspaceForSubject(
      this.repository,
      input.subject,
      input.workspaceId,
    );
    if (workspace.archivedAt !== undefined) return workspace;

    const archivedAt = new Date().toISOString();
    return this.repository.transaction(async (repository) => {
      const currentWorkspace = await this.workspaceForSubject(
        repository,
        input.subject,
        input.workspaceId,
      );
      if (currentWorkspace.archivedAt !== undefined) return currentWorkspace;
      const updated = await repository.updateWorkspace({
        ...currentWorkspace,
        archivedAt,
      });
      await this.audit(
        repository,
        input.subject,
        "workspace.archive",
        updated.id,
        {
          archivedAt,
        },
      );
      return updated;
    });
  }

  async exportWorkspace(input: {
    subject: AuthSubject;
    workspaceId: string;
  }): Promise<WorkspaceExportDocument> {
    assertScope(input.subject, "admin:read");
    const workspace = await this.workspaceForSubject(
      this.repository,
      input.subject,
      input.workspaceId,
    );
    const [agents, chats, knowledgeBases, dataConnectors, workflows] =
      await Promise.all([
        this.repository.listAgents(workspace.id),
        this.repository.listChats(workspace.id),
        this.repository.listKnowledgeBases(workspace.id),
        this.repository.listDataConnectors(input.subject.orgId, workspace.id),
        this.repository.listWorkflowDefinitions(
          input.subject.orgId,
          workspace.id,
        ),
      ]);
    const messages = await Promise.all(
      chats.map((chat) => this.repository.listMessages(chat.id)),
    );
    const exportedAt = new Date().toISOString();
    await this.audit(
      this.repository,
      input.subject,
      "workspace.export",
      workspace.id,
      {
        counts: {
          agents: agents.length,
          chats: chats.length,
          messages: messages.reduce((count, rows) => count + rows.length, 0),
          knowledgeBases: knowledgeBases.length,
          dataConnectors: dataConnectors.length,
          workflows: workflows.length,
        },
      },
    );

    return {
      schema: "romeo.workspace-export.v1",
      orgId: input.subject.orgId,
      workspace: workspaceExportSummary(workspace),
      counts: {
        agents: agents.length,
        chats: chats.length,
        messages: messages.reduce((count, rows) => count + rows.length, 0),
        knowledgeBases: knowledgeBases.length,
        dataConnectors: dataConnectors.length,
        workflows: workflows.length,
      },
      resources: {
        agents: agents.map((agent) => ({
          id: agent.id,
          ...(agent.publishedVersionId === undefined
            ? {}
            : { publishedVersionId: agent.publishedVersionId }),
          updatedAt: agent.updatedAt,
        })),
        chats: chats.map((chat) => ({
          id: chat.id,
          ...(chat.archivedAt === undefined
            ? {}
            : { archivedAt: chat.archivedAt }),
          updatedAt: chat.updatedAt,
        })),
        knowledgeBases: knowledgeBases.map((knowledgeBase) => ({
          id: knowledgeBase.id,
          createdAt: knowledgeBase.createdAt,
          updatedAt: knowledgeBase.updatedAt,
        })),
        dataConnectors: dataConnectors.map((connector) => ({
          id: connector.id,
          knowledgeBaseId: connector.knowledgeBaseId,
          status: connector.status,
          type: connector.type,
        })),
        workflows: workflows.map((workflow) => ({
          enabled: workflow.enabled,
          id: workflow.id,
          stepCount: workflow.steps.length,
          updatedAt: workflow.updatedAt,
        })),
      },
      exportedAt,
    };
  }

  private async workspaceForSubject(
    repository: RomeoRepository,
    subject: AuthSubject,
    workspaceId: string,
  ): Promise<Workspace> {
    const workspace = await repository.getWorkspace(workspaceId);
    if (!workspace) throw notFound("Workspace");
    if (!canAccessOrg(subject, workspace.orgId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller organization.",
      );
    }
    if (!hasWorkspaceAccess(subject, workspace.id)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    return workspace;
  }

  private async audit(
    repository: RomeoRepository,
    subject: AuthSubject,
    action: string,
    resourceId: string,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await writeAuditLog(repository, {
      subject,
      action,
      resourceType: "workspace",
      resourceId,
      metadata,
    });
  }
}

function normalizeSlug(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 80);
}

function workspaceExportSummary(
  workspace: Workspace,
): WorkspaceExportDocument["workspace"] {
  return {
    id: workspace.id,
    orgId: workspace.orgId,
    name: workspace.name,
    slug: workspace.slug,
    ...(workspace.archivedAt === undefined
      ? {}
      : { archivedAt: workspace.archivedAt }),
  };
}
