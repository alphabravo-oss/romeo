import { apiJson } from './http'
import type {
  CreatedEvalSuite,
  Envelope,
  EvalDashboard,
  EvalModelComparison,
  EvalResultHumanRating,
  EvalResultHumanRatingValue,
  EvalRubric,
  EvalRun,
  EvalRunResult,
  EvalRunWithResults,
  EvalSuite
} from './types'

export async function listEvalSuites(agentId: string): Promise<EvalSuite[]> {
  const response = await apiJson<Envelope<EvalSuite[]>>(`/api/v1/agents/${encodeURIComponent(agentId)}/eval-suites`)
  return response.data
}

export async function createEvalSuite(input: {
  agentId: string
  name: string
  cases: Array<{ input: string; expectedContains?: string; requiresCitation?: boolean; rubric?: EvalRubric }>
}): Promise<CreatedEvalSuite> {
  const response = await apiJson<Envelope<CreatedEvalSuite>>('/api/v1/eval-suites', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function listEvalRuns(agentId: string): Promise<EvalRun[]> {
  const response = await apiJson<Envelope<EvalRun[]>>(`/api/v1/agents/${encodeURIComponent(agentId)}/eval-runs`)
  return response.data
}

export async function getEvalDashboard(agentId: string): Promise<EvalDashboard> {
  const response = await apiJson<Envelope<EvalDashboard>>(`/api/v1/agents/${encodeURIComponent(agentId)}/eval-dashboard`)
  return response.data
}

export async function runEvalSuite(suiteId: string): Promise<EvalRunWithResults> {
  const response = await apiJson<Envelope<EvalRunWithResults>>(`/api/v1/eval-suites/${encodeURIComponent(suiteId)}/runs`, {
    method: 'POST',
    body: JSON.stringify({})
  })
  return response.data
}

export async function compareEvalModels(input: { suiteId: string; modelIds: string[] }): Promise<EvalModelComparison> {
  const response = await apiJson<Envelope<EvalModelComparison>>(`/api/v1/eval-suites/${encodeURIComponent(input.suiteId)}/model-comparisons`, {
    method: 'POST',
    body: JSON.stringify({ modelIds: input.modelIds })
  })
  return response.data
}

export async function listEvalResults(runId: string): Promise<EvalRunResult[]> {
  const response = await apiJson<Envelope<EvalRunResult[]>>(`/api/v1/eval-runs/${encodeURIComponent(runId)}/results`)
  return response.data
}

export async function listEvalRatings(runId: string): Promise<EvalResultHumanRating[]> {
  const response = await apiJson<Envelope<EvalResultHumanRating[]>>(`/api/v1/eval-runs/${encodeURIComponent(runId)}/ratings`)
  return response.data
}

export async function rateEvalResult(input: { resultId: string; rating: EvalResultHumanRatingValue; comment?: string }): Promise<EvalResultHumanRating> {
  const response = await apiJson<Envelope<EvalResultHumanRating>>(`/api/v1/eval-run-results/${encodeURIComponent(input.resultId)}/rating`, {
    method: 'POST',
    body: JSON.stringify({ rating: input.rating, ...(input.comment === undefined ? {} : { comment: input.comment }) })
  })
  return response.data
}
