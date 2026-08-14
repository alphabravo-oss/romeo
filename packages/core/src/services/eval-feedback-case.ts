import type { AuthSubject } from "@romeo/auth";
import { createHash } from "node:crypto";

import type { Message } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { getAuthorizedAgent } from "./agent-access";
import { writeAuditLog } from "./audit-log";
import { getAuthorizedChat } from "./chat-access";
import { hasActiveNegativeMessageFeedback } from "./chat-feedback-service";
import { enforceContentPolicyText } from "./content-policy-service";
import { orderChatHistory, pathThroughMessage } from "./run-messages";
import { persistedSubjectActorId } from "./subject-persisted-actor";

export interface FeedbackEvalCaseResult {
  suiteId: string;
  caseId: string;
  created: boolean;
  redaction: {
    evalInputReturned: false;
    assistantContentPersisted: false;
    assistantContentReturned: false;
    feedbackReasonPersisted: false;
    feedbackReasonReturned: false;
    reviewerIdentityPersisted: false;
    reviewerIdentityReturned: false;
  };
}

export interface CreateFeedbackEvalCaseInput {
  subject: AuthSubject;
  agentId: string;
  chatId: string;
  messageId: string;
  suiteId?: string;
  suiteName?: string;
}

const feedbackEvalRedaction: FeedbackEvalCaseResult["redaction"] = {
  evalInputReturned: false,
  assistantContentPersisted: false,
  assistantContentReturned: false,
  feedbackReasonPersisted: false,
  feedbackReasonReturned: false,
  reviewerIdentityPersisted: false,
  reviewerIdentityReturned: false,
};

const feedbackEvalInputMaxLength = 10_000;
const defaultFeedbackEvalSuiteName = "Feedback regressions";

export async function createFeedbackEvalCase(
  repository: RomeoRepository,
  input: CreateFeedbackEvalCaseInput,
): Promise<FeedbackEvalCaseResult> {
  const chat = await getAuthorizedChat(repository, {
    chatId: input.chatId,
    subject: input.subject,
    scope: "chats:read",
    permission: "read",
  });
  const [agent, messages] = await Promise.all([
    getAuthorizedAgent(repository, {
      agentId: input.agentId,
      subject: input.subject,
      scope: "agents:write",
    }),
    repository.listMessages(input.chatId),
  ]);
  if (agent.orgId !== chat.orgId || agent.workspaceId !== chat.workspaceId) {
    throw new ApiError(
      "feedback_eval_agent_mismatch",
      "The target agent must belong to the source chat workspace.",
      409,
    );
  }
  const assistantMessage = messages.find(
    (message) => message.id === input.messageId,
  );
  if (assistantMessage === undefined || assistantMessage.chatId !== chat.id)
    throw notFound("Message");
  if (assistantMessage.role !== "assistant") {
    throw new ApiError(
      "feedback_eval_source_unsupported",
      "Only assistant messages can become feedback-derived eval cases.",
      409,
    );
  }
  if (
    !(await hasActiveNegativeMessageFeedback(
      repository,
      chat.orgId,
      assistantMessage.id,
    ))
  ) {
    throw new ApiError(
      "negative_message_feedback_required",
      "Active negative feedback is required before creating an eval case.",
      409,
    );
  }
  const sourcePrompt = feedbackEvalPrompt(messages, assistantMessage);
  if (sourcePrompt === undefined) {
    throw new ApiError(
      "feedback_eval_input_unavailable",
      "The assistant message does not have a usable user prompt.",
      409,
    );
  }
  if (sourcePrompt.length > feedbackEvalInputMaxLength) {
    throw new ApiError(
      "feedback_eval_input_too_long",
      "The source prompt exceeds the eval case input limit.",
      409,
      { maxLength: feedbackEvalInputMaxLength },
    );
  }
  const prompt = (
    await enforceContentPolicyText(repository, input.subject, sourcePrompt)
  ).content;

  const requestedSuite =
    input.suiteId === undefined
      ? undefined
      : await repository.getEvalSuite(input.suiteId);
  if (input.suiteId !== undefined && requestedSuite === undefined)
    throw notFound("Eval suite");
  if (
    requestedSuite !== undefined &&
    (requestedSuite.agentId !== agent.id ||
      requestedSuite.orgId !== chat.orgId ||
      requestedSuite.workspaceId !== chat.workspaceId)
  ) {
    throw new ApiError(
      "feedback_eval_suite_mismatch",
      "The target eval suite must belong to the selected agent and source workspace.",
      409,
    );
  }

  const suiteId =
    requestedSuite?.id ??
    stableFeedbackId("eval_suite_feedback", [
      chat.orgId,
      chat.workspaceId,
      agent.id,
    ]);
  const caseId = stableFeedbackId("eval_case_feedback", [
    chat.orgId,
    suiteId,
    assistantMessage.id,
  ]);
  const now = new Date().toISOString();
  const created = await repository.transaction(async (transaction) => {
    if (requestedSuite === undefined) {
      const createdBy = await persistedSubjectActorId(
        transaction,
        input.subject,
        {
          kind: "service_account_eval_owner",
          name: "Service Account Eval Owner",
        },
      );
      await transaction.createEvalSuite({
        id: suiteId,
        orgId: chat.orgId,
        workspaceId: chat.workspaceId,
        agentId: agent.id,
        name: input.suiteName ?? defaultFeedbackEvalSuiteName,
        createdBy,
        createdAt: now,
        updatedAt: now,
      });
    }
    const createdCases = await transaction.createEvalCases([
      {
        id: caseId,
        orgId: chat.orgId,
        suiteId,
        input: prompt,
        requiresCitation: false,
        createdAt: now,
      },
    ]);
    if (createdCases.length === 0) return false;
    await writeAuditLog(transaction, {
      subject: input.subject,
      action: "eval.case.create_from_feedback",
      resourceType: "agent",
      resourceId: caseId,
      metadata: {
        agentId: agent.id,
        suiteId,
        chatId: chat.id,
        messageId: assistantMessage.id,
        sourceRating: "negative",
        inputLength: prompt.length,
        redaction: { ...feedbackEvalRedaction },
      },
    });
    return true;
  });
  return {
    suiteId,
    caseId,
    created,
    redaction: { ...feedbackEvalRedaction },
  };
}

function feedbackEvalPrompt(
  messages: Message[],
  assistantMessage: Message,
): string | undefined {
  const ordered = orderChatHistory(messages);
  const branch = pathThroughMessage(ordered, assistantMessage.id);
  const causalUserMessage = [...branch]
    .reverse()
    .find(
      (message) =>
        message.id !== assistantMessage.id && message.role === "user",
    );
  const source =
    causalUserMessage ??
    ordered
      .slice(
        0,
        ordered.findIndex((message) => message.id === assistantMessage.id),
      )
      .reverse()
      .find((message) => message.role === "user");
  const prompt = source?.content.trim();
  return prompt === undefined || prompt.length === 0 ? undefined : prompt;
}

function stableFeedbackId(prefix: string, parts: string[]): string {
  const digest = createHash("sha256")
    .update(parts.join("\u0000"))
    .digest("hex")
    .slice(0, 32);
  return `${prefix}_${digest}`;
}
