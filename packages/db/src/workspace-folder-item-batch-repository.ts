import type {
  AuthorizedWorkspaceFolderItemsBatchInput,
  WorkspaceFolderItemsBatchGroup,
} from "@romeo/core";
import {
  and,
  asc,
  eq,
  exists,
  inArray,
  isNotNull,
  isNull,
  lte,
  or,
  sql,
  type SQL,
} from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { toWorkspaceFolderItemRecord } from "./collaboration-record-mapping";
import {
  agentModels,
  chats,
  knowledgeBases,
  resourceGrants,
  workspaceFolderItems,
} from "./schema";

const maxFolderBatchSize = 50;
const maxItemsPerFolder = 200;

export class PgWorkspaceFolderItemBatchRepository {
  constructor(protected readonly db: RomeoDatabase) {}

  async listAuthorizedWorkspaceFolderItemsBatch(
    input: AuthorizedWorkspaceFolderItemsBatchInput,
  ): Promise<WorkspaceFolderItemsBatchGroup[]> {
    const folderIds = [...new Set(input.folderIds)]
      .sort()
      .slice(0, maxFolderBatchSize);
    if (folderIds.length === 0) return [];
    const limitPerFolder = normalizeLimit(input.limitPerFolder);
    const rank = sql<number>`row_number() over (
      partition by ${workspaceFolderItems.folderId}
      order by ${workspaceFolderItems.createdAt} asc, ${workspaceFolderItems.id} asc
    )`.as("folder_item_rank");
    const ranked = this.db
      .select({
        id: workspaceFolderItems.id,
        orgId: workspaceFolderItems.orgId,
        workspaceId: workspaceFolderItems.workspaceId,
        folderId: workspaceFolderItems.folderId,
        resourceType: workspaceFolderItems.resourceType,
        resourceId: workspaceFolderItems.resourceId,
        createdAt: workspaceFolderItems.createdAt,
        rank,
      })
      .from(workspaceFolderItems)
      .where(
        and(
          eq(workspaceFolderItems.orgId, input.orgId),
          eq(workspaceFolderItems.workspaceId, input.workspaceId),
          inArray(workspaceFolderItems.folderId, folderIds),
          this.resourceVisibilityPredicate(input),
        ),
      )
      .as("authorized_folder_items");
    const rows = await this.db
      .select({
        id: ranked.id,
        orgId: ranked.orgId,
        workspaceId: ranked.workspaceId,
        folderId: ranked.folderId,
        resourceType: ranked.resourceType,
        resourceId: ranked.resourceId,
        createdAt: ranked.createdAt,
      })
      .from(ranked)
      .where(lte(ranked.rank, limitPerFolder + 1))
      .orderBy(asc(ranked.folderId), asc(ranked.createdAt), asc(ranked.id));
    const records = rows.map(toWorkspaceFolderItemRecord);
    const itemsByFolderId = new Map<
      string,
      ReturnType<typeof toWorkspaceFolderItemRecord>[]
    >();
    for (const item of records) {
      const items = itemsByFolderId.get(item.folderId) ?? [];
      items.push(item);
      itemsByFolderId.set(item.folderId, items);
    }
    return folderIds.map((folderId) => {
      const items = itemsByFolderId.get(folderId) ?? [];
      return {
        folderId,
        hasMore: items.length > limitPerFolder,
        items: items.slice(0, limitPerFolder),
      };
    });
  }

  private resourceVisibilityPredicate(
    input: AuthorizedWorkspaceFolderItemsBatchInput,
  ): SQL {
    const predicates: SQL[] = [];
    if (input.canReadAgents) {
      predicates.push(
        and(
          eq(workspaceFolderItems.resourceType, "agent"),
          exists(
            this.db
              .select({ value: sql`1` })
              .from(agentModels)
              .where(
                and(
                  eq(agentModels.id, workspaceFolderItems.resourceId),
                  eq(agentModels.orgId, input.orgId),
                  eq(agentModels.workspaceId, input.workspaceId),
                  isNull(agentModels.archivedAt),
                  isNotNull(agentModels.publishedVersionId),
                  input.isAdmin
                    ? undefined
                    : this.grantExists(input, "agent", ["read", "run"]),
                ),
              ),
          ),
        )!,
      );
    }
    if (input.canReadChats) {
      predicates.push(
        and(
          eq(workspaceFolderItems.resourceType, "chat"),
          exists(
            this.db
              .select({ value: sql`1` })
              .from(chats)
              .where(
                and(
                  eq(chats.id, workspaceFolderItems.resourceId),
                  eq(chats.orgId, input.orgId),
                  eq(chats.workspaceId, input.workspaceId),
                  input.isAdmin
                    ? undefined
                    : or(
                        eq(chats.createdBy, input.principalId),
                        this.grantExists(input, "chat", ["read", "write"]),
                      ),
                ),
              ),
          ),
        )!,
      );
    }
    if (input.canReadKnowledgeBases) {
      predicates.push(
        and(
          eq(workspaceFolderItems.resourceType, "knowledge_base"),
          exists(
            this.db
              .select({ value: sql`1` })
              .from(knowledgeBases)
              .where(
                and(
                  eq(knowledgeBases.id, workspaceFolderItems.resourceId),
                  eq(knowledgeBases.orgId, input.orgId),
                  eq(knowledgeBases.workspaceId, input.workspaceId),
                  input.isAdmin
                    ? undefined
                    : this.grantExists(input, "knowledge_base", ["read"]),
                ),
              ),
          ),
        )!,
      );
    }
    return or(...predicates) ?? sql`false`;
  }

  private grantExists(
    input: AuthorizedWorkspaceFolderItemsBatchInput,
    resourceType: "agent" | "chat" | "knowledge_base",
    permissions: Array<"read" | "run" | "write">,
  ): SQL {
    const principal = or(
      and(
        eq(resourceGrants.principalType, input.principalType),
        eq(resourceGrants.principalId, input.principalId),
      ),
      input.groupIds.length === 0
        ? undefined
        : and(
            eq(resourceGrants.principalType, "group"),
            inArray(resourceGrants.principalId, input.groupIds),
          ),
    );
    return exists(
      this.db
        .select({ value: sql`1` })
        .from(resourceGrants)
        .where(
          and(
            eq(resourceGrants.orgId, input.orgId),
            eq(resourceGrants.resourceType, resourceType),
            eq(resourceGrants.resourceId, workspaceFolderItems.resourceId),
            inArray(resourceGrants.permission, permissions),
            principal,
          ),
        ),
    );
  }
}

function normalizeLimit(value: number): number {
  if (!Number.isSafeInteger(value) || value < 1) return 1;
  return Math.min(value, maxItemsPerFolder);
}
