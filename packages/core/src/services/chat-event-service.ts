import {
  assertScope,
  AuthorizationError,
  hasWorkspaceAccess,
  type AuthSubject,
} from "@romeo/auth";
import type { ChatEvent } from "@romeo/contracts";

import { createId } from "../ids";
import { InMemoryRealtimeEventBus } from "./realtime-event-bus";

export type ChatChangeAction = Extract<
  ChatEvent,
  { type: "changed" }
>["action"];

export interface ChatEventSubscription {
  connectedEvent: ChatEvent;
  unsubscribe: () => void;
}

export class ChatEventService {
  constructor(
    private readonly events = new InMemoryRealtimeEventBus<ChatEvent>(),
  ) {}

  subscribe(
    subject: AuthSubject,
    workspaceId: string,
    handler: (event: ChatEvent) => void,
  ): ChatEventSubscription {
    assertScope(subject, "chats:read");
    if (!hasWorkspaceAccess(subject, workspaceId)) {
      throw new AuthorizationError(
        "The workspace is outside the caller access.",
      );
    }
    return {
      connectedEvent: {
        id: createId("chat_event"),
        type: "connected",
        workspaceId,
        createdAt: new Date().toISOString(),
      },
      unsubscribe: this.events.subscribe(
        eventChannel(subject.orgId, workspaceId),
        handler,
      ),
    };
  }

  publish(input: {
    action: ChatChangeAction;
    chatId: string;
    orgId: string;
    workspaceId: string;
  }): void {
    this.events.publish(eventChannel(input.orgId, input.workspaceId), {
      id: createId("chat_event"),
      type: "changed",
      action: input.action,
      chatId: input.chatId,
      workspaceId: input.workspaceId,
      createdAt: new Date().toISOString(),
    });
  }
}

function eventChannel(orgId: string, workspaceId: string): string {
  return `${orgId}:${workspaceId}`;
}
