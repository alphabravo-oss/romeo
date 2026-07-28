import {
  AuthorizationError,
  assertScope,
  canAccessOrg,
  hasGrant,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";

import type { Agent, ResourceFavorite } from "../domain/entities";
import type { FavoritableResourceType } from "../domain/collaboration";
import { notFound } from "../errors";
import { createId } from "../ids";
import { getAuthorizedAgent } from "./agent-access";
import { getAuthorizedChat } from "./chat-access";
import { CollaborationShareService } from "./collaboration-share-service";
import { getAuthorizedKnowledgeBase } from "./knowledge-access";

export interface AgentGalleryItem extends Agent {
  favorite: boolean;
}

export class CollaborationFavoriteService extends CollaborationShareService {
  async agentGallery(
    subject: AuthSubject,
    workspaceId?: string,
  ): Promise<AgentGalleryItem[]> {
    assertScope(subject, "agents:read");
    const targetWorkspaceId = workspaceId ?? subject.workspaceIds[0];
    if (targetWorkspaceId === undefined) return [];
    if (!hasWorkspaceAccess(subject, targetWorkspaceId))
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );

    const [agents, grants, favorites] = await Promise.all([
      this.repository.listAgents(targetWorkspaceId),
      this.repository.listResourceGrants(subject.orgId),
      this.repository.listResourceFavorites(subject.orgId, subject.id),
    ]);
    const favoriteIds = new Set(
      favorites
        .filter((favorite) => favorite.resourceType === "agent")
        .map((favorite) => favorite.resourceId),
    );
    return agents
      .filter((agent) => agent.publishedVersionId !== undefined)
      .filter((agent) => canAccessOrg(subject, agent.orgId))
      .filter(
        (agent) =>
          hasGrant(subject, grants, "agent", agent.id, "run") ||
          hasGrant(subject, grants, "agent", agent.id, "read"),
      )
      .map((agent) => ({ ...agent, favorite: favoriteIds.has(agent.id) }));
  }

  async favorites(subject: AuthSubject): Promise<ResourceFavorite[]> {
    assertScope(subject, "me:read");
    return this.repository.listResourceFavorites(subject.orgId, subject.id);
  }

  async favorite(input: {
    subject: AuthSubject;
    resourceType: FavoritableResourceType;
    resourceId: string;
  }): Promise<ResourceFavorite> {
    assertScope(input.subject, "me:read");
    await this.assertCanFavorite(
      input.subject,
      input.resourceType,
      input.resourceId,
    );
    const existing = (
      await this.repository.listResourceFavorites(
        input.subject.orgId,
        input.subject.id,
      )
    ).find(
      (favorite) =>
        favorite.resourceType === input.resourceType &&
        favorite.resourceId === input.resourceId,
    );
    if (existing) return existing;

    return this.repository.transaction(async (repository) => {
      const favorite = await repository.createResourceFavorite({
        id: createId("favorite"),
        orgId: input.subject.orgId,
        userId: input.subject.id,
        resourceType: input.resourceType,
        resourceId: input.resourceId,
        createdAt: new Date().toISOString(),
      });
      await this.audit(
        input.subject,
        "resource.favorite",
        favorite.resourceType,
        favorite.resourceId,
        {},
        repository,
      );
      return favorite;
    });
  }

  async deleteFavorite(
    subject: AuthSubject,
    favoriteId: string,
  ): Promise<ResourceFavorite> {
    assertScope(subject, "me:read");
    const favorite = (
      await this.repository.listResourceFavorites(subject.orgId, subject.id)
    ).find((item) => item.id === favoriteId);
    if (!favorite) throw notFound("Favorite");
    const deleted = await this.repository.deleteResourceFavorite(favoriteId);
    if (!deleted) throw notFound("Favorite");
    return deleted;
  }

  protected async assertCanFavorite(
    subject: AuthSubject,
    resourceType: FavoritableResourceType,
    resourceId: string,
  ): Promise<void> {
    const grants = await this.repository.listResourceGrants(subject.orgId);
    if (resourceType === "agent") {
      const agent = await getAuthorizedAgent(this.repository, {
        agentId: resourceId,
        subject,
        scope: "agents:read",
      });
      if (
        !hasGrant(subject, grants, "agent", agent.id, "run") &&
        !hasGrant(subject, grants, "agent", agent.id, "read")
      ) {
        throw new AuthorizationError("Missing access to favorite this agent.");
      }
      return;
    }
    if (resourceType === "chat") {
      await getAuthorizedChat(this.repository, {
        chatId: resourceId,
        subject,
        scope: "chats:read",
        permission: "read",
      });
      return;
    }

    if (resourceType === "model") {
      const model = await this.repository.getModel(resourceId);
      if (model === undefined || !model.enabled) throw notFound("Model");
      const provider = await this.repository.getProvider(model.providerId);
      if (
        provider === undefined ||
        provider.orgId !== subject.orgId ||
        !provider.enabled
      )
        throw notFound("Model");
      return;
    }

    await getAuthorizedKnowledgeBase(this.repository, {
      knowledgeBaseId: resourceId,
      subject,
      scope: "knowledge:read",
      permission: "read",
    });
  }
}
