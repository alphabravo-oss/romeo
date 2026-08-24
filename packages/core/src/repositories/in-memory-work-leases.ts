import type * as E from "../domain/entities";
import type {
  ClaimWorkLeaseInput,
  FinishWorkLeaseInput,
  RenewWorkLeaseInput,
} from "../domain/work-leases";
import { InMemoryContentRepository } from "./in-memory-content";

export abstract class InMemoryWorkLeaseRepository extends InMemoryContentRepository {
  async listFileRetentionCandidates(input: {
    after?: { id: string; updatedAt: string };
    limit: number;
    orgId: string;
  }): Promise<E.FileObject[]> {
    return this.data.fileObjects
      .filter((file) => file.orgId === input.orgId && file.status !== "deleted")
      .filter((file) =>
        input.after === undefined
          ? true
          : file.updatedAt > input.after.updatedAt ||
            (file.updatedAt === input.after.updatedAt &&
              file.id > input.after.id),
      )
      .sort(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, Math.max(1, Math.min(input.limit, 1_000)));
  }

  async claimDataConnectorSync(
    input: ClaimWorkLeaseInput & { connectorId?: string; orgId: string },
  ): Promise<E.DataConnector | undefined> {
    const connector = this.data.dataConnectors
      .filter(
        (item) =>
          item.orgId === input.orgId &&
          item.status === "active" &&
          (input.connectorId === undefined
            ? item.type !== "local_import" &&
              item.nextSyncAt !== undefined &&
              item.nextSyncAt <= input.now
            : item.id === input.connectorId) &&
          (item.syncLease === undefined ||
            item.syncLease.expiresAt <= input.now),
      )
      .sort(
        (left, right) =>
          (left.nextSyncAt ?? "").localeCompare(right.nextSyncAt ?? "") ||
          left.updatedAt.localeCompare(right.updatedAt) ||
          left.id.localeCompare(right.id),
      )[0];
    if (connector === undefined) return undefined;
    const syncLease = nextLease(connector.syncLease, input);
    Object.assign(connector, { syncLease, updatedAt: input.now });
    return structuredClone(connector);
  }

  async renewDataConnectorSyncLease(
    input: RenewWorkLeaseInput & { connectorId: string },
  ): Promise<E.DataConnector | undefined> {
    const connector = this.data.dataConnectors.find(
      (item) => item.id === input.connectorId,
    );
    if (!leaseMatches(connector?.syncLease, input)) return undefined;
    connector!.syncLease = {
      ...connector!.syncLease!,
      expiresAt: input.leaseExpiresAt,
    };
    connector!.updatedAt = input.now;
    return structuredClone(connector);
  }

  async finishDataConnectorSync(
    input: FinishWorkLeaseInput & {
      connector: E.DataConnector;
      sync: E.DataConnectorSync;
    },
  ): Promise<E.DataConnectorSync | undefined> {
    const connectorIndex = this.data.dataConnectors.findIndex(
      (item) => item.id === input.connector.id,
    );
    const current = this.data.dataConnectors[connectorIndex];
    if (!leaseMatches(current?.syncLease, input)) return undefined;
    const syncIndex = this.data.dataConnectorSyncs.findIndex(
      (item) =>
        item.id === input.sync.id &&
        item.connectorId === input.connector.id &&
        item.fencingToken === input.fencingToken &&
        item.leaseToken === input.leaseToken,
    );
    if (syncIndex < 0) return undefined;
    const connector = { ...input.connector };
    delete connector.syncLease;
    this.data.dataConnectors[connectorIndex] = connector;
    this.data.dataConnectorSyncs[syncIndex] = input.sync;
    return structuredClone(input.sync);
  }

  async claimKnowledgeSourceExtraction(
    input: ClaimWorkLeaseInput & {
      knowledgeBaseId: string;
      sourceId?: string;
    },
  ): Promise<E.KnowledgeSource | undefined> {
    const source = this.data.knowledgeSources
      .filter(
        (item) =>
          item.knowledgeBaseId === input.knowledgeBaseId &&
          (input.sourceId === undefined || item.id === input.sourceId) &&
          item.objectKey !== undefined &&
          (item.status === "pending" ||
            item.status === "failed" ||
            item.status === "extracting") &&
          (item.extractionLease === undefined ||
            item.extractionLease.expiresAt <= input.now),
      )
      .sort(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) ||
          left.id.localeCompare(right.id),
      )[0];
    if (source === undefined) return undefined;
    source.status = "extracting";
    source.extractionLease = nextLease(source.extractionLease, input);
    source.updatedAt = input.now;
    return structuredClone(source);
  }

  async renewKnowledgeSourceExtractionLease(
    input: RenewWorkLeaseInput & { sourceId: string },
  ): Promise<E.KnowledgeSource | undefined> {
    const source = this.data.knowledgeSources.find(
      (item) => item.id === input.sourceId,
    );
    if (!leaseMatches(source?.extractionLease, input)) return undefined;
    source!.extractionLease = {
      ...source!.extractionLease!,
      expiresAt: input.leaseExpiresAt,
    };
    source!.updatedAt = input.now;
    return structuredClone(source);
  }

  async finishKnowledgeSourceExtraction(
    input: FinishWorkLeaseInput & {
      chunks: E.KnowledgeChunk[];
      source: E.KnowledgeSource;
    },
  ): Promise<E.KnowledgeSource | undefined> {
    const sourceIndex = this.data.knowledgeSources.findIndex(
      (item) => item.id === input.source.id,
    );
    const current = this.data.knowledgeSources[sourceIndex];
    if (!leaseMatches(current?.extractionLease, input)) return undefined;
    this.data.knowledgeChunks = this.data.knowledgeChunks.filter(
      (chunk) => chunk.sourceId !== input.source.id,
    );
    this.data.knowledgeChunkEmbeddings =
      this.data.knowledgeChunkEmbeddings.filter(
        (embedding) => embedding.sourceId !== input.source.id,
      );
    this.data.knowledgeChunks.push(...input.chunks);
    const source = { ...input.source };
    delete source.extractionLease;
    this.data.knowledgeSources[sourceIndex] = source;
    return structuredClone(source);
  }

  async claimDueNotificationDeliveries(
    input: ClaimWorkLeaseInput & { limit: number; orgId: string },
  ): Promise<E.NotificationDelivery[]> {
    const candidates = this.data.notificationDeliveries
      .filter(
        (delivery) =>
          delivery.orgId === input.orgId &&
          delivery.status === "failed" &&
          delivery.attemptCount < 5 &&
          delivery.metadata.deadLetter === undefined &&
          (typeof delivery.metadata.nextAttemptAt !== "string" ||
            delivery.metadata.nextAttemptAt <= input.now) &&
          (delivery.deliveryLease === undefined ||
            delivery.deliveryLease.expiresAt <= input.now),
      )
      .sort(
        (left, right) =>
          left.updatedAt.localeCompare(right.updatedAt) ||
          left.id.localeCompare(right.id),
      )
      .slice(0, Math.max(1, Math.min(input.limit, 1_000)));
    for (const delivery of candidates) {
      delivery.deliveryLease = nextLease(delivery.deliveryLease, input);
      delivery.providerIdempotencyKey ??= delivery.id;
      delivery.updatedAt = input.now;
    }
    return structuredClone(candidates);
  }

  async finishNotificationDeliveryLease(
    input: FinishWorkLeaseInput & { delivery: E.NotificationDelivery },
  ): Promise<E.NotificationDelivery | undefined> {
    const index = this.data.notificationDeliveries.findIndex(
      (delivery) => delivery.id === input.delivery.id,
    );
    const current = this.data.notificationDeliveries[index];
    if (!leaseMatches(current?.deliveryLease, input)) return undefined;
    const delivery = {
      ...input.delivery,
      providerIdempotencyKey:
        input.delivery.providerIdempotencyKey ?? input.delivery.id,
    };
    delete delivery.deliveryLease;
    this.data.notificationDeliveries[index] = delivery;
    return structuredClone(delivery);
  }
}

function nextLease(
  previous: E.WorkLease | undefined,
  input: ClaimWorkLeaseInput,
): E.WorkLease {
  return {
    attempt: (previous?.attempt ?? 0) + 1,
    expiresAt: input.leaseExpiresAt,
    fencingToken: (previous?.fencingToken ?? 0) + 1,
    owner: input.leaseOwner,
    token: input.leaseToken,
  };
}

function leaseMatches(
  lease: E.WorkLease | undefined,
  input: FinishWorkLeaseInput,
): boolean {
  return (
    lease !== undefined &&
    lease.owner === input.leaseOwner &&
    lease.token === input.leaseToken &&
    lease.fencingToken === input.fencingToken &&
    lease.expiresAt > input.now
  );
}
