import type { RetrievalHit } from '@romeo/rag'
import type { BaseModel, ChatMessage } from '@romeo/providers'

import type { Message } from '../domain/entities'
import { ApiError } from '../errors'
import { knowledgeUserContent, renderKnowledgeContext, stripRunCitations, type RunKnowledgeCitation } from './run-knowledge'
import { estimateTokens } from './token-estimate'

const messageFramingTokens = 4
const estimatorSafetyFraction = 0.85
const maxOutputReserveTokens = 4_096
const outputReserveWindowFraction = 0.25

const roleRank = (role: Message['role']): number => (role === 'user' ? 0 : 1)

export function compareChatMessages(left: Message, right: Message): number {
  // Ids are random UUIDs, not monotonic, so an assistant can sort before its own user turn on a
  // shared millisecond. roleRank recovers causal order without a sequence column.
  return left.createdAt.localeCompare(right.createdAt) || roleRank(left.role) - roleRank(right.role) || left.id.localeCompare(right.id)
}

export function orderChatHistory(messages: Message[]): Message[] {
  return [...messages].sort(compareChatMessages)
}

export function historyBefore(ordered: Message[], userMessageId: string): Message[] {
  // Index cut, not a createdAt compare: a strict '<' drops prior messages sharing the boundary millisecond.
  // Security: the search is confined to this chat's own ordered messages, so an id from another chat
  // simply misses (index -1) and yields no history — it can never splice in another chat's turns.
  const index = ordered.findIndex((message) => message.id === userMessageId)
  return index === -1 ? [] : ordered.slice(0, index)
}

export function toHistoryChatMessages(messages: Message[]): ChatMessage[] {
  // Whitelist, not a map: persisted 'system' rows are user-authored via import (privilege escalation)
  // and persisted 'tool' rows would serialize without a tool_call_id, which providers reject with a 400.
  return messages.flatMap((message) => {
    if (message.role !== 'user' && message.role !== 'assistant') return []
    const content = message.role === 'assistant' ? stripRunCitations(message.content) : message.content
    if (content.trim().length === 0) return []
    return [{ role: message.role, content }]
  })
}

function chatMessageTokens(message: ChatMessage): number {
  const toolCalls =
    message.role === 'assistant' && message.toolCalls !== undefined && message.toolCalls.length > 0
      ? estimateTokens(JSON.stringify(message.toolCalls))
      : 0
  return estimateTokens(message.content) + toolCalls + messageFramingTokens
}

export interface BuildRunMessagesInput {
  systemPrompt: string
  history: Message[]
  userContent: string
  knowledgeHits: RetrievalHit[]
  tail?: ChatMessage[]
  // The model that will actually serve this run. One model, not a route: the id and the window
  // reported by run_context_window_exceeded are read off this same object, so they cannot disagree.
  model: BaseModel
  maxHistoryMessages?: number
}

export interface BuildRunMessagesResult {
  messages: ChatMessage[]
  citations: RunKnowledgeCitation[]
  estimatedInputTokens: number
  historyMessages: number
  historyTruncated: boolean
  knowledgeHitsDropped: number
}

export function buildRunMessages(input: BuildRunMessagesInput): BuildRunMessagesResult {
  const contextWindow = modelContextWindow(input.model)
  const reserve = Math.min(maxOutputReserveTokens, Math.floor(contextWindow * outputReserveWindowFraction))
  const usable = Math.floor(Math.max(0, contextWindow - reserve) * estimatorSafetyFraction)
  const tail = input.tail ?? []

  const allCandidates = toHistoryChatMessages(orderChatHistory(input.history))
  // A policy cap is the operator's own intent, so it is applied before the budget and never counts as truncation.
  const candidates = input.maxHistoryMessages === undefined ? allCandidates : allCandidates.slice(-input.maxHistoryMessages)

  const systemMessage: ChatMessage = { role: 'system', content: input.systemPrompt }
  const systemTokens = chatMessageTokens(systemMessage)
  const tailTokens = tail.reduce((total, message) => total + chatMessageTokens(message), 0)

  const hits = [...input.knowledgeHits]
  let knowledgeHitsDropped = 0
  let userMessage = knowledgeUserMessage(hits, input.userContent)
  let floorTokens = systemTokens + chatMessageTokens(userMessage) + tailTokens

  // An unknown window must degrade to zero history, never throw — the budget is only enforceable with a real one.
  const budgetEnabled = contextWindow > 0
  if (budgetEnabled) {
    while (floorTokens > usable && hits.length > 0) {
      // Hits arrive score-sorted descending, so popping sheds the least relevant context first.
      hits.pop()
      knowledgeHitsDropped += 1
      userMessage = knowledgeUserMessage(hits, input.userContent)
      floorTokens = systemTokens + chatMessageTokens(userMessage) + tailTokens
    }
    if (floorTokens > usable) {
      throw new ApiError('run_context_window_exceeded', 'The conversation exceeds the model context window.', 400, {
        // Both fields come off input.model, so the payload always describes one real model.
        modelId: input.model.id,
        contextWindow,
        estimatedTokens: floorTokens
      })
    }
  }

  const kept = keepNewestWithinBudget(candidates, budgetEnabled ? usable - floorTokens : 0)
  const messages: ChatMessage[] = [systemMessage, ...kept, userMessage, ...tail]
  return {
    messages,
    // Citations are re-derived from the same shed array renderKnowledgeContext numbers, so brackets stay contiguous.
    citations: hits.map((hit) => hit.citation),
    estimatedInputTokens: messages.reduce((total, message) => total + chatMessageTokens(message), 0),
    historyMessages: kept.length,
    historyTruncated: kept.length < candidates.length,
    knowledgeHitsDropped
  }
}

function knowledgeUserMessage(hits: RetrievalHit[], userContent: string): ChatMessage {
  return { role: 'user', content: knowledgeUserContent(renderKnowledgeContext(hits), userContent) }
}

function modelContextWindow(model: BaseModel | undefined): number {
  // Budget to the window of the model that actually serves the run, not to min(primary, fallback).
  // A fallback is the rare path; sizing every run to it amputated most of the conversation on the
  // primary — re-breaking the multi-turn bug this assembler exists to fix. If a smaller fallback
  // later takes over, that is the fallback swap's problem to re-trim, not a tax on every run.
  // NaN/Infinity/<=0 degrade to 0, which disables the budget rather than throwing.
  const window = model?.contextWindow
  return typeof window === 'number' && Number.isFinite(window) && window > 0 ? window : 0
}

function keepNewestWithinBudget(candidates: ChatMessage[], budget: number): ChatMessage[] {
  const kept: ChatMessage[] = []
  let total = 0
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const candidate = candidates[index]
    if (candidate === undefined) continue
    const tokens = chatMessageTokens(candidate)
    if (total + tokens > budget) break
    total += tokens
    kept.push(candidate)
  }
  return kept.reverse()
}
