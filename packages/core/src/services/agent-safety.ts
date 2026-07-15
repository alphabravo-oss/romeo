import type { AgentSafetySettings } from '../domain/entities'
import { ApiError } from '../errors'

const maxConfiguredInputLength = 200_000
const maxBlockedTerms = 100
const maxBlockedTermLength = 120
const maxPromptInjectionScanLength = 50_000

export type AgentSafetySource = 'retrieved_context' | 'user_input'

export type PromptInjectionCategory =
  | 'credential_exfiltration'
  | 'instruction_override'
  | 'system_prompt_exfiltration'
  | 'tool_or_policy_bypass'

export interface PromptInjectionInspection {
  categories: PromptInjectionCategory[]
  matched: boolean
}

const promptInjectionDetectors: Array<{ category: PromptInjectionCategory; pattern: RegExp }> = [
  {
    category: 'instruction_override',
    pattern: /\b(ignore|disregard|forget|override|bypass)\b[\s\S]{0,120}\b(previous|prior|above|earlier|system|developer)\b[\s\S]{0,80}\b(instruction|prompt|message|rule)s?\b/i
  },
  {
    category: 'system_prompt_exfiltration',
    pattern: /\b(reveal|show|print|dump|expose|return)\b[\s\S]{0,120}\b(system prompt|developer message|hidden instruction|internal prompt|policy)\b/i
  },
  {
    category: 'credential_exfiltration',
    pattern: /\b(send|exfiltrate|leak|steal|extract|dump)\b[\s\S]{0,120}\b(api key|token|credential|secret|password|private key)s?\b/i
  },
  {
    category: 'tool_or_policy_bypass',
    pattern: /\b(bypass|skip|disable|ignore)\b[\s\S]{0,120}\b(tool approval|approval|permission|authorization|safety|guardrail)s?\b/i
  }
]

export function normalizeAgentSafetySettings(input: AgentSafetySettings | undefined): AgentSafetySettings {
  const settings: AgentSafetySettings = {}

  if (input?.maxUserInputLength !== undefined) {
    if (!Number.isInteger(input.maxUserInputLength) || input.maxUserInputLength < 1 || input.maxUserInputLength > maxConfiguredInputLength) {
      throw new ApiError('invalid_agent_safety_settings', `Max user input length must be between 1 and ${maxConfiguredInputLength}.`, 400)
    }
    settings.maxUserInputLength = input.maxUserInputLength
  }

  const blockedTerms = normalizeBlockedTerms(input?.blockedTerms)
  if (blockedTerms.length > 0) settings.blockedTerms = blockedTerms

  const promptInjectionGuard = normalizePromptInjectionGuard(input?.promptInjectionGuard)
  if (promptInjectionGuard !== undefined) settings.promptInjectionGuard = promptInjectionGuard

  return settings
}

export function enforceAgentSafetySettings(
  settings: AgentSafetySettings,
  content: string,
  options: { source?: AgentSafetySource } = {}
): void {
  if (settings.maxUserInputLength !== undefined && content.length > settings.maxUserInputLength) {
    throw new ApiError('agent_safety_input_too_long', 'User input exceeds this agent safety limit.', 400, {
      actualLength: content.length,
      maxUserInputLength: settings.maxUserInputLength
    })
  }

  const blockedTerms = settings.blockedTerms ?? []
  const normalizedContent = content.toLocaleLowerCase()
  if (blockedTerms.length > 0 && blockedTerms.some((term) => normalizedContent.includes(term))) {
    throw new ApiError('agent_safety_blocked_term', 'User input violates this agent safety policy.', 400, {
      policy: 'blocked_terms'
    })
  }

  const source = options.source ?? 'user_input'
  if (!shouldScanPromptInjection(settings, source)) return
  const inspection = inspectPromptInjection(content)
  if (!inspection.matched) return
  throw new ApiError('agent_safety_prompt_injection_detected', 'User input violates this agent prompt-injection policy.', 400, {
    categories: inspection.categories,
    policy: 'prompt_injection_guard',
    source
  })
}

export function shouldScanPromptInjection(settings: AgentSafetySettings, source: AgentSafetySource): boolean {
  const guard = settings.promptInjectionGuard
  if (guard === undefined || guard.mode !== 'block') return false
  return source === 'retrieved_context' ? guard.scanRetrievedContext : guard.scanUserInput
}

export function inspectPromptInjection(content: string): PromptInjectionInspection {
  const normalized = content.slice(0, maxPromptInjectionScanLength).replace(/\s+/g, ' ')
  const categories = promptInjectionDetectors
    .filter((detector) => detector.pattern.test(normalized))
    .map((detector) => detector.category)
  const uniqueCategories = [...new Set(categories)].sort()
  return { categories: uniqueCategories, matched: uniqueCategories.length > 0 }
}

function normalizeBlockedTerms(terms: string[] | undefined): string[] {
  if (terms === undefined || terms.length === 0) return []
  if (terms.length > maxBlockedTerms) {
    throw new ApiError('invalid_agent_safety_settings', `Blocked terms supports at most ${maxBlockedTerms} entries.`, 400)
  }

  const normalized = terms.map((term) => term.trim().toLocaleLowerCase()).filter((term) => term.length > 0)
  if (normalized.some((term) => term.length > maxBlockedTermLength)) {
    throw new ApiError('invalid_agent_safety_settings', `Blocked terms must be ${maxBlockedTermLength} characters or fewer.`, 400)
  }

  return [...new Set(normalized)].sort()
}

function normalizePromptInjectionGuard(input: AgentSafetySettings['promptInjectionGuard'] | undefined): AgentSafetySettings['promptInjectionGuard'] | undefined {
  if (input === undefined) return undefined
  if (input.mode !== 'block') return undefined
  const scanUserInput = input.scanUserInput ?? true
  const scanRetrievedContext = input.scanRetrievedContext ?? true
  if (scanUserInput !== true && scanRetrievedContext !== true) {
    throw new ApiError('invalid_agent_safety_settings', 'Prompt injection guard must scan user input or retrieved context.', 400)
  }
  return { mode: 'block', scanUserInput, scanRetrievedContext }
}
