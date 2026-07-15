export type ChannelType = "dm" | "group" | "standard";
export type ChannelEventType =
  | "channel:connected"
  | "message"
  | "message:reply"
  | "message:update"
  | "message:delete"
  | "message:reaction:add"
  | "message:reaction:remove"
  | "last_read_at";

export interface ChannelUser {
  id: string;
  email: string;
  name: string;
  disabled: boolean;
}

export interface Channel {
  id: string;
  type: ChannelType;
  name: string;
  ownerUserId: string;
  private: boolean;
  createdAt: string;
  updatedAt: string;
  unreadCount: number;
  archivedAt?: string;
  canWrite?: boolean;
  deletedAt?: string;
  description?: string;
  isManager?: boolean;
  lastMessageAt?: string;
  lastReadAt?: string;
  memberCount?: number;
  memberUserIds?: string[];
  members?: ChannelUser[];
}

export interface ChannelMember {
  id: string;
  channelId: string;
  userId: string;
  active: boolean;
  muted: boolean;
  pinned: boolean;
  createdAt: string;
  updatedAt: string;
  invitedAt?: string;
  invitedBy?: string;
  joinedAt?: string;
  lastReadAt?: string;
  leftAt?: string;
  role?: string;
  status?: string;
  user?: ChannelUser;
}

export interface ChannelMessageReaction {
  name: string;
  userId: string;
}

export interface ChannelMessage {
  id: string;
  channelId: string;
  authorUserId: string;
  content: string;
  createdAt: string;
  updatedAt: string;
  pinned: boolean;
  reactions: ChannelMessageReaction[];
  replyCount: number;
  author?: ChannelUser;
  latestReplyAt?: string;
  parentMessageId?: string;
  pinnedAt?: string;
  pinnedBy?: string;
  replyToMessage?: ChannelMessage;
  replyToMessageId?: string;
}

export interface ChannelEvent {
  id: string;
  channelId: string;
  createdAt: string;
  type: ChannelEventType;
  actor?: ChannelUser;
  channel?: Channel;
  data?: unknown;
  messageId?: string;
}

export interface CreateChannelInput {
  name: string;
  description?: string | null;
  groupIds?: string[];
  private?: boolean;
  type?: ChannelType;
  userIds?: string[];
  workspaceId?: string;
}

export interface UpdateChannelInput {
  description?: string | null;
  groupIds?: string[];
  name?: string;
  private?: boolean;
  userIds?: string[];
}

export interface AddChannelMembersInput {
  groupIds?: string[];
  userIds?: string[];
}

export interface CreateDirectMessageChannelInput {
  userId: string;
}

export interface CreateChannelMessageInput {
  content: string;
  clientMessageId?: string;
  parentMessageId?: string;
  replyToMessageId?: string;
}

export interface ChannelMessageQuery {
  limit?: number;
  offset?: number;
}

export interface PinChannelMessageInput {
  pinned: boolean;
}

export interface ChannelMemberRemovalResult {
  channelId: string;
  userId: string;
  removed: boolean;
}

export interface ChannelMessageDeletionResult {
  channelId: string;
  messageId: string;
  deleted: boolean;
}
