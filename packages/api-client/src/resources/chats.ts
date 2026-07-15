import { pathId, withQuery } from "../path";
import type { RomeoTransport } from "../transport";
import type {
  AssignChatTagInput,
  Chat,
  ChatComment,
  ChatDeletionPreview,
  ChatDeletionResult,
  ChatTag,
  CreateChatCommentInput,
  CreateChatInput,
  DeleteChatInput,
  ForkChatInput,
  ListChatsInput,
  Message,
  MessageFeedbackState,
  RunEvent,
  RunRecord,
  StartRunInput,
  UpdateChatInput,
  UpdateChatLegalHoldInput,
  UpdateMessageFeedbackInput,
} from "../types";

export function createChatResource(transport: RomeoTransport) {
  return {
    list: (input?: string | ListChatsInput) =>
      transport.data<Chat[]>(
        "GET",
        withQuery(
          "/api/v1/chats",
          typeof input === "string"
            ? { workspaceId: input }
            : { workspaceId: input?.workspaceId, archived: input?.archived },
        ),
      ),
    create: (input: CreateChatInput) =>
      transport.data<Chat>("POST", "/api/v1/chats", input),
    get: (chatId: string) =>
      transport.data<Chat>("GET", `/api/v1/chats/${pathId(chatId)}`),
    update: (chatId: string, input: UpdateChatInput) =>
      transport.data<Chat>("PATCH", `/api/v1/chats/${pathId(chatId)}`, input),
    archive: (chatId: string) =>
      transport.data<Chat>("POST", `/api/v1/chats/${pathId(chatId)}/archive`),
    tags: () => transport.data<ChatTag[]>("GET", "/api/v1/chat-tags"),
    taggedChats: (
      tagSlug: string,
      input: { archived?: "active" | "all" | "archived" } = {},
    ) =>
      transport.data<Chat[]>(
        "GET",
        withQuery(`/api/v1/chat-tags/${pathId(tagSlug)}/chats`, {
          archived: input.archived,
        }),
      ),
    tagAssignments: (chatId: string) =>
      transport.data<ChatTag[]>(
        "GET",
        `/api/v1/chats/${pathId(chatId)}/tag-assignments`,
      ),
    assignTag: (chatId: string, input: AssignChatTagInput) =>
      transport.data<ChatTag[]>(
        "POST",
        `/api/v1/chats/${pathId(chatId)}/tag-assignments`,
        input,
      ),
    removeTag: (chatId: string, tagSlug: string) =>
      transport.data<ChatTag[]>(
        "DELETE",
        `/api/v1/chats/${pathId(chatId)}/tag-assignments/${pathId(tagSlug)}`,
      ),
    deletePreview: (chatId: string) =>
      transport.data<ChatDeletionPreview>(
        "GET",
        `/api/v1/chats/${pathId(chatId)}/delete-preview`,
      ),
    delete: (chatId: string, input: DeleteChatInput) =>
      transport.data<ChatDeletionResult>(
        "DELETE",
        `/api/v1/chats/${pathId(chatId)}`,
        input,
      ),
    fork: (chatId: string, input: ForkChatInput = {}) =>
      transport.data<Chat>(
        "POST",
        `/api/v1/chats/${pathId(chatId)}/fork`,
        input,
      ),
    unarchive: (chatId: string) =>
      transport.data<Chat>("POST", `/api/v1/chats/${pathId(chatId)}/unarchive`),
    updateLegalHold: (chatId: string, input: UpdateChatLegalHoldInput) =>
      transport.data<Chat>(
        "POST",
        `/api/v1/chats/${pathId(chatId)}/legal-hold`,
        input,
      ),
    messages: (chatId: string) =>
      transport.data<Message[]>(
        "GET",
        `/api/v1/chats/${pathId(chatId)}/messages`,
      ),
    messageFeedbackList: (chatId: string) =>
      transport.data<MessageFeedbackState[]>(
        "GET",
        `/api/v1/chats/${pathId(chatId)}/message-feedback`,
      ),
    messageFeedback: (chatId: string, messageId: string) =>
      transport.data<MessageFeedbackState>(
        "GET",
        `/api/v1/chats/${pathId(chatId)}/messages/${pathId(messageId)}/feedback`,
      ),
    updateMessageFeedback: (
      chatId: string,
      messageId: string,
      input: UpdateMessageFeedbackInput,
    ) =>
      transport.data<MessageFeedbackState>(
        "POST",
        `/api/v1/chats/${pathId(chatId)}/messages/${pathId(messageId)}/feedback`,
        input,
      ),
    comments: (chatId: string) =>
      transport.data<ChatComment[]>(
        "GET",
        `/api/v1/chats/${pathId(chatId)}/comments`,
      ),
    comment: (chatId: string, input: CreateChatCommentInput) =>
      transport.data<ChatComment>(
        "POST",
        `/api/v1/chats/${pathId(chatId)}/comments`,
        input,
      ),
    startRun: (input: StartRunInput) =>
      transport.data<RunRecord>("POST", "/api/v1/runs", input),
    run: (runId: string) =>
      transport.data<RunRecord>("GET", `/api/v1/runs/${pathId(runId)}`),
    cancelRun: (runId: string) =>
      transport.data<RunRecord>("POST", `/api/v1/runs/${pathId(runId)}/cancel`),
    events: async function* (runId: string): AsyncIterable<RunEvent> {
      for await (const event of transport.events(
        `/api/v1/runs/${pathId(runId)}/events`,
      )) {
        if (isRunEvent(event.data)) yield event.data;
      }
    },
  };
}

function isRunEvent(value: unknown): value is RunEvent {
  return (
    typeof value === "object" &&
    value !== null &&
    "type" in value &&
    "runId" in value
  );
}
