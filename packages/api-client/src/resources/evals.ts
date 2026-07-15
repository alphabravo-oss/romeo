import { pathId } from '../path'
import type { RomeoTransport } from '../transport'
import type {
  CompareEvalModelsInput,
  CreatedEvalSuite,
  CreateEvalSuiteInput,
  EvalDashboard,
  EvalModelComparison,
  EvalReleaseCandidateEvidence,
  EvalResultHumanRating,
  EvalRun,
  EvalRunResult,
  EvalRunWithResults,
  EvalSuite,
  RateEvalResultInput,
  RunEvalSuiteInput
} from '../types'

export function createEvalResource(transport: RomeoTransport) {
  return {
    suites: (agentId: string) => transport.data<EvalSuite[]>('GET', `/api/v1/agents/${pathId(agentId)}/eval-suites`),
    createSuite: (input: CreateEvalSuiteInput) => transport.data<CreatedEvalSuite>('POST', '/api/v1/eval-suites', input),
    runs: (agentId: string) => transport.data<EvalRun[]>('GET', `/api/v1/agents/${pathId(agentId)}/eval-runs`),
    dashboard: (agentId: string) => transport.data<EvalDashboard>('GET', `/api/v1/agents/${pathId(agentId)}/eval-dashboard`),
    releaseCandidateEvidence: (agentId: string) =>
      transport.data<EvalReleaseCandidateEvidence>('GET', `/api/v1/agents/${pathId(agentId)}/eval-release-candidate-evidence`),
    runSuite: (suiteId: string, input: RunEvalSuiteInput = {}) =>
      transport.data<EvalRunWithResults>('POST', `/api/v1/eval-suites/${pathId(suiteId)}/runs`, input),
    compareModels: (suiteId: string, input: CompareEvalModelsInput) =>
      transport.data<EvalModelComparison>('POST', `/api/v1/eval-suites/${pathId(suiteId)}/model-comparisons`, input),
    results: (runId: string) => transport.data<EvalRunResult[]>('GET', `/api/v1/eval-runs/${pathId(runId)}/results`),
    ratings: (runId: string) => transport.data<EvalResultHumanRating[]>('GET', `/api/v1/eval-runs/${pathId(runId)}/ratings`),
    rateResult: (resultId: string, input: RateEvalResultInput) =>
      transport.data<EvalResultHumanRating>('POST', `/api/v1/eval-run-results/${pathId(resultId)}/rating`, input)
  }
}
