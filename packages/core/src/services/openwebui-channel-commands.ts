import { AuthorizationError, assertScope, type AuthSubject } from "@romeo/auth";
import type {
  OpenWebUiChannelInput,
  OpenWebUiChannelMemberResponse,
  OpenWebUiChannelResponse,
} from "@romeo/contracts";

import type { CollaborationChannel } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { createId } from "../ids";
import type { OpenWebUiChannelAccess } from "./openwebui-channel-access";
import type { OpenWebUiChannelQueries } from "./openwebui-channel-queries";
import {
  channelMemberDraft,
  normalizeChannelName,
  normalizeChannelType,
} from "./openwebui-channel-metadata";
import { toChannelMemberResponse } from "./openwebui-channel-responses";
import { isOpenWebUiAdmin } from "./openwebui-permissions";
import { assertWorkspaceActive } from "./workspace-guard";

export class OpenWebUiChannelCommands {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly access: OpenWebUiChannelAccess,
    private readonly queries: OpenWebUiChannelQueries,
  ) {}

  async create(
    subject: AuthSubject,
    input: OpenWebUiChannelInput,
  ): Promise<OpenWebUiChannelResponse> {
    assertWriteSubject(subject);
    const workspaceId = defaultWorkspaceId(subject);
    await assertWorkspaceActive(this.repository, {
      orgId: subject.orgId,
      workspaceId,
    });
    const type = normalizeChannelType(input.type);
    if (type === undefined && !isOpenWebUiAdmin(subject)) {
      throw new AuthorizationError("Only admins can create standard channels.");
    }
    const name = normalizeChannelName(input.name ?? "", type);
    const now = new Date().toISOString();
    const memberUserIds = await this.access.channelMemberUserIds(
      subject,
      input,
      type,
    );
    if (type === "dm") {
      const existing = await this.access.findDmChannel(subject, memberUserIds);
      if (existing !== undefined) {
        await this.access.reactivateChannelMember(subject, existing.id, now);
        return this.queries.get(subject, existing.id);
      }
    }
    const channel = await this.repository.transaction(async (repository) => {
      const created = await repository.createCollaborationChannel({
        id: createId("channel"),
        orgId: subject.orgId,
        workspaceId,
        userId: subject.id,
        ...(type === undefined ? {} : { type }),
        name,
        ...(input.description === undefined || input.description === null
          ? {}
          : { description: input.description.trim() }),
        ...(input.is_private === undefined || input.is_private === null
          ? {}
          : { isPrivate: input.is_private }),
        ...(input.data === undefined || input.data === null
          ? {}
          : { data: input.data }),
        ...(input.meta === undefined || input.meta === null
          ? {}
          : { meta: input.meta }),
        createdAt: now,
        updatedAt: now,
      });
      await Promise.all(
        memberUserIds.map((userId) =>
          repository.createCollaborationChannelMember(
            channelMemberDraft({
              channelId: created.id,
              orgId: subject.orgId,
              userId,
              invitedBy: subject.id,
              now,
              role: userId === subject.id ? "manager" : undefined,
            }),
          ),
        ),
      );
      return created;
    });
    return this.queries.get(subject, channel.id);
  }

  async dm(
    subject: AuthSubject,
    userId: string,
  ): Promise<OpenWebUiChannelResponse> {
    assertWriteSubject(subject);
    if (userId === subject.id) {
      throw new ApiError(
        "invalid_openwebui_channel_member",
        "A direct-message channel requires another user.",
        400,
      );
    }
    return this.create(subject, { type: "dm", name: "", user_ids: [userId] });
  }

  async updateMemberActiveStatus(
    subject: AuthSubject,
    channelId: string,
    isActive: boolean,
  ): Promise<boolean> {
    assertWriteSubject(subject);
    const channel = await this.access.authorizedChannel(
      subject,
      channelId,
      "read",
    );
    const member = await this.repository.getCollaborationChannelMember(
      channel.id,
      subject.id,
    );
    if (member === undefined) throw notFound("Channel member");
    const now = new Date().toISOString();
    await this.repository.updateCollaborationChannelMember({
      ...member,
      isActive,
      status: isActive ? "joined" : "left",
      updatedAt: now,
      ...(isActive ? {} : { leftAt: now }),
    });
    return true;
  }

  async addMembers(
    subject: AuthSubject,
    channelId: string,
    input: {
      user_ids?: string[] | undefined;
      group_ids?: string[] | undefined;
    },
  ): Promise<OpenWebUiChannelMemberResponse[]> {
    assertWriteSubject(subject);
    const channel = await this.access.authorizedChannel(
      subject,
      channelId,
      "write",
    );
    const now = new Date().toISOString();
    const userIds = await this.access.channelMemberUserIds(
      subject,
      {
        name: channel.name,
        user_ids: input.user_ids,
        group_ids: input.group_ids,
      },
      normalizeChannelType(channel.type),
    );
    const created = await this.repository.transaction(async (repository) =>
      Promise.all(
        userIds.map((userId) =>
          repository.createCollaborationChannelMember(
            channelMemberDraft({
              channelId: channel.id,
              orgId: subject.orgId,
              userId,
              invitedBy: subject.id,
              now,
              role: userId === subject.id ? "manager" : undefined,
            }),
          ),
        ),
      ),
    );
    return created.map(toChannelMemberResponse);
  }

  async removeMembers(
    subject: AuthSubject,
    channelId: string,
    input: { user_ids?: string[] | undefined },
  ): Promise<number> {
    assertWriteSubject(subject);
    const channel = await this.access.authorizedChannel(
      subject,
      channelId,
      "write",
    );
    const userIds = [...new Set(input.user_ids ?? [])].filter(
      (userId) => userId !== subject.id,
    );
    const deleted = await this.repository.deleteCollaborationChannelMembers(
      channel.id,
      userIds,
    );
    return deleted.length;
  }

  async update(
    subject: AuthSubject,
    channelId: string,
    input: OpenWebUiChannelInput,
  ): Promise<OpenWebUiChannelResponse> {
    assertWriteSubject(subject);
    const channel = await this.access.authorizedChannel(
      subject,
      channelId,
      "write",
    );
    const type = normalizeChannelType(channel.type);
    const name =
      input.name === undefined
        ? channel.name
        : normalizeChannelName(input.name, type);
    const next: CollaborationChannel = {
      ...channel,
      name,
      updatedAt: new Date().toISOString(),
      updatedBy: subject.id,
    };
    if (input.description !== undefined) {
      if (input.description === null) delete next.description;
      else next.description = input.description.trim();
    }
    if (input.is_private !== undefined) {
      if (input.is_private === null) delete next.isPrivate;
      else next.isPrivate = input.is_private;
    }
    if (input.data !== undefined) {
      if (input.data === null) delete next.data;
      else next.data = input.data;
    }
    if (input.meta !== undefined) {
      if (input.meta === null) delete next.meta;
      else next.meta = input.meta;
    }
    await this.repository.updateCollaborationChannel(next);
    if (
      (input.user_ids?.length ?? 0) > 0 ||
      (input.group_ids?.length ?? 0) > 0
    ) {
      await this.addMembers(subject, channel.id, {
        user_ids: input.user_ids,
        group_ids: input.group_ids,
      });
    }
    return this.queries.get(subject, channel.id);
  }

  async delete(subject: AuthSubject, channelId: string): Promise<boolean> {
    assertWriteSubject(subject);
    const channel = await this.access.authorizedChannel(
      subject,
      channelId,
      "write",
    );
    await this.repository.deleteCollaborationChannel(channel.id);
    return true;
  }
}

function assertWriteSubject(subject: AuthSubject): void {
  assertScope(subject, "chats:write");
  if (subject.type !== "user") {
    throw new AuthorizationError(
      "OpenWebUI chat compatibility is available only for user subjects.",
    );
  }
}

function defaultWorkspaceId(subject: AuthSubject): string {
  const workspaceId = subject.workspaceIds[0];
  if (workspaceId === undefined) {
    throw new AuthorizationError("No workspace is available to the caller.");
  }
  return workspaceId;
}
