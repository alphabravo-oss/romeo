export interface TranscriptMessage {
  id: string;
  role: "system" | "user" | "assistant" | "tool";
  pinned?: boolean;
  legalHold?: boolean;
  policyMarker?: boolean;
  unresolvedTool?: boolean;
  citation?: boolean;
  content: string;
}

export interface TranscriptCheckpoint {
  id: string;
  chatId: string;
  coveredMessageIds: string[];
  summary: string;
  invalidated: boolean;
  reason?: "edited" | "deleted" | "branch" | "policy" | "legal";
}

export function shouldCreateTranscriptCheckpoint(input: {
  messageCount: number;
  threshold: number;
  existing: TranscriptCheckpoint[];
}): boolean {
  return (
    input.messageCount >= input.threshold &&
    input.existing.every((checkpoint) => checkpoint.invalidated)
  );
}

export function createTranscriptCheckpoint(input: {
  id: string;
  chatId: string;
  messages: TranscriptMessage[];
  summarize: (preserved: TranscriptMessage[]) => string;
  scan: (summary: string) => { action: "allow" | "block" | "redact"; text: string };
}): TranscriptCheckpoint | { code: "checkpoint_summary_blocked" } {
  const preserved = input.messages.filter(
    (message) =>
      message.role === "system" ||
      message.pinned === true ||
      message.legalHold === true ||
      message.policyMarker === true ||
      message.unresolvedTool === true ||
      message.citation === true,
  );
  const summary = input.summarize(preserved);
  const scanned = input.scan(summary);
  if (scanned.action === "block")
    return { code: "checkpoint_summary_blocked" };
  return {
    id: input.id,
    chatId: input.chatId,
    coveredMessageIds: input.messages.map((message) => message.id),
    summary: scanned.text,
    invalidated: false,
  };
}

export function invalidateTranscriptCheckpoints(
  checkpoints: TranscriptCheckpoint[],
  reason: NonNullable<TranscriptCheckpoint["reason"]>,
): TranscriptCheckpoint[] {
  return checkpoints.map((checkpoint) =>
    checkpoint.invalidated
      ? checkpoint
      : { ...checkpoint, invalidated: true, reason },
  );
}
