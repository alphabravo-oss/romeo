import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Message } from "../features/types";
import { ChatMessageRow } from "./ChatMessageRow";
import type { ChatMessageRowProps } from "./chat-message-row-types";
import {
  transcriptMessageDomId,
  transcriptMessageHeadingDomId,
} from "./TranscriptWindow";

describe("chat message accessibility", () => {
  it.each(["user", "assistant"] as const)(
    "gives the %s article a stable semantic heading",
    (role) => {
      const message: Message = {
        chatId: "chat-1",
        content: "Hello",
        createdAt: "2026-08-14T00:00:00.000Z",
        id: `id-${role}`,
        role,
      };
      const html = renderToStaticMarkup(
        <ChatMessageRow {...messageProps(message)} />,
      );
      const domId = transcriptMessageDomId(message.id);
      const headingId = transcriptMessageHeadingDomId(message.id);
      expect(html).toContain(`id="${domId}"`);
      expect(html).toContain(`aria-labelledby="${headingId}"`);
      expect(html).toContain(`<h2 class="sr-only" id="${headingId}">`);
      expect(html).toContain("3");
    },
  );
});

function messageProps(message: Message): ChatMessageRowProps {
  const noop = vi.fn();
  return {
    activeVoiceProfileId: undefined,
    agentName: undefined,
    artifact: undefined,
    authorName: undefined,
    chatAccess: "owner",
    citations: [],
    copied: false,
    editing: false,
    editValue: "",
    isGeneratingSpeech: false,
    isLast: false,
    isSpeechTarget: false,
    isStreaming: false,
    isThinking: false,
    message,
    modelDisplayName: undefined,
    nextVariantId: undefined,
    observeStreamingMessage: false,
    onAttachmentRetention: noop,
    onBranch: noop,
    onCancelEdit: noop,
    onContinue: noop,
    onCopy: noop,
    onDelete: noop,
    onEditValueChange: noop,
    onFollowUp: noop,
    onGenerateSpeech: noop,
    onPreview: noop,
    onRate: noop,
    onRegenerate: noop,
    onRegenerateWith: noop,
    onSelectVariant: noop,
    onStartEdit: noop,
    onStreamingContentChange: noop,
    onSubmitEdit: noop,
    positionInSet: 3,
    previousVariantId: undefined,
    rating: undefined,
    reasoning: undefined,
    regenerateModels: [],
    runActivities: [],
    runWait: undefined,
    setSize: 8,
    showContinueButton: false,
    showFollowUps: false,
    showMessageTimestamps: false,
    showRunStatus: false,
    toolCalls: [],
    variantIndex: undefined,
    variantTotal: undefined,
  };
}
