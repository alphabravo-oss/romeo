import type { OpenWebUiChannelEventDataType } from "@romeo/contracts";

export type ChannelType = "dm" | "group" | "standard";

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
  type: OpenWebUiChannelEventDataType;
  actor?: ChannelUser;
  channel?: Channel;
  data?: unknown;
  messageId?: string;
}

export interface ChannelEventSubscription {
  connectedEvent: ChannelEvent;
  unsubscribe: () => void;
}

export interface CreateChannelInput {
  name: string;
  description?: string | null | undefined;
  groupIds?: string[] | undefined;
  private?: boolean | undefined;
  type?: ChannelType | undefined;
  userIds?: string[] | undefined;
  workspaceId?: string | undefined;
}

export interface UpdateChannelInput {
  description?: string | null | undefined;
  groupIds?: string[] | undefined;
  name?: string | undefined;
  private?: boolean | undefined;
  userIds?: string[] | undefined;
}

export interface AddChannelMembersInput {
  groupIds?: string[] | undefined;
  userIds?: string[] | undefined;
}

export interface CreateDirectMessageChannelInput {
  userId: string;
}

export interface CreateChannelMessageInput {
  content: string;
  clientMessageId?: string | undefined;
  parentMessageId?: string | undefined;
  replyToMessageId?: string | undefined;
}

export interface PinChannelMessageInput {
  pinned: boolean;
}

export interface RemoveChannelMemberResult {
  channelId: string;
  userId: string;
  removed: boolean;
}
