import type * as Auth from "@romeo/auth";
import type * as Ai from "@romeo/ai-runtime";

import type * as OAuth from "../domain/delegated-oauth";
import type * as E from "../domain/entities";
import type * as R from "../domain/repository";
import {
  append,
  appendMany,
  removeById,
  replaceById,
} from "./collection-helpers";
import { InMemoryConversationRepository } from "./in-memory-conversation";

export abstract class InMemoryContentRepository extends InMemoryConversationRepository {
  async listUserNotifications(
    orgId: string,
    userId: string,
  ): Promise<E.UserNotification[]> {
    return this.data.userNotifications
      .filter(
        (notification) =>
          notification.orgId === orgId && notification.userId === userId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createUserNotification(
    notification: E.UserNotification,
  ): Promise<E.UserNotification> {
    return append(this.data.userNotifications, notification);
  }

  async updateUserNotification(
    notification: E.UserNotification,
  ): Promise<E.UserNotification> {
    return replaceById(this.data.userNotifications, notification);
  }

  async listNotificationDeliveryChannels(
    orgId: string,
    userId: string,
  ): Promise<E.NotificationDeliveryChannel[]> {
    return this.data.notificationDeliveryChannels
      .filter((channel) => channel.orgId === orgId && channel.userId === userId)
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createNotificationDeliveryChannel(
    channel: E.NotificationDeliveryChannel,
  ): Promise<E.NotificationDeliveryChannel> {
    return append(this.data.notificationDeliveryChannels, channel);
  }

  async listNotificationDeliveries(
    orgId: string,
    userId: string,
  ): Promise<E.NotificationDelivery[]> {
    return this.data.notificationDeliveries
      .filter(
        (delivery) => delivery.orgId === orgId && delivery.userId === userId,
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async createNotificationDelivery(
    delivery: E.NotificationDelivery,
  ): Promise<E.NotificationDelivery> {
    return append(this.data.notificationDeliveries, delivery);
  }

  async updateNotificationDelivery(
    delivery: E.NotificationDelivery,
  ): Promise<E.NotificationDelivery> {
    return replaceById(this.data.notificationDeliveries, delivery);
  }

  async listKnowledgeBases(workspaceId: string): Promise<E.KnowledgeBase[]> {
    return this.data.knowledgeBases.filter(
      (knowledgeBase) => knowledgeBase.workspaceId === workspaceId,
    );
  }

  async createKnowledgeBase(
    knowledgeBase: E.KnowledgeBase,
  ): Promise<E.KnowledgeBase> {
    return append(this.data.knowledgeBases, knowledgeBase);
  }

  async updateKnowledgeBase(
    knowledgeBase: E.KnowledgeBase,
  ): Promise<E.KnowledgeBase> {
    return replaceById(this.data.knowledgeBases, knowledgeBase);
  }

  async getKnowledgeBase(
    knowledgeBaseId: string,
  ): Promise<E.KnowledgeBase | undefined> {
    return this.data.knowledgeBases.find(
      (knowledgeBase) => knowledgeBase.id === knowledgeBaseId,
    );
  }

  async listKnowledgeSources(
    knowledgeBaseId: string,
  ): Promise<E.KnowledgeSource[]> {
    return this.data.knowledgeSources.filter(
      (source) => source.knowledgeBaseId === knowledgeBaseId,
    );
  }

  async createKnowledgeSource(
    source: E.KnowledgeSource,
  ): Promise<E.KnowledgeSource> {
    return append(this.data.knowledgeSources, source);
  }

  async updateKnowledgeSource(
    source: E.KnowledgeSource,
  ): Promise<E.KnowledgeSource> {
    return replaceById(this.data.knowledgeSources, source);
  }

  async deleteKnowledgeSource(
    sourceId: string,
  ): Promise<E.KnowledgeSource | undefined> {
    return removeById(this.data.knowledgeSources, sourceId);
  }

  async listKnowledgeChunks(
    knowledgeBaseId: string,
  ): Promise<E.KnowledgeChunk[]> {
    return this.data.knowledgeChunks
      .filter((chunk) => chunk.knowledgeBaseId === knowledgeBaseId)
      .sort((left, right) => left.sequence - right.sequence);
  }

  async createKnowledgeChunks(
    chunks: E.KnowledgeChunk[],
  ): Promise<E.KnowledgeChunk[]> {
    return appendMany(this.data.knowledgeChunks, chunks);
  }

  async deleteKnowledgeChunksForSource(sourceId: string): Promise<void> {
    this.data.knowledgeChunks = this.data.knowledgeChunks.filter(
      (chunk) => chunk.sourceId !== sourceId,
    );
    this.data.knowledgeChunkEmbeddings =
      this.data.knowledgeChunkEmbeddings.filter(
        (embedding) => embedding.sourceId !== sourceId,
      );
  }

  async listKnowledgeChunkEmbeddings(
    knowledgeBaseId: string,
  ): Promise<E.KnowledgeChunkEmbedding[]> {
    return this.data.knowledgeChunkEmbeddings
      .filter((embedding) => embedding.knowledgeBaseId === knowledgeBaseId)
      .sort((left, right) => left.chunkId.localeCompare(right.chunkId));
  }

  async searchKnowledgeChunkEmbeddings(input: {
    orgId: string;
    workspaceId: string;
    knowledgeBaseId: string;
    embeddingProvider: string;
    embeddingModel: string;
    dimensions: number;
    queryEmbedding: number[];
    maxResults: number;
  }): Promise<E.KnowledgeChunkEmbeddingSearchHit[]> {
    return this.data.knowledgeChunkEmbeddings
      .filter(
        (embedding) =>
          embedding.orgId === input.orgId &&
          embedding.workspaceId === input.workspaceId &&
          embedding.knowledgeBaseId === input.knowledgeBaseId &&
          embedding.embeddingProvider === input.embeddingProvider &&
          embedding.embeddingModel === input.embeddingModel &&
          embedding.dimensions === input.dimensions,
      )
      .map((embedding) => ({
        embedding,
        score: cosineSimilarity(embedding.embedding, input.queryEmbedding),
      }))
      .filter((hit) => hit.score > 0)
      .sort(
        (left, right) =>
          right.score - left.score ||
          left.embedding.chunkId.localeCompare(right.embedding.chunkId),
      )
      .slice(0, input.maxResults);
  }

  async upsertKnowledgeChunkEmbeddings(
    embeddings: E.KnowledgeChunkEmbedding[],
  ): Promise<E.KnowledgeChunkEmbedding[]> {
    for (const embedding of embeddings) {
      const index = this.data.knowledgeChunkEmbeddings.findIndex(
        (item) =>
          item.chunkId === embedding.chunkId &&
          item.embeddingProvider === embedding.embeddingProvider &&
          item.embeddingModel === embedding.embeddingModel,
      );
      if (index >= 0) this.data.knowledgeChunkEmbeddings[index] = embedding;
      else this.data.knowledgeChunkEmbeddings.push(embedding);
    }
    return embeddings;
  }

  async deleteKnowledgeChunkEmbeddingsForSource(
    sourceId: string,
  ): Promise<void> {
    this.data.knowledgeChunkEmbeddings =
      this.data.knowledgeChunkEmbeddings.filter(
        (embedding) => embedding.sourceId !== sourceId,
      );
  }

  async listDataConnectors(
    orgId: string,
    workspaceId?: string,
  ): Promise<E.DataConnector[]> {
    return this.data.dataConnectors
      .filter(
        (connector) =>
          connector.orgId === orgId &&
          (workspaceId === undefined || connector.workspaceId === workspaceId),
      )
      .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  async getDataConnector(
    connectorId: string,
  ): Promise<E.DataConnector | undefined> {
    return this.data.dataConnectors.find(
      (connector) => connector.id === connectorId,
    );
  }

  async createDataConnector(
    connector: E.DataConnector,
  ): Promise<E.DataConnector> {
    return append(this.data.dataConnectors, connector);
  }

  async updateDataConnector(
    connector: E.DataConnector,
  ): Promise<E.DataConnector> {
    return replaceById(this.data.dataConnectors, connector);
  }

  async listDataConnectorSyncs(
    orgId: string,
    connectorId?: string,
  ): Promise<E.DataConnectorSync[]> {
    return this.data.dataConnectorSyncs
      .filter(
        (sync) =>
          sync.orgId === orgId &&
          (connectorId === undefined || sync.connectorId === connectorId),
      )
      .sort((left, right) => right.startedAt.localeCompare(left.startedAt));
  }

  async createDataConnectorSync(
    sync: E.DataConnectorSync,
  ): Promise<E.DataConnectorSync> {
    return append(this.data.dataConnectorSyncs, sync);
  }

  async updateDataConnectorSync(
    sync: E.DataConnectorSync,
  ): Promise<E.DataConnectorSync> {
    return replaceById(this.data.dataConnectorSyncs, sync);
  }

  async listDelegatedOAuthConnections(
    orgId: string,
    workspaceId?: string,
    userId?: string,
  ): Promise<OAuth.DelegatedOAuthConnection[]> {
    return this.data.delegatedOAuthConnections
      .filter(
        (connection) =>
          connection.orgId === orgId &&
          (workspaceId === undefined ||
            connection.workspaceId === workspaceId) &&
          (userId === undefined || connection.userId === userId),
      )
      .sort(
        (left, right) =>
          right.updatedAt.localeCompare(left.updatedAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async getDelegatedOAuthConnection(
    connectionId: string,
  ): Promise<OAuth.DelegatedOAuthConnection | undefined> {
    return this.data.delegatedOAuthConnections.find(
      (connection) => connection.id === connectionId,
    );
  }

  async getDelegatedOAuthConnectionByProviderAccount(input: {
    connectorType: OAuth.DelegatedOAuthConnection["connectorType"];
    orgId: string;
    providerAccountId: string;
    providerId: OAuth.DelegatedOAuthConnection["providerId"];
    userId: string;
    workspaceId: string;
  }): Promise<OAuth.DelegatedOAuthConnection | undefined> {
    return this.data.delegatedOAuthConnections.find(
      (connection) =>
        connection.orgId === input.orgId &&
        connection.workspaceId === input.workspaceId &&
        connection.userId === input.userId &&
        connection.providerId === input.providerId &&
        connection.connectorType === input.connectorType &&
        connection.providerAccountId === input.providerAccountId,
    );
  }

  async createDelegatedOAuthConnection(
    connection: OAuth.DelegatedOAuthConnection,
  ): Promise<OAuth.DelegatedOAuthConnection> {
    return append(this.data.delegatedOAuthConnections, connection);
  }

  async updateDelegatedOAuthConnection(
    connection: OAuth.DelegatedOAuthConnection,
  ): Promise<OAuth.DelegatedOAuthConnection> {
    return replaceById(this.data.delegatedOAuthConnections, connection);
  }

  async withDelegatedOAuthConnectionRefreshLock<T>(
    connectionId: string,
    work: (repository: R.RomeoRepository) => Promise<T>,
  ): Promise<T> {
    const previous =
      this.delegatedOAuthRefreshLocks.get(connectionId) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((resolve) => {
      release = resolve;
    });
    const next = previous.catch(() => undefined).then(() => current);
    this.delegatedOAuthRefreshLocks.set(connectionId, next);
    await previous.catch(() => undefined);
    try {
      return await work(this as unknown as R.RomeoRepository);
    } finally {
      release();
      if (this.delegatedOAuthRefreshLocks.get(connectionId) === next) {
        this.delegatedOAuthRefreshLocks.delete(connectionId);
      }
    }
  }

  async listVoiceProfiles(orgId: string): Promise<E.VoiceProfile[]> {
    return this.data.voiceProfiles
      .filter((voice) => voice.orgId === orgId)
      .sort(
        (left, right) =>
          right.createdAt.localeCompare(left.createdAt) ||
          left.id.localeCompare(right.id),
      );
  }

  async getVoiceProfile(
    voiceProfileId: string,
  ): Promise<E.VoiceProfile | undefined> {
    return this.data.voiceProfiles.find((voice) => voice.id === voiceProfileId);
  }

  async createVoiceProfile(
    voiceProfile: E.VoiceProfile,
  ): Promise<E.VoiceProfile> {
    const index = this.data.voiceProfiles.findIndex(
      (item) =>
        item.orgId === voiceProfile.orgId &&
        item.providerId === voiceProfile.providerId &&
        item.providerVoiceId === voiceProfile.providerVoiceId,
    );
    if (index >= 0) {
      const existing = this.data.voiceProfiles[index]!;
      const updated = {
        ...voiceProfile,
        id: existing.id,
        createdAt: existing.createdAt,
      };
      this.data.voiceProfiles[index] = updated;
      return updated;
    }
    return append(this.data.voiceProfiles, voiceProfile);
  }
}

function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length !== right.length || left.length === 0) return 0;
  let dot = 0;
  let leftMagnitude = 0;
  let rightMagnitude = 0;
  for (let index = 0; index < left.length; index += 1) {
    const leftValue = left[index] ?? 0;
    const rightValue = right[index] ?? 0;
    dot += leftValue * rightValue;
    leftMagnitude += leftValue * leftValue;
    rightMagnitude += rightValue * rightValue;
  }
  if (leftMagnitude === 0 || rightMagnitude === 0) return 0;
  return dot / (Math.sqrt(leftMagnitude) * Math.sqrt(rightMagnitude));
}
