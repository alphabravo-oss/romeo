export type {
  QueuedChatTurn,
  RunEvent,
  RunRecord,
} from "@romeo/api-client/generated/sdk";

export type StartedRunRecord =
  import("@romeo/api-client/generated/sdk").RunRecord & {
    inputMessageId: string;
  };
