import { pathId, withQuery } from "../path";
import type { RomeoTransport } from "../transport";
import type {
  OpenAiChatCompletionInput,
  OpenAiChatCompletionResponse,
  OpenAiEmbeddingInput,
  OpenAiEmbeddingResponse,
  OpenAiModel,
  OpenAiModelListResponse,
  OpenWebUiChannelInput,
  OpenWebUiChannelListItemResponse,
  OpenWebUiChannelMessageInput,
  OpenWebUiChannelMessageResponse,
  OpenWebUiChannelMemberResponse,
  OpenWebUiChannelMembersResponse,
  OpenWebUiChannelResponse,
  OpenWebUiChatResponse,
  OpenWebUiChatTitleIdResponse,
  OpenWebUiConfigResponse,
  OpenWebUiCreateChatInput,
  OpenWebUiCreateFolderInput,
  OpenWebUiFolderListItemResponse,
  OpenWebUiFolderResponse,
  OpenWebUiSessionUserResponse,
  OpenWebUiTagResponse,
  OpenWebUiUpdateChatFolderInput,
  OpenWebUiUpdateFolderInput,
  OpenWebUiVersionResponse,
  OpenWebUiVersionUpdatesResponse,
} from "../types";

export function createCompatibilityResource(transport: RomeoTransport) {
  return {
    models: () =>
      transport.request<OpenAiModelListResponse>(
        "GET",
        "/api/v1/openai/models",
      ),
    model: (model: string) =>
      transport.request<OpenAiModel>(
        "GET",
        `/api/v1/openai/models/${pathId(model)}`,
      ),
    openWebUiConfig: () =>
      transport.request<OpenWebUiConfigResponse>(
        "GET",
        "/api/v1/openwebui/config",
      ),
    openWebUiSessionUser: () =>
      transport.request<OpenWebUiSessionUserResponse>("GET", "/api/v1/auths/"),
    openWebUiChats: (
      input: {
        includeFolders?: boolean;
        includePinned?: boolean;
        page?: number;
      } = {},
    ) =>
      transport.request<OpenWebUiChatTitleIdResponse[]>(
        "GET",
        withQuery("/api/v1/chats/", {
          include_folders: input.includeFolders,
          include_pinned: input.includePinned,
          page: input.page,
        }),
      ),
    openWebUiCreateChat: (input: OpenWebUiCreateChatInput) =>
      transport.request<OpenWebUiChatResponse>(
        "POST",
        "/api/v1/chats/new",
        input,
      ),
    openWebUiPinnedChats: () =>
      transport.request<OpenWebUiChatTitleIdResponse[]>(
        "GET",
        "/api/v1/chats/pinned",
      ),
    openWebUiChatPinnedStatus: (chatId: string) =>
      transport.request<boolean | null>(
        "GET",
        `/api/v1/chats/${pathId(chatId)}/pinned`,
      ),
    openWebUiToggleChatPinned: (chatId: string) =>
      transport.request<OpenWebUiChatResponse>(
        "POST",
        `/api/v1/chats/${pathId(chatId)}/pin`,
      ),
    openWebUiSearchChats: (text: string, page?: number) =>
      transport.request<OpenWebUiChatTitleIdResponse[]>(
        "GET",
        withQuery("/api/v1/chats/search", { text, page }),
      ),
    openWebUiArchivedChats: (page?: number) =>
      transport.request<OpenWebUiChatTitleIdResponse[]>(
        "GET",
        withQuery("/api/v1/chats/archived", { page }),
      ),
    openWebUiAllArchivedChats: () =>
      transport.request<OpenWebUiChatResponse[]>(
        "GET",
        "/api/v1/chats/all/archived",
      ),
    openWebUiAllTags: () =>
      transport.request<OpenWebUiTagResponse[]>(
        "GET",
        "/api/v1/chats/all/tags",
      ),
    openWebUiChatsByTag: (name: string) =>
      transport.request<OpenWebUiChatTitleIdResponse[]>(
        "POST",
        "/api/v1/chats/tags",
        { name },
      ),
    openWebUiChatTags: (chatId: string) =>
      transport.request<OpenWebUiTagResponse[]>(
        "GET",
        `/api/v1/chats/${pathId(chatId)}/tags`,
      ),
    openWebUiAddChatTag: (chatId: string, name: string) =>
      transport.request<OpenWebUiTagResponse[]>(
        "POST",
        `/api/v1/chats/${pathId(chatId)}/tags`,
        { name },
      ),
    openWebUiDeleteChatTag: (chatId: string, name: string) =>
      transport.request<OpenWebUiTagResponse[]>(
        "DELETE",
        `/api/v1/chats/${pathId(chatId)}/tags`,
        { name },
      ),
    openWebUiFolderChats: (folderId: string) =>
      transport.request<OpenWebUiChatResponse[]>(
        "GET",
        `/api/v1/chats/folder/${pathId(folderId)}`,
      ),
    openWebUiFolderChatList: (folderId: string, page?: number) =>
      transport.request<OpenWebUiChatTitleIdResponse[]>(
        "GET",
        withQuery(`/api/v1/chats/folder/${pathId(folderId)}/list`, { page }),
      ),
    openWebUiUpdateChatFolder: (
      chatId: string,
      input: OpenWebUiUpdateChatFolderInput,
    ) =>
      transport.request<OpenWebUiChatResponse>(
        "POST",
        `/api/v1/chats/${pathId(chatId)}/folder`,
        input,
      ),
    openWebUiFolders: () =>
      transport.request<OpenWebUiFolderListItemResponse[]>(
        "GET",
        "/api/v1/folders/",
      ),
    openWebUiCreateFolder: (input: OpenWebUiCreateFolderInput) =>
      transport.request<OpenWebUiFolderResponse>(
        "POST",
        "/api/v1/folders/",
        input,
      ),
    openWebUiFolder: (folderId: string) =>
      transport.request<OpenWebUiFolderResponse>(
        "GET",
        `/api/v1/folders/${pathId(folderId)}`,
      ),
    openWebUiUpdateFolder: (
      folderId: string,
      input: OpenWebUiUpdateFolderInput,
    ) =>
      transport.request<OpenWebUiFolderResponse>(
        "POST",
        `/api/v1/folders/${pathId(folderId)}/update`,
        input,
      ),
    openWebUiUpdateFolderExpanded: (folderId: string, isExpanded: boolean) =>
      transport.request<OpenWebUiFolderResponse>(
        "POST",
        `/api/v1/folders/${pathId(folderId)}/update/expanded`,
        { is_expanded: isExpanded },
      ),
    openWebUiUpdateFolderParent: (folderId: string, parentId?: string | null) =>
      transport.request<OpenWebUiFolderResponse>(
        "POST",
        `/api/v1/folders/${pathId(folderId)}/update/parent`,
        { parent_id: parentId ?? null },
      ),
    openWebUiDeleteFolder: (folderId: string, deleteContents = false) =>
      transport.request<OpenWebUiFolderResponse>(
        "DELETE",
        withQuery(`/api/v1/folders/${pathId(folderId)}`, {
          delete_contents: deleteContents,
        }),
      ),
    openWebUiChannels: () =>
      transport.request<OpenWebUiChannelListItemResponse[]>(
        "GET",
        "/api/v1/channels/",
      ),
    openWebUiCreateChannel: (input: OpenWebUiChannelInput) =>
      transport.request<OpenWebUiChannelResponse>(
        "POST",
        "/api/v1/channels/create",
        input,
      ),
    openWebUiDmChannelForUser: (userId: string) =>
      transport.request<OpenWebUiChannelResponse>(
        "GET",
        `/api/v1/channels/users/${pathId(userId)}`,
      ),
    openWebUiChannel: (channelId: string) =>
      transport.request<OpenWebUiChannelResponse>(
        "GET",
        `/api/v1/channels/${pathId(channelId)}`,
      ),
    openWebUiChannelMembers: (channelId: string) =>
      transport.request<OpenWebUiChannelMembersResponse>(
        "GET",
        `/api/v1/channels/${pathId(channelId)}/members`,
      ),
    openWebUiChannelEvents: (channelId: string) =>
      transport.events(`/api/v1/channels/${pathId(channelId)}/events`),
    openWebUiChannelMessages: (
      channelId: string,
      input: { skip?: number; limit?: number } = {},
    ) =>
      transport.request<OpenWebUiChannelMessageResponse[]>(
        "GET",
        withQuery(`/api/v1/channels/${pathId(channelId)}/messages`, {
          skip: input.skip,
          limit: input.limit,
        }),
      ),
    openWebUiPinnedChannelMessages: (channelId: string, page?: number) =>
      transport.request<OpenWebUiChannelMessageResponse[]>(
        "GET",
        withQuery(`/api/v1/channels/${pathId(channelId)}/messages/pinned`, {
          page,
        }),
      ),
    openWebUiChannelMessage: (channelId: string, messageId: string) =>
      transport.request<OpenWebUiChannelMessageResponse>(
        "GET",
        `/api/v1/channels/${pathId(channelId)}/messages/${pathId(messageId)}`,
      ),
    openWebUiChannelMessageData: (channelId: string, messageId: string) =>
      transport.request<Record<string, unknown> | null>(
        "GET",
        `/api/v1/channels/${pathId(channelId)}/messages/${pathId(messageId)}/data`,
      ),
    openWebUiChannelThreadMessages: (
      channelId: string,
      messageId: string,
      input: { skip?: number; limit?: number } = {},
    ) =>
      transport.request<OpenWebUiChannelMessageResponse[]>(
        "GET",
        withQuery(
          `/api/v1/channels/${pathId(channelId)}/messages/${pathId(messageId)}/thread`,
          {
            skip: input.skip,
            limit: input.limit,
          },
        ),
      ),
    openWebUiPostChannelMessage: (
      channelId: string,
      input: OpenWebUiChannelMessageInput,
    ) =>
      transport.request<OpenWebUiChannelMessageResponse>(
        "POST",
        `/api/v1/channels/${pathId(channelId)}/messages/post`,
        input,
      ),
    openWebUiPinChannelMessage: (
      channelId: string,
      messageId: string,
      isPinned: boolean,
    ) =>
      transport.request<OpenWebUiChannelMessageResponse>(
        "POST",
        `/api/v1/channels/${pathId(channelId)}/messages/${pathId(messageId)}/pin`,
        { is_pinned: isPinned },
      ),
    openWebUiUpdateChannelMessage: (
      channelId: string,
      messageId: string,
      input: OpenWebUiChannelMessageInput,
    ) =>
      transport.request<OpenWebUiChannelMessageResponse>(
        "POST",
        `/api/v1/channels/${pathId(channelId)}/messages/${pathId(messageId)}/update`,
        input,
      ),
    openWebUiAddChannelMessageReaction: (
      channelId: string,
      messageId: string,
      name: string,
    ) =>
      transport.request<boolean>(
        "POST",
        `/api/v1/channels/${pathId(channelId)}/messages/${pathId(messageId)}/reactions/add`,
        { name },
      ),
    openWebUiRemoveChannelMessageReaction: (
      channelId: string,
      messageId: string,
      name: string,
    ) =>
      transport.request<boolean>(
        "POST",
        `/api/v1/channels/${pathId(channelId)}/messages/${pathId(messageId)}/reactions/remove`,
        { name },
      ),
    openWebUiDeleteChannelMessage: (channelId: string, messageId: string) =>
      transport.request<boolean>(
        "DELETE",
        `/api/v1/channels/${pathId(channelId)}/messages/${pathId(messageId)}/delete`,
      ),
    openWebUiMarkChannelRead: (channelId: string) =>
      transport.request<boolean>(
        "POST",
        `/api/v1/channels/${pathId(channelId)}/messages/read`,
      ),
    openWebUiUpdateChannelMemberActive: (
      channelId: string,
      isActive: boolean,
    ) =>
      transport.request<boolean>(
        "POST",
        `/api/v1/channels/${pathId(channelId)}/members/active`,
        { is_active: isActive },
      ),
    openWebUiAddChannelMembers: (
      channelId: string,
      input: Pick<OpenWebUiChannelInput, "group_ids" | "user_ids">,
    ) =>
      transport.request<OpenWebUiChannelMemberResponse[]>(
        "POST",
        `/api/v1/channels/${pathId(channelId)}/update/members/add`,
        input,
      ),
    openWebUiRemoveChannelMembers: (
      channelId: string,
      input: Pick<OpenWebUiChannelInput, "user_ids">,
    ) =>
      transport.request<number>(
        "POST",
        `/api/v1/channels/${pathId(channelId)}/update/members/remove`,
        input,
      ),
    openWebUiUpdateChannel: (channelId: string, input: OpenWebUiChannelInput) =>
      transport.request<OpenWebUiChannelResponse>(
        "POST",
        `/api/v1/channels/${pathId(channelId)}/update`,
        input,
      ),
    openWebUiDeleteChannel: (channelId: string) =>
      transport.request<boolean>(
        "DELETE",
        `/api/v1/channels/${pathId(channelId)}/delete`,
      ),
    openWebUiVersion: () =>
      transport.request<OpenWebUiVersionResponse>(
        "GET",
        "/api/v1/openwebui/version",
      ),
    openWebUiVersionUpdates: () =>
      transport.request<OpenWebUiVersionUpdatesResponse>(
        "GET",
        "/api/v1/openwebui/version/updates",
      ),
    chatCompletions: (input: OpenAiChatCompletionInput) =>
      transport.request<OpenAiChatCompletionResponse>(
        "POST",
        "/api/v1/chat/completions",
        input,
      ),
    embeddings: (input: OpenAiEmbeddingInput) =>
      transport.request<OpenAiEmbeddingResponse>(
        "POST",
        "/api/v1/embeddings",
        input,
      ),
  };
}
