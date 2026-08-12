import type { AuthSubject } from "@romeo/auth";
import type { BaseModel, ChatMessage } from "@romeo/providers";

import type {
  AgentVersion,
  BackgroundJob,
  RunRecord,
  ToolOperationDispatchReadbackResponse,
} from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { historyMessageLimit } from "./agent-memory";
import { assistantsEnabledForOrg } from "./chat-experience-service";
import { resolveRunAgentic } from "./knowledge-agentic";
import { managedModelSystemPrompt } from "./run-context-builder";
import {
  buildRunKnowledgeContext,
  type RunKnowledgeCitation,
} from "./run-knowledge";
import {
  buildRunMessages,
  hasMessageTree,
  historyBefore,
  orderChatHistory,
  pathThroughMessage,
} from "./run-messages";
import type { ProviderRoutePlan } from "./provider-routing";
import type { RunServiceOptions } from "./run-service-contracts";
import {
  assistantContentFromRunEvents,
  citationsFromRunEvents,
  routeServingModel,
} from "./run-stream-service";
import {
  boundedModelToolResultContent,
  dispatchContinuationArguments,
  dispatchReadbackToolResult,
  dispatchRunContext,
  objectFromToolInput,
} from "./run-tool-service";
import { runUserMessage } from "./run-command-service";
import { objectKeys } from "./tool-execution";

export interface RunContinuationContext {
  assistantContentPrefix: string;
  citations: RunKnowledgeCitation[];
  messages: ChatMessage[];
}

export class RunContinuationContextBuilder {
  constructor(
    private readonly repository: RomeoRepository,
    private readonly embeddingFetch: typeof fetch | undefined,
    private readonly options: RunServiceOptions,
  ) {}

  async buildApproval(input: {
    agentVersion: AgentVersion;
    approvalRequestId: string;
    model: BaseModel;
    routePlan: ProviderRoutePlan;
    run: RunRecord;
    subject: AuthSubject;
    toolId: string;
    toolInput: unknown;
    toolResult: unknown;
  }): Promise<RunContinuationContext> {
    const base = await this.baseContext(input);
    const toolCall = {
      providerCallId: input.approvalRequestId,
      name: input.toolId,
      arguments: objectFromToolInput(input.toolInput),
      argumentKeys: objectKeys(input.toolInput),
    };
    const built = await this.buildMessages(input, base, [
      {
        role: "assistant" as const,
        content: base.assistantContentPrefix,
        toolCalls: [toolCall],
      },
      {
        role: "tool" as const,
        content: boundedModelToolResultContent(input.toolResult),
        name: input.toolId,
        toolCallId: input.approvalRequestId,
      },
    ]);
    return this.result(base, built);
  }

  async buildDispatch(input: {
    agentVersion: AgentVersion;
    errorCode?: string;
    job: BackgroundJob;
    model: BaseModel;
    response?: ToolOperationDispatchReadbackResponse;
    routePlan: ProviderRoutePlan;
    run: RunRecord;
    subject: AuthSubject;
  }): Promise<RunContinuationContext> {
    const base = await this.baseContext(input);
    const context = dispatchRunContext(input.job);
    if (context === undefined)
      throw new ApiError(
        "tool_dispatch_run_context_invalid",
        "Tool dispatch request is not linked to a resumable run.",
        409,
        { jobId: input.job.id },
      );
    const toolCall = {
      providerCallId: input.job.id,
      name: context.toolId,
      arguments: dispatchContinuationArguments(input.job),
      argumentKeys: ["bodyKeys", "parameterKeys"],
    };
    const built = await this.buildMessages(input, base, [
      {
        role: "assistant" as const,
        content: base.assistantContentPrefix,
        toolCalls: [toolCall],
      },
      {
        role: "tool" as const,
        content: boundedModelToolResultContent(
          dispatchReadbackToolResult(input.job, {
            ...(input.response === undefined
              ? {}
              : { response: input.response }),
            ...(input.errorCode === undefined
              ? {}
              : { errorCode: input.errorCode }),
          }),
        ),
        name: context.toolId,
        toolCallId: input.job.id,
      },
    ]);
    return this.result(base, built);
  }

  private async baseContext(input: {
    agentVersion: AgentVersion;
    run: RunRecord;
    subject: AuthSubject;
  }) {
    const [chatMessages, runEvents] = await Promise.all([
      this.repository.listMessages(input.run.chatId),
      this.repository.listRunEvents(input.run.id),
    ]);
    const userMessage = runUserMessage(input.run, chatMessages);
    if (userMessage === undefined)
      throw new ApiError(
        "run_prompt_context_unavailable",
        "The run cannot be resumed because its prompt context is unavailable.",
        409,
        { runId: input.run.id },
      );
    const ordered = orderChatHistory(chatMessages);
    // Resuming after a tool approval must replay the branch the run was started on, not everything
    // that happened to precede it — a sibling variant sits earlier in createdAt order but is not
    // this run's history. Flat chats have no branch to walk, so they keep the index cut.
    const priorMessages = hasMessageTree(ordered)
      ? pathThroughMessage(ordered, userMessage.id).slice(0, -1)
      : historyBefore(ordered, userMessage.id);
    const agentic = await resolveRunAgentic(
      this.repository,
      input.subject.orgId,
    );
    const knowledge = await buildRunKnowledgeContext(this.repository, {
      agentId: input.run.agentId,
      subject: input.subject,
      query: userMessage.content,
      safetySettings: input.agentVersion.safetySettings,
      ...(agentic ? { agentic: true } : {}),
      ...(this.embeddingFetch === undefined
        ? {}
        : { fetchImpl: this.embeddingFetch }),
      ...(this.options.knowledgeVectorStore === undefined
        ? {}
        : { vectorStore: this.options.knowledgeVectorStore }),
    });
    return {
      assistantContentPrefix: assistantContentFromRunEvents(runEvents),
      existingCitations: citationsFromRunEvents(runEvents),
      knowledgeHits: knowledge.hits,
      priorMessages,
      userMessage,
    };
  }

  private async buildMessages(
    input: {
      agentVersion: AgentVersion;
      model: BaseModel;
      routePlan: ProviderRoutePlan;
      run: RunRecord;
      subject: AuthSubject;
    },
    base: Awaited<ReturnType<RunContinuationContextBuilder["baseContext"]>>,
    tail: ChatMessage[],
  ) {
    const maxHistoryMessages = historyMessageLimit(
      input.agentVersion.memoryPolicy,
    );
    // Resuming after a tool approval is the same run, so it must carry the same prompt shape it
    // started with: a bare run that grew a system turn halfway through would change who the model
    // thinks it is mid-conversation.
    const systemPrompt = (await assistantsEnabledForOrg(
      this.repository,
      input.run.orgId,
    ))
      ? await managedModelSystemPrompt(
          this.repository,
          input.subject,
          input.run.agentId,
          input.agentVersion.systemPrompt,
          this.options,
        )
      : "";
    return buildRunMessages({
      systemPrompt,
      history: base.priorMessages,
      userContent: base.userMessage.content,
      knowledgeHits: base.knowledgeHits,
      model: routeServingModel(input.routePlan, input.model),
      ...(maxHistoryMessages === undefined ? {} : { maxHistoryMessages }),
      tail,
    });
  }

  private result(
    base: Awaited<ReturnType<RunContinuationContextBuilder["baseContext"]>>,
    built: ReturnType<typeof buildRunMessages>,
  ): RunContinuationContext {
    return {
      assistantContentPrefix: base.assistantContentPrefix,
      citations:
        base.existingCitations.length === 0
          ? built.citations
          : base.existingCitations,
      messages: built.messages,
    };
  }
}
