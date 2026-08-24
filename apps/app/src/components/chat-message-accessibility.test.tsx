import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";

import type { Message } from "../features/types";
import { MessageAttachments } from "./ChatMessageActions";
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

  it("keeps retention disabled until optimistic attachment ids reconcile", () => {
    const attachment = {
      fileName: "evidence.txt",
      id: "attachment-1",
      kind: "document" as const,
      messageId: "optimistic-placeholder",
      mimeType: "text/plain",
      retainedInContext: true,
      sizeBytes: 8,
    };
    const message: Message = {
      attachments: [attachment],
      chatId: "chat-1",
      content: "Review evidence",
      createdAt: "2026-08-14T00:00:00.000Z",
      id: "message-1",
      role: "user",
    };
    const optimistic = renderToStaticMarkup(
      <MessageAttachments
        isStreaming={false}
        message={message}
        onPreview={vi.fn()}
        onRetentionChange={vi.fn()}
      />,
    );
    const persisted = renderToStaticMarkup(
      <MessageAttachments
        isStreaming={false}
        message={{
          ...message,
          attachments: [{ ...attachment, messageId: message.id }],
        }}
        onPreview={vi.fn()}
        onRetentionChange={vi.fn()}
      />,
    );

    expect(optimistic).toMatch(
      /aria-label="keepContext: evidence\.txt" disabled=""/u,
    );
    expect(optimistic).toContain('title="waitForAttachmentSync"');
    expect(persisted).not.toMatch(
      /aria-label="keepContext: evidence\.txt" disabled=""/u,
    );
  });
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
