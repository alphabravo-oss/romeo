import type {
  Message,
  QueuedChatTurn as PersistedQueuedChatTurn,
  RunRecord,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { compareChatMessages } from "./run-messages";

export interface QueuedChatTurn {
  id: string;
  chatId: string;
  content: string;
  createdAt: string;
  idempotencyKey: string;
  status: "queued" | "leased" | "failed" | "cancelled" | "completed";
  error?: string;
}

export function runUserMessage(
  run: RunRecord,
  messages: Message[],
): Message | undefined {
  const sorted = [...messages].sort(compareChatMessages);
  return (
    sorted
      .filter(
        (message) =>
          message.role === "user" && message.createdAt <= run.createdAt,
      )
      .at(-1) ?? sorted.filter((message) => message.role === "user").at(-1)
  );
}

export async function advanceChatLeaf(
  repository: RomeoRepository,
  chatId: string,
  messageId: string,
): Promise<void> {
  const chat = await repository.getChat(chatId);
  // Spreading the stored chat keeps updatedAt, so moving the branch pointer never reorders the
  // sidebar the way a real edit does.
  if (chat !== undefined)
    await repository.updateChat({ ...chat, activeLeafMessageId: messageId });
}

export function publicQueuedTurn(
  turn: PersistedQueuedChatTurn,
): QueuedChatTurn {
  return {
    id: turn.id,
    chatId: turn.chatId,
    content: turn.content,
    createdAt: turn.createdAt,
    idempotencyKey: turn.idempotencyKey,
    status: turn.status,
    ...(turn.lastErrorMessage === undefined
      ? {}
      : { error: turn.lastErrorMessage }),
  };
}
