export interface OpenAiChatCompletionInput {
  model: string;
  messages: OpenAiChatCompletionMessage[];
  stream?: false;
  stream_options?: { include_usage?: boolean };
  tools?: OpenAiChatCompletionTool[];
  [key: string]: unknown;
}

export type OpenAiChatCompletionMessage =
  | { role: "system" | "user"; content: string; [key: string]: unknown }
  | {
      role: "assistant";
      content?: string | null;
      tool_calls?: unknown[];
      [key: string]: unknown;
    }
  | {
      role: "tool";
      content: string;
      name?: string;
      tool_call_id?: string;
      [key: string]: unknown;
    };

export interface OpenAiChatCompletionTool {
  type: "function";
  function: {
    name: string;
    description?: string;
    parameters?: Record<string, unknown>;
  };
  [key: string]: unknown;
}

export interface OpenAiChatCompletionResponse {
  id: string;
  object: "chat.completion";
  created: number;
  model: string;
  choices: Array<{
    index: number;
    finish_reason: "stop" | "tool_calls";
    message: {
      role: "assistant";
      content: string | null;
      tool_calls?: OpenAiChatCompletionToolCall[];
    };
  }>;
  usage: {
    prompt_tokens?: number;
    completion_tokens?: number;
    total_tokens?: number;
  } | null;
}

export interface OpenAiChatCompletionToolCall {
  id: string;
  type: "function";
  function: {
    name: string;
    arguments: string;
  };
}

export interface OpenAiModelListResponse {
  object: "list";
  data: OpenAiModel[];
}

export interface OpenAiModel {
  id: string;
  object: "model";
  created: number;
  owned_by: string;
}

export interface OpenAiEmbeddingInput {
  model: string;
  input: string | string[];
  encoding_format?: "float";
  [key: string]: unknown;
}

export interface OpenAiEmbeddingResponse {
  object: "list";
  model: string;
  data: Array<{
    object: "embedding";
    index: number;
    embedding: number[];
  }>;
  usage: {
    prompt_tokens?: number;
    total_tokens?: number;
  } | null;
}

export interface OpenWebUiConfigResponse {
  status: true;
  name: string;
  version: string;
  default_locale: string;
  oauth: {
    providers: Record<string, unknown>;
    auto_redirect: boolean;
  };
  features: {
    auth: boolean;
    auth_trusted_header: boolean;
    enable_signup_password_confirmation: boolean;
    enable_ldap: boolean;
    enable_signup: boolean;
    enable_login_form: boolean;
    enable_websocket: boolean;
    enable_api_keys: boolean;
    enable_password_change_form: boolean;
    enable_version_update_check: boolean;
    enable_public_active_users_count: boolean;
    enable_easter_eggs: boolean;
    enable_direct_connections: boolean;
    enable_folders: boolean;
    folder_max_file_count: number;
    enable_channels: boolean;
    enable_calendar: boolean;
    enable_automations: boolean;
    enable_notes: boolean;
    enable_web_search: boolean;
    enable_code_execution: boolean;
    enable_code_interpreter: boolean;
    enable_image_generation: boolean;
    enable_autocomplete_generation: boolean;
    enable_community_sharing: boolean;
    enable_message_rating: boolean;
    enable_user_webhooks: boolean;
    enable_user_status: boolean;
    enable_admin_export: boolean;
    enable_admin_chat_access: boolean;
    enable_admin_analytics: boolean;
    enable_google_drive_integration: boolean;
    enable_onedrive_integration: boolean;
    enable_memories: boolean;
    [key: string]: unknown;
  };
  default_models: string[];
  default_pinned_models: string[];
  default_prompt_suggestions: unknown[];
  code: {
    engine: string;
    interpreter_engine: string;
  };
  audio: {
    tts: {
      engine: string;
      voice: string;
      split_on: string;
    };
    stt: {
      engine: string;
    };
  };
  file: {
    max_size: number;
    max_count: number;
    image_compression: {
      width: number;
      height: number;
    };
  };
  permissions: Record<string, unknown>;
  ui: {
    pending_user_overlay_title: string;
    pending_user_overlay_content: string;
    response_watermark: string;
    iframe_csp: string;
  };
  license_metadata: Record<string, unknown> | null;
  [key: string]: unknown;
}

export interface OpenWebUiVersionResponse {
  version: string;
  deployment_id: string;
}

export interface OpenWebUiVersionUpdatesResponse {
  current: string;
  latest: string;
}

export interface OpenWebUiSessionUserResponse {
  token: null;
  token_type: "Bearer";
  expires_at: null;
  id: string;
  email: string;
  name: string;
  role: "admin" | "user";
  profile_image_url: string;
  permissions: {
    workspace: Record<string, boolean>;
    features: Record<string, boolean>;
    chat: Record<string, boolean>;
    sharing: Record<string, boolean>;
    settings: Record<string, boolean>;
    access_grants: Record<string, boolean>;
    [key: string]: unknown;
  };
  bio: null;
  gender: null;
  date_of_birth: null;
  status_emoji: string;
  status_message: string;
  status_expires_at: null;
}

export interface OpenWebUiChatTitleIdResponse {
  id: string;
  title: string;
  updated_at: number;
  created_at: number;
  last_read_at: null;
}

export interface OpenWebUiChatResponse extends OpenWebUiChatTitleIdResponse {
  user_id: string;
  chat: Record<string, unknown>;
  share_id: null;
  archived: boolean;
  pinned: boolean;
  meta: Record<string, unknown>;
  folder_id: string | null;
  tasks: null;
  summary: null;
}

export interface OpenWebUiCreateChatInput {
  chat: Record<string, unknown>;
  folder_id?: string | null;
}

export interface OpenWebUiFolderListItemResponse {
  id: string;
  name: string;
  meta: Record<string, unknown> | null;
  parent_id: string | null;
  is_expanded: boolean;
  created_at: number;
  updated_at: number;
}

export interface OpenWebUiFolderResponse extends OpenWebUiFolderListItemResponse {
  user_id: string;
  items: null;
  data: Record<string, unknown> | null;
}

export interface OpenWebUiCreateFolderInput {
  name: string;
  data?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  parent_id?: string | null;
}

export interface OpenWebUiUpdateFolderInput {
  name?: string;
  data?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  parent_id?: string | null;
}

export interface OpenWebUiUpdateChatFolderInput {
  folder_id?: string | null;
}

export interface OpenWebUiTagResponse {
  id: string;
  name: string;
  user_id: string;
  meta: Record<string, unknown> | null;
}

export interface OpenWebUiChannelListItemResponse {
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
  user_ids?: string[];
  users?: OpenWebUiChannelUserResponse[];
}

export interface OpenWebUiChannelResponse extends OpenWebUiChannelListItemResponse {
  is_manager: boolean;
  write_access: boolean;
  user_count: number | null;
  last_read_at: number | null;
}

export interface OpenWebUiChannelUserResponse {
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

export interface OpenWebUiChannelMembersResponse {
  users: OpenWebUiChannelUserResponse[];
  total: number;
}

export interface OpenWebUiChannelMemberResponse {
  id: string;
  channel_id: string;
  user_id: string;
  role: string | null;
  status: string | null;
  is_active: boolean;
  is_channel_muted: boolean;
  is_channel_pinned: boolean;
  data: Record<string, unknown> | null;
  meta: Record<string, unknown> | null;
  invited_at: number | null;
  invited_by: string | null;
  joined_at: number;
  left_at: number | null;
  last_read_at: number | null;
  created_at: number;
  updated_at: number;
}

export interface OpenWebUiChannelInput {
  type?: string;
  name?: string;
  description?: string | null;
  is_private?: boolean | null;
  data?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
  access_grants?: Record<string, unknown>[];
  group_ids?: string[];
  user_ids?: string[];
}

export interface OpenWebUiChannelMessageInput {
  temp_id?: string;
  content: string;
  reply_to_id?: string;
  parent_id?: string;
  data?: Record<string, unknown> | null;
  meta?: Record<string, unknown> | null;
}

export interface OpenWebUiChannelMessageResponse {
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
  user: OpenWebUiChannelUserResponse | null;
  reply_to_message: OpenWebUiChannelMessageResponse | null;
  latest_reply_at: number | null;
  reply_count: number;
  reactions: unknown[];
}

export type OpenWebUiChannelEventDataType =
  | "channel:connected"
  | "message"
  | "message:reply"
  | "message:update"
  | "message:delete"
  | "message:reaction:add"
  | "message:reaction:remove"
  | "last_read_at";

export interface OpenWebUiChannelEvent {
  id: string;
  channel_id: string;
  message_id: string | null;
  created_at: number;
  data: {
    type: OpenWebUiChannelEventDataType;
    data: unknown;
  };
  user: OpenWebUiChannelUserResponse | null;
  channel: OpenWebUiChannelResponse | null;
}
