import type {
  Message,
  QueuedChatTurn as PersistedQueuedChatTurn,
  RunRecord,
} from "../domain/entities";
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
