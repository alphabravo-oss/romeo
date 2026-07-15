import { and, asc, eq, isNull } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { organizations, workspaces } from "./schema";
import { optionalDate, optionalIsoString } from "./repository-mapping";

export interface OrganizationRecord {
  id: string;
  name: string;
  slug: string;
}

export interface WorkspaceRecord {
  id: string;
  orgId: string;
  name: string;
  slug: string;
  archivedAt?: string;
}

export class PgTenantRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listAllOrganizations(): Promise<OrganizationRecord[]> {
    const rows = await this.db
      .select()
      .from(organizations)
      .orderBy(asc(organizations.name));
    return rows.map(toOrganizationRecord);
  }

  async listOrganizations(orgId: string): Promise<OrganizationRecord[]> {
    const rows = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .orderBy(asc(organizations.name));
    return rows.map(toOrganizationRecord);
  }

  async getOrganization(
    orgId: string,
  ): Promise<OrganizationRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(organizations)
      .where(eq(organizations.id, orgId))
      .limit(1);
    return row === undefined ? undefined : toOrganizationRecord(row);
  }

  async createOrganization(
    organization: OrganizationRecord,
  ): Promise<OrganizationRecord> {
    const now = new Date();
    const [row] = await this.db
      .insert(organizations)
      .values({
        id: organization.id,
        name: organization.name,
        slug: organization.slug,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row === undefined ? organization : toOrganizationRecord(row);
  }

  async updateOrganization(
    organization: OrganizationRecord,
  ): Promise<OrganizationRecord> {
    const [row] = await this.db
      .update(organizations)
      .set({
        name: organization.name,
        slug: organization.slug,
        updatedAt: new Date(),
      })
      .where(eq(organizations.id, organization.id))
      .returning();
    return row === undefined ? organization : toOrganizationRecord(row);
  }

  async listWorkspaces(orgId: string): Promise<WorkspaceRecord[]> {
    const rows = await this.db
      .select()
      .from(workspaces)
      .where(and(eq(workspaces.orgId, orgId), isNull(workspaces.archivedAt)))
      .orderBy(asc(workspaces.name));
    return rows.map(toWorkspaceRecord);
  }

  async getWorkspace(
    workspaceId: string,
  ): Promise<WorkspaceRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(workspaces)
      .where(eq(workspaces.id, workspaceId))
      .limit(1);
    return row === undefined ? undefined : toWorkspaceRecord(row);
  }

  async createWorkspace(workspace: WorkspaceRecord): Promise<WorkspaceRecord> {
    const now = new Date();
    const [row] = await this.db
      .insert(workspaces)
      .values({
        id: workspace.id,
        orgId: workspace.orgId,
        name: workspace.name,
        slug: workspace.slug,
        archivedAt: optionalDate(workspace.archivedAt),
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    return row === undefined ? workspace : toWorkspaceRecord(row);
  }

  async updateWorkspace(workspace: WorkspaceRecord): Promise<WorkspaceRecord> {
    const [row] = await this.db
      .update(workspaces)
      .set({
        archivedAt: optionalDate(workspace.archivedAt),
        name: workspace.name,
        slug: workspace.slug,
        updatedAt: new Date(),
      })
      .where(eq(workspaces.id, workspace.id))
      .returning();
    return row === undefined ? workspace : toWorkspaceRecord(row);
  }
}

export function toOrganizationRecord(
  row: typeof organizations.$inferSelect,
): OrganizationRecord {
  return {
    id: row.id,
    name: row.name,
    slug: row.slug,
  };
}

export function toWorkspaceRecord(
  row: typeof workspaces.$inferSelect,
): WorkspaceRecord {
  const workspace: WorkspaceRecord = {
    id: row.id,
    orgId: row.orgId,
    name: row.name,
    slug: row.slug,
  };
  const archivedAt = optionalIsoString(row.archivedAt);
  if (archivedAt !== undefined) workspace.archivedAt = archivedAt;
  return workspace;
}
