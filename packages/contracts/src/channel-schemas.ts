import { z } from "@hono/zod-openapi";

const id = z.string().trim().min(1).max(200);
const timestamp = z.string().datetime();
const channelType = z.enum(["dm", "group", "standard"]);
const userIds = z.array(z.string().trim().min(1).max(120)).max(500).optional();
const groupIds = z.array(z.string().trim().min(1).max(120)).max(100).optional();

export const ChannelUserSchema = z
  .strictObject({
    id,
    email: z.string().email(),
    name: z.string(),
    disabled: z.boolean(),
  })
  .openapi("ChannelUser");
export const ChannelSchema = z
  .strictObject({
    id,
    type: channelType,
    name: z.string(),
    ownerUserId: id,
    private: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
    unreadCount: z.number().int().nonnegative(),
    archivedAt: timestamp.optional(),
    canWrite: z.boolean().optional(),
    deletedAt: timestamp.optional(),
    description: z.string().optional(),
    isManager: z.boolean().optional(),
    lastMessageAt: timestamp.optional(),
    lastReadAt: timestamp.optional(),
    memberCount: z.number().int().nonnegative().optional(),
    memberUserIds: z.array(id).optional(),
    members: z.array(ChannelUserSchema).optional(),
  })
  .openapi("Channel");
export const ChannelMemberSchema = z
  .strictObject({
    id,
    channelId: id,
    userId: id,
    active: z.boolean(),
    muted: z.boolean(),
    pinned: z.boolean(),
    createdAt: timestamp,
    updatedAt: timestamp,
    invitedAt: timestamp.optional(),
    invitedBy: id.optional(),
    joinedAt: timestamp.optional(),
    lastReadAt: timestamp.optional(),
    leftAt: timestamp.optional(),
    role: z.string().optional(),
    status: z.string().optional(),
    user: ChannelUserSchema.optional(),
  })
  .openapi("ChannelMember");
export const ChannelMessageReactionSchema = z
  .strictObject({ name: z.string(), userId: id })
  .openapi("ChannelMessageReaction");
export const ChannelMessageSchema = z
  .strictObject({
    id,
    channelId: id,
    authorUserId: id,
    content: z.string(),
    createdAt: timestamp,
    updatedAt: timestamp,
    pinned: z.boolean(),
    reactions: z.array(ChannelMessageReactionSchema),
    replyCount: z.number().int().nonnegative(),
    author: ChannelUserSchema.optional(),
    latestReplyAt: timestamp.optional(),
    parentMessageId: id.optional(),
    pinnedAt: timestamp.optional(),
    pinnedBy: id.optional(),
    get replyToMessage() {
      return ChannelMessageSchema.optional();
    },
    replyToMessageId: id.optional(),
  })
  .openapi("ChannelMessage");
export const ChannelEventSchema = z
  .strictObject({
    id,
    channelId: id,
    createdAt: timestamp,
    type: z.enum([
      "channel:connected",
      "message",
      "message:reply",
      "message:update",
      "message:delete",
      "message:reaction:add",
      "message:reaction:remove",
      "last_read_at",
    ]),
    actor: ChannelUserSchema.optional(),
    channel: ChannelSchema.optional(),
    data: z.unknown().optional(),
    messageId: id.optional(),
  })
  .openapi("ChannelEvent");

export const CreateChannelRequestSchema = z
  .strictObject({
    description: z.string().trim().max(1_000).nullable().optional(),
    groupIds,
    name: z.string().max(128),
    private: z.boolean().optional(),
    type: channelType.optional(),
    userIds,
    workspaceId: z.string().trim().min(1).max(120).optional(),
  })
  .openapi("CreateChannelRequest");
export const UpdateChannelRequestSchema = z
  .strictObject({
    description: z.string().trim().max(1_000).nullable().optional(),
    groupIds,
    name: z.string().trim().min(1).max(128).optional(),
    private: z.boolean().optional(),
    userIds,
  })
  .refine(
    (value) => Object.values(value).some((field) => field !== undefined),
    {
      message: "At least one channel field is required.",
    },
  )
  .openapi("UpdateChannelRequest");
export const CreateDirectMessageChannelRequestSchema = z
  .strictObject({ userId: z.string().trim().min(1).max(120) })
  .openapi("CreateDirectMessageChannelRequest");
export const AddChannelMembersRequestSchema = z
  .strictObject({ groupIds, userIds })
  .refine(
    (value) => value.groupIds !== undefined || value.userIds !== undefined,
    { message: "At least one user or group is required." },
  )
  .openapi("AddChannelMembersRequest");
export const CreateChannelMessageRequestSchema = z
  .strictObject({
    clientMessageId: z.string().trim().min(1).max(200).optional(),
    content: z.string().trim().min(1).max(50_000),
    parentMessageId: id.optional(),
    replyToMessageId: id.optional(),
  })
  .openapi("CreateChannelMessageRequest");
export const PinChannelMessageRequestSchema = z
  .strictObject({ pinned: z.boolean() })
  .openapi("PinChannelMessageRequest");
export const ChannelMessageReactionRequestSchema = z
  .strictObject({ name: z.string().trim().min(1).max(80) })
  .openapi("ChannelMessageReactionRequest");
export const ChannelMemberRemovalResultSchema = z
  .strictObject({ channelId: id, userId: id, removed: z.boolean() })
  .openapi("ChannelMemberRemovalResult");
export const ChannelMessageDeletionResultSchema = z
  .strictObject({ channelId: id, messageId: id, deleted: z.boolean() })
  .openapi("ChannelMessageDeletionResult");

export const channelIdParams = z.strictObject({ channelId: id });
export const channelMemberParams = z.strictObject({
  channelId: id,
  userId: id,
});
export const channelMessageParams = z.strictObject({
  channelId: id,
  messageId: id,
});
export const channelReactionParams = z.strictObject({
  channelId: id,
  messageId: id,
  name: z.string().trim().min(1).max(80),
});
export const channelPaginationQuery = z.strictObject({
  offset: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
});
