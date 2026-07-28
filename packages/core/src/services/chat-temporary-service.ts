import { assertScope, type AuthSubject } from "@romeo/auth";
import type { ObjectStore } from "@romeo/storage";

import type { Chat } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import { writeAuditLog } from "./audit-log";
import { ensureSystemAuditActor } from "./system-audit-actor";
import { currentTelemetryMetadata } from "./telemetry-context";

export type TemporaryChatPurgeOutcome = "deleted" | "legal_hold" | "missing";

export class ChatTemporaryService {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly objectStore: ObjectStore,
  ) {}

  async cleanup(input: {
    subject: AuthSubject;
    workspaceId?: string;
  }): Promise<{ deletedChatIds: string[]; skippedLegalHoldIds: string[] }> {
    assertScope(input.subject, "admin:write");
    const workspaceIds =
      input.workspaceId === undefined
        ? input.subject.workspaceIds
        : [input.workspaceId];
    const chats = await this.expiredChats(
      input.subject.orgId,
      workspaceIds,
      Date.now(),
    );
    const deletedChatIds: string[] = [];
    const skippedLegalHoldIds: string[] = [];
    for (const chat of chats) {
      const outcome = await this.purge(chat);
      if (outcome === "legal_hold") skippedLegalHoldIds.push(chat.id);
      if (outcome === "deleted") deletedChatIds.push(chat.id);
    }
    await writeAuditLog(this.repository, {
      subject: input.subject,
      action: "chat.temporary.cleanup",
      resourceType: "chat",
      resourceId: input.subject.orgId,
      metadata: {
        deletedCount: deletedChatIds.length,
        skippedLegalHoldCount: skippedLegalHoldIds.length,
        workspaceId: input.workspaceId ?? "all",
      },
    });
    return { deletedChatIds, skippedLegalHoldIds };
  }

  async cleanupForWorker(input: {
    orgId: string;
    batchSize: number;
    now?: string;
  }): Promise<{
    scanned: number;
    deletedChatIds: string[];
    skippedLegalHoldIds: string[];
    deletedObjectCount: number;
  }> {
    const workspaces = await this.repository.listWorkspaces(input.orgId);
    const chats = (
      await this.expiredChats(
        input.orgId,
        workspaces.map((workspace) => workspace.id),
        Date.parse(input.now ?? new Date().toISOString()),
      )
    )
      .sort(
        (left, right) =>
          (left.expiresAt ?? "").localeCompare(right.expiresAt ?? "") ||
          left.id.localeCompare(right.id),
      )
      .slice(0, input.batchSize);
    const deletedChatIds: string[] = [];
    const skippedLegalHoldIds: string[] = [];
    let deletedObjectCount = 0;
    for (const chat of chats) {
      const attachmentCount = await this.attachmentCount(chat.id);
      const outcome = await this.purge(chat);
      if (outcome === "legal_hold") skippedLegalHoldIds.push(chat.id);
      if (outcome === "deleted") {
        deletedChatIds.push(chat.id);
        deletedObjectCount += attachmentCount;
      }
    }
    const actor = await ensureSystemAuditActor(this.repository, {
      kind: "temporary_chat_cleanup_worker",
      name: "Temporary Chat Cleanup Worker",
      orgId: input.orgId,
    });
    await this.repository.createAuditLog({
      id: createId("audit"),
      orgId: input.orgId,
      actorId: actor.id,
      action: "chat.temporary.cleanup.worker",
      resourceType: "organization",
      resourceId: input.orgId,
      outcome: "success",
      metadata: {
        scanned: chats.length,
        deleted: deletedChatIds.length,
        skippedLegalHold: skippedLegalHoldIds.length,
        deletedObjects: deletedObjectCount,
        ...currentTelemetryMetadata(),
      },
      createdAt: new Date().toISOString(),
    });
    return {
      scanned: chats.length,
      deletedChatIds,
      skippedLegalHoldIds,
      deletedObjectCount,
    };
  }

  async purge(chat: Chat): Promise<TemporaryChatPurgeOutcome> {
    const plan = await this.repository.getDataDeletionPlan(
      chat.orgId,
      "chat",
      chat.id,
    );
    if (plan?.legalHold !== undefined) return "legal_hold";
    const messages = await this.repository.listMessages(chat.id);
    const parts = (
      await Promise.all(
        messages.map((message) => this.repository.listMessageParts(message.id)),
      )
    ).flat();
    await Promise.all(
      parts
        .filter((part) => part.type === "attachment")
        .map((part) => this.objectStore.deleteObject(part.content)),
    );
    const deleted = await this.repository.deleteDataForResource(
      chat.orgId,
      "chat",
      chat.id,
    );
    return deleted === undefined ? "missing" : "deleted";
  }

  private async expiredChats(
    orgId: string,
    workspaceIds: string[],
    now: number,
  ): Promise<Chat[]> {
    return (
      await Promise.all(
        workspaceIds.map((workspaceId) =>
          this.repository.listChats(workspaceId),
        ),
      )
    )
      .flat()
      .filter(
        (chat) =>
          chat.orgId === orgId &&
          chat.temporary === true &&
          chat.expiresAt !== undefined &&
          Date.parse(chat.expiresAt) <= now,
      );
  }

  private async attachmentCount(chatId: string): Promise<number> {
    const messages = await this.repository.listMessages(chatId);
    const parts = (
      await Promise.all(
        messages.map((message) => this.repository.listMessageParts(message.id)),
      )
    ).flat();
    return parts.filter((part) => part.type === "attachment").length;
  }
}
