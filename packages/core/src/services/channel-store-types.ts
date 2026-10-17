// Internal record shapes produced by the channel store and translated into the
// public channel contract by channel-mappers. Timestamps are epoch seconds.

export interface ChannelStoreUser {
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  profile_image_url: string;
  is_active: boolean;
  status_emoji: string;
  status_message: string;
  status_expires_at: null;
}

export interface ChannelStoreListItem {
  id: string;
  user_id: string;
  type: string | null;
  name: string;
  description: string | null;
  is_private: boolean | null;
  data: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  access_grants: unknown[];
  created_at: number;
  updated_at: number;
  updated_by: string | null;
  archived_at: number | null;
  archived_by: string | null;
  deleted_at: number | null;
  deleted_by: string | null;
  last_message_at: number | null;
  unread_count: number;
  user_ids?: string[] | undefined;
  users?: ChannelStoreUser[] | undefined;
}

export interface ChannelStoreChannel extends ChannelStoreListItem {
  is_manager: boolean;
  write_access: boolean;
  user_count: number | null;
  last_read_at: number | null;
}

export interface ChannelStoreMessageInput {
  temp_id?: string | undefined;
  content: string;
  reply_to_id?: string | undefined;
  parent_id?: string | undefined;
  data?: Record<string, unknown> | null | undefined;
  meta?: Record<string, unknown> | null | undefined;
}

export interface ChannelStoreMessage {
  id: string;
  user_id: string;
  channel_id: string;
  reply_to_id: string | null;
  parent_id: string | null;
  is_pinned: boolean;
  pinned_by: string | null;
  pinned_at: number | null;
  content: string;
  data: Record<string, unknown> | null | boolean;
  meta: Record<string, unknown> | null;
  created_at: number;
  updated_at: number;
  user: ChannelStoreUser | null;
  reply_to_message: ChannelStoreMessage | null;
  latest_reply_at: number | null;
  reply_count: number;
  reactions: unknown[];
}

export type ChannelEventType =
  | "channel:connected"
  | "message"
  | "message:reply"
  | "message:update"
  | "message:delete"
  | "message:reaction:add"
  | "message:reaction:remove"
  | "last_read_at";

export interface ChannelStoreEvent {
  id: string;
  channel_id: string;
  message_id: string | null;
  created_at: number;
  data: { type: ChannelEventType; data?: unknown };
  user: ChannelStoreUser | null;
  channel: ChannelStoreChannel | null;
}
