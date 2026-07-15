import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  approveRagPolicyChangeRequest,
  compareRagReplay,
  createRagPolicyChangeRequest,
  getRagPolicy,
  getRagPolicyChangeRequest,
  getRagPosture,
  rejectRagPolicyChangeRequest,
  replayRag,
  updateRagPolicy
} from '../api/rag-admin-client'
import {
  ragPolicyChangeJustificationCodes,
  ragPolicyChangeRejectReasonCodes,
  ragPolicyExternalVectorModes,
  ragPolicyPhysicalVectorIsolationEnforcements,
  ragPolicyPhysicalVectorIsolationModes,
  ragPolicyTiers,
  ragVectorIsolationPolicies,
  type CreateRagPolicyChangeRequestInput,
  type KnowledgeRetrievalReplayComparisonReport,
  type KnowledgeRetrievalReplayReport,
  type RagPolicyChangeJustificationCode,
  type RagPolicyChangeRejectReasonCode,
  type RagPolicyChangeRequest,
  type RagPolicyExternalVectorMode,
  type RagPolicyPhysicalVectorIsolationEnforcement,
  type RagPolicyPhysicalVectorIsolationMode,
  type RagPolicyReport,
  type RagPolicyTier,
  type RagPostureReport,
  type RagReplayCaseInput,
  type RagVectorIsolationPolicy,
  type UpdateRagPolicyRequest
} from '../api/rag-admin-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { useConfirm } from './ConfirmDialog'
import { PanelStats } from './PanelStats'
import { Tabs } from './Tabs'

export function RagGovernancePanel() {
  return (
    <section className="rm-panel p-4">
      <Tabs
        tabs={[
          { id: 'policy', label: 'Policy', content: <PolicyTab /> },
          { id: 'posture', label: 'Posture', content: <PostureTab /> },
          { id: 'change-requests', label: 'Change requests', content: <ChangeRequestTab /> },
          { id: 'replay', label: 'Replay', content: <ReplayTab /> }
        ]}
      />
    </section>
  )
}

// ── Policy tab ────────────────────────────────────────────────────────────────

function PolicyTab() {
  const queryClient = useQueryClient()
  const policyQuery = useQuery({ queryKey: ['ragPolicy'], queryFn: getRagPolicy })

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">RAG retrieval policy</div>
        <button
          className="rm-button"
          disabled={policyQuery.isFetching}
          onClick={() => void policyQuery.refetch()}
          type="button"
        >
          {policyQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <PanelState query={policyQuery} empty="No RAG policy loaded." isEmpty={() => false}>
        {(report) => <PolicyEditor report={report} queryClient={queryClient} />}
      </PanelState>
    </div>
  )
}

/** Comma/whitespace list <-> string[] helpers. Server trims/normalizes. */
function textToList(text: string): string[] {
  return text
    .split(/[\n,]/u)
    .map((value) => value.trim())
    .filter((value) => value.length > 0)
}

function listToText(values: string[]): string {
  return values.join('\n')
}

function PolicyEditor(props: {
  report: RagPolicyReport
  queryClient: ReturnType<typeof useQueryClient>
}) {
  const { report, queryClient } = props
  const updateMutation = useMutation({ mutationFn: updateRagPolicy })

  const form = useForm({
    defaultValues: {
      enabledTiers: report.enabledTiers,
      dataResidencyTags: listToText(report.dataResidencyTags),
      externalVectorStoreMode: report.externalVectorStore.mode,
      namespacePolicy: report.externalVectorStore.namespacePolicy,
      partitioningPolicy: report.externalVectorStore.partitioningPolicy,
      physicalIsolationMode: report.physicalVectorIsolation.mode,
      physicalIsolationEnforcement: report.physicalVectorIsolation.enforcement
    },
    onSubmit: async ({ value }) => {
      if (value.enabledTiers.length === 0) {
        toast('Enable at least one retrieval tier.', 'error')
        return
      }
      const input: UpdateRagPolicyRequest = {
        enabledTiers: value.enabledTiers,
        dataResidencyTags: textToList(value.dataResidencyTags),
        externalVectorStore: {
          mode: value.externalVectorStoreMode,
          namespacePolicy: value.namespacePolicy,
          partitioningPolicy: value.partitioningPolicy
        },
        physicalVectorIsolation: {
          mode: value.physicalIsolationMode,
          enforcement: value.physicalIsolationEnforcement
        }
      }
      try {
        await updateMutation.mutateAsync(input)
        await queryClient.invalidateQueries({ queryKey: ['ragPolicy'] })
        await queryClient.invalidateQueries({ queryKey: ['ragPosture'] })
        toast('RAG policy updated', 'success')
      } catch (caught) {
        toast('Could not update RAG policy', 'error')
        throw caught
      }
    }
  })

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: 'Source', value: report.source },
          { label: 'Enabled tiers', value: report.enabledTiers.length },
          { label: 'Allowed embedding models', value: report.allowedEmbeddingProviderModels.length },
          { label: 'Data residency tags', value: report.dataResidencyTags.length },
          { label: 'External vector store', value: report.externalVectorStore.mode },
          { label: 'Physical isolation', value: report.physicalVectorIsolation.enforcement }
        ]}
      />

      <form
        className="grid gap-4"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <form.Field name="enabledTiers">
          {(field) => (
            <div className="grid gap-1">
              <div className="text-sm text-muted">Enabled retrieval tiers</div>
              <div className="flex flex-wrap gap-3">
                {ragPolicyTiers.map((tier) => {
                  const checked = field.state.value.includes(tier)
                  return (
                    <label className="flex items-center gap-2 text-sm" key={tier}>
                      <input
                        checked={checked}
                        onChange={(event) => {
                          const next: RagPolicyTier[] = event.currentTarget.checked
                            ? [...field.state.value, tier]
                            : field.state.value.filter((value) => value !== tier)
                          field.handleChange(next)
                        }}
                        type="checkbox"
                      />
                      <span>{tier}</span>
                    </label>
                  )
                })}
              </div>
              <div className="text-xs text-muted">At least one tier is required.</div>
            </div>
          )}
        </form.Field>

        <form.Field name="externalVectorStoreMode">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="rag-external-mode">
                External vector store mode
              </label>
              <select
                className="rm-input"
                id="rag-external-mode"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value as RagPolicyExternalVectorMode)
                }
                value={field.state.value}
              >
                {ragPolicyExternalVectorModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
          )}
        </form.Field>

        <form.Field name="namespacePolicy">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="rag-namespace-policy">
                Namespace policy
              </label>
              <select
                className="rm-input"
                id="rag-namespace-policy"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value as RagVectorIsolationPolicy)
                }
                value={field.state.value}
              >
                {ragVectorIsolationPolicies.map((policy) => (
                  <option key={policy} value={policy}>
                    {policy}
                  </option>
                ))}
              </select>
            </div>
          )}
        </form.Field>

        <form.Field name="partitioningPolicy">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="rag-partitioning-policy">
                Partitioning policy
              </label>
              <select
                className="rm-input"
                id="rag-partitioning-policy"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value as RagVectorIsolationPolicy)
                }
                value={field.state.value}
              >
                {ragVectorIsolationPolicies.map((policy) => (
                  <option key={policy} value={policy}>
                    {policy}
                  </option>
                ))}
              </select>
            </div>
          )}
        </form.Field>

        <form.Field name="physicalIsolationMode">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="rag-physical-mode">
                Physical vector isolation mode
              </label>
              <select
                className="rm-input"
                id="rag-physical-mode"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(event.currentTarget.value as RagPolicyPhysicalVectorIsolationMode)
                }
                value={field.state.value}
              >
                {ragPolicyPhysicalVectorIsolationModes.map((mode) => (
                  <option key={mode} value={mode}>
                    {mode}
                  </option>
                ))}
              </select>
            </div>
          )}
        </form.Field>

        <form.Field name="physicalIsolationEnforcement">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="rag-physical-enforcement">
                Physical isolation enforcement
              </label>
              <select
                className="rm-input"
                id="rag-physical-enforcement"
                onBlur={field.handleBlur}
                onChange={(event) =>
                  field.handleChange(
                    event.currentTarget.value as RagPolicyPhysicalVectorIsolationEnforcement
                  )
                }
                value={field.state.value}
              >
                {ragPolicyPhysicalVectorIsolationEnforcements.map((enforcement) => (
                  <option key={enforcement} value={enforcement}>
                    {enforcement}
                  </option>
                ))}
              </select>
            </div>
          )}
        </form.Field>

        <form.Field name="dataResidencyTags">
          {(field) => (
            <div className="grid gap-1">
              <label className="text-sm text-muted" htmlFor="rag-residency-tags">
                Data residency tags (one per line)
              </label>
              <textarea
                className="rm-input"
                id="rag-residency-tags"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder={'eu\nus-gov'}
                rows={3}
                value={field.state.value}
              />
              <div className="text-xs text-muted">Empty = no residency tags. Letters, digits, _.:- only.</div>
            </div>
          )}
        </form.Field>

        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <div className="flex items-center gap-2">
              <button className="rm-button primary" disabled={!canSubmit || isSubmitting} type="submit">
                {isSubmitting ? 'Saving' : 'Save policy'}
              </button>
              {report.updatedAt ? (
                <span className="text-xs text-muted">
                  Updated {new Date(report.updatedAt).toLocaleString()}
                  {report.updatedBy ? ` by ${report.updatedBy}` : ''}
                </span>
              ) : null}
            </div>
          )}
        </form.Subscribe>
      </form>
    </div>
  )
}

// ── Posture tab ───────────────────────────────────────────────────────────────

function PostureTab() {
  const postureQuery = useQuery({ queryKey: ['ragPosture'], queryFn: getRagPosture })

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">Retrieval posture</div>
        <button
          className="rm-button"
          disabled={postureQuery.isFetching}
          onClick={() => void postureQuery.refetch()}
          type="button"
        >
          {postureQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <PanelState query={postureQuery} empty="No posture report loaded." isEmpty={() => false}>
        {(report) => <PostureView report={report} />}
      </PanelState>
    </div>
  )
}

function PostureView(props: { report: RagPostureReport }) {
  const { report } = props
  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: 'Status', value: report.status },
          { label: 'Vector driver', value: report.vector.driver },
          { label: 'Isolation status', value: report.vector.physicalIsolation.status },
          { label: 'Fallback', value: report.fallback.degraded ? 'degraded' : 'nominal' },
          { label: 'Warnings', value: report.readiness.warnings.length }
        ]}
      />
      <PanelStats
        items={[
          { label: 'Workspaces', value: report.corpus.workspaceCount },
          { label: 'Knowledge bases', value: report.corpus.knowledgeBaseCount },
          { label: 'Sources', value: report.corpus.sourceCount },
          { label: 'Indexed sources', value: report.corpus.indexedSourceCount },
          { label: 'Pending sources', value: report.corpus.pendingSourceCount },
          { label: 'Failed sources', value: report.corpus.failedSourceCount }
        ]}
      />
      <PanelStats
        items={[
          { label: 'Chunks', value: report.corpus.chunkCount },
          { label: 'Embeddings', value: report.corpus.embeddingCount },
          { label: 'Embedded chunks', value: report.corpus.embeddedChunkCount },
          {
            label: 'Chunks missing embedding',
            value: report.corpus.chunksMissingProviderEmbeddingCount
          },
          { label: 'Stale embeddings', value: report.corpus.staleEmbeddingRecordCount },
          { label: 'Stale sources', value: report.corpus.staleSourceCount }
        ]}
      />
      <PanelStats
        items={[
          { label: 'Failed embed jobs', value: report.jobs.failedEmbeddingIndexJobCount },
          { label: 'Failed extract jobs', value: report.jobs.failedExtractionJobCount },
          { label: 'Failed reindex jobs', value: report.jobs.failedReindexJobCount },
          { label: 'Queued jobs', value: report.jobs.queuedKnowledgeJobCount },
          { label: 'Running jobs', value: report.jobs.runningKnowledgeJobCount }
        ]}
      />
      {report.readiness.warnings.length > 0 ? (
        <div className="grid gap-1">
          <div className="text-sm text-muted">Warnings</div>
          <ul className="grid gap-1">
            {report.readiness.warnings.map((warning) => (
              <li className="text-sm" key={warning.code}>
                <span className="rm-mono">{warning.code}</span>{' '}
                <span className="rm-cell-muted">
                  ({warning.severity}, {warning.count})
                </span>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <div className="text-xs text-muted">Generated {new Date(report.generatedAt).toLocaleString()}</div>
    </div>
  )
}

// ── Change requests tab ───────────────────────────────────────────────────────

function ChangeRequestTab() {
  const queryClient = useQueryClient()
  const changeRequestQuery = useQuery({
    queryKey: ['ragPolicyChangeRequest'],
    queryFn: getRagPolicyChangeRequest
  })
  const { ask, dialog } = useConfirm()

  const approveMutation = useMutation({
    mutationFn: (requestId: string) =>
      approveRagPolicyChangeRequest(requestId, { confirmRequestId: requestId })
  })
  const rejectMutation = useMutation({
    mutationFn: (input: { requestId: string; reasonCode: RagPolicyChangeRejectReasonCode }) =>
      rejectRagPolicyChangeRequest(input.requestId, {
        confirmRequestId: input.requestId,
        reasonCode: input.reasonCode
      })
  })

  async function handleApprove(request: RagPolicyChangeRequest) {
    const confirmed = await ask({
      title: 'Approve change request?',
      body: `Apply the proposed RAG policy for request ${request.requestId}.`,
      confirmLabel: 'Approve'
    })
    if (!confirmed) return
    try {
      await approveMutation.mutateAsync(request.requestId)
      await queryClient.invalidateQueries({ queryKey: ['ragPolicyChangeRequest'] })
      await queryClient.invalidateQueries({ queryKey: ['ragPolicy'] })
      await queryClient.invalidateQueries({ queryKey: ['ragPosture'] })
      toast('Change request approved', 'success')
    } catch (caught) {
      toast('Could not approve change request', 'error')
      throw caught
    }
  }

  async function handleReject(request: RagPolicyChangeRequest, reasonCode: RagPolicyChangeRejectReasonCode) {
    const confirmed = await ask({
      title: 'Reject change request?',
      body: `Reject request ${request.requestId} (${reasonCode}).`,
      confirmLabel: 'Reject',
      tone: 'danger'
    })
    if (!confirmed) return
    try {
      await rejectMutation.mutateAsync({ requestId: request.requestId, reasonCode })
      await queryClient.invalidateQueries({ queryKey: ['ragPolicyChangeRequest'] })
      toast('Change request rejected', 'success')
    } catch (caught) {
      toast('Could not reject change request', 'error')
      throw caught
    }
  }

  return (
    <div className="grid gap-2">
      <div className="rm-card-header">
        <div className="rm-card-title">Policy change requests</div>
        <button
          className="rm-button"
          disabled={changeRequestQuery.isFetching}
          onClick={() => void changeRequestQuery.refetch()}
          type="button"
        >
          {changeRequestQuery.isFetching ? 'Refreshing' : 'Refresh'}
        </button>
      </div>
      <PanelState
        query={changeRequestQuery}
        empty="No change request on record."
        isEmpty={(request) => request === null}
      >
        {(request) =>
          request === null ? (
            <div className="rm-empty">No change request on record.</div>
          ) : (
            <ChangeRequestView
              request={request}
              busy={approveMutation.isPending || rejectMutation.isPending}
              onApprove={() => void handleApprove(request)}
              onReject={(reasonCode) => void handleReject(request, reasonCode)}
            />
          )
        }
      </PanelState>
      {dialog}
    </div>
  )
}

function ChangeRequestView(props: {
  request: RagPolicyChangeRequest
  busy: boolean
  onApprove: () => void
  onReject: (reasonCode: RagPolicyChangeRejectReasonCode) => void
}) {
  const { request, busy, onApprove, onReject } = props
  const [reasonCode, setReasonCode] = useState<RagPolicyChangeRejectReasonCode>(
    ragPolicyChangeRejectReasonCodes[0]
  )
  const pending = request.status === 'pending'

  return (
    <div className="grid gap-4">
      <PanelStats
        items={[
          { label: 'Status', value: request.status },
          { label: 'Changed fields', value: request.changedFields.length },
          {
            label: 'Justification',
            value: request.justificationCode ?? '—'
          },
          {
            label: 'Replay cases',
            value: request.evidenceSummary?.replayCaseCount ?? '—'
          }
        ]}
      />
      <div className="grid gap-1 text-sm">
        <div>
          <span className="text-muted">Request </span>
          <span className="rm-mono">{request.requestId}</span>
        </div>
        <div className="rm-cell-muted">
          Requested by {request.requestedBy} at {new Date(request.requestedAt).toLocaleString()}
        </div>
        {request.reviewedBy ? (
          <div className="rm-cell-muted">
            Reviewed by {request.reviewedBy}
            {request.reviewedAt ? ` at ${new Date(request.reviewedAt).toLocaleString()}` : ''}
            {request.rejectReasonCode ? ` — ${request.rejectReasonCode}` : ''}
          </div>
        ) : null}
        {request.changedFields.length > 0 ? (
          <div className="rm-cell-muted">Changed: {request.changedFields.join(', ')}</div>
        ) : null}
      </div>

      {pending ? (
        <div className="flex flex-wrap items-center gap-2">
          <button className="rm-button primary" disabled={busy} onClick={onApprove} type="button">
            {busy ? 'Working' : 'Approve'}
          </button>
          <select
            aria-label="Reject reason"
            className="rm-input"
            onChange={(event) => setReasonCode(event.currentTarget.value as RagPolicyChangeRejectReasonCode)}
            value={reasonCode}
          >
            {ragPolicyChangeRejectReasonCodes.map((code) => (
              <option key={code} value={code}>
                {code}
              </option>
            ))}
          </select>
          <button
            className="rm-button danger"
            disabled={busy}
            onClick={() => onReject(reasonCode)}
            type="button"
          >
            Reject
          </button>
        </div>
      ) : (
        <div className="text-xs text-muted">This request has been {request.status}.</div>
      )}
    </div>
  )
}

// ── Replay tab ────────────────────────────────────────────────────────────────

function ReplayTab() {
  const [knowledgeBaseIds, setKnowledgeBaseIds] = useState('')
  const [query, setQuery] = useState('')
  const [expectedChunkIds, setExpectedChunkIds] = useState('')
  const [candidateKnowledgeBaseIds, setCandidateKnowledgeBaseIds] = useState('')
  const [candidateQuery, setCandidateQuery] = useState('')
  const [compareEnabled, setCompareEnabled] = useState(false)

  const [report, setReport] = useState<KnowledgeRetrievalReplayReport | null>(null)
  const [comparison, setComparison] = useState<KnowledgeRetrievalReplayComparisonReport | null>(null)

  const replayMutation = useMutation({ mutationFn: replayRag })
  const compareMutation = useMutation({ mutationFn: compareRagReplay })

  function buildCase(rawKbIds: string, rawQuery: string, rawExpected: string): RagReplayCaseInput | null {
    const knowledgeBaseIdList = textToList(rawKbIds)
    const trimmedQuery = rawQuery.trim()
    if (knowledgeBaseIdList.length === 0) {
      toast('At least one knowledge base id is required.', 'error')
      return null
    }
    if (trimmedQuery.length === 0) {
      toast('A replay query is required.', 'error')
      return null
    }
    const expected = textToList(rawExpected)
    return {
      knowledgeBaseIds: knowledgeBaseIdList,
      query: trimmedQuery,
      ...(expected.length > 0 ? { expectedChunkIds: expected } : {})
    }
  }

  async function handleReplay() {
    const baselineCase = buildCase(knowledgeBaseIds, query, expectedChunkIds)
    if (baselineCase === null) return
    setComparison(null)
    try {
      const result = await replayMutation.mutateAsync({ cases: [baselineCase] })
      setReport(result)
      toast('Replay complete', 'success')
    } catch (caught) {
      toast('Could not run replay', 'error')
      throw caught
    }
  }

  async function handleCompare() {
    const baselineCase = buildCase(knowledgeBaseIds, query, expectedChunkIds)
    if (baselineCase === null) return
    const candidateCase = buildCase(candidateKnowledgeBaseIds, candidateQuery, '')
    if (candidateCase === null) return
    try {
      const result = await compareMutation.mutateAsync({
        baseline: [baselineCase],
        candidate: [candidateCase]
      })
      setComparison(result)
      setReport(result.candidate)
      toast('Comparison complete', 'success')
    } catch (caught) {
      toast('Could not run comparison', 'error')
      throw caught
    }
  }

  const busy = replayMutation.isPending || compareMutation.isPending

  return (
    <div className="grid gap-4">
      <div className="rm-card-header">
        <div className="rm-card-title">Retrieval replay</div>
      </div>

      <div className="grid gap-2">
        <label className="text-sm text-muted" htmlFor="rag-replay-kb-ids">
          Knowledge base ids (comma or newline separated)
        </label>
        <textarea
          className="rm-input"
          id="rag-replay-kb-ids"
          onChange={(event) => setKnowledgeBaseIds(event.currentTarget.value)}
          placeholder={'kb_finance\nkb_hr'}
          rows={2}
          value={knowledgeBaseIds}
        />
        <label className="text-sm text-muted" htmlFor="rag-replay-query">
          Query
        </label>
        <input
          className="rm-input"
          id="rag-replay-query"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="What is our refund policy?"
          value={query}
        />
        <label className="text-sm text-muted" htmlFor="rag-replay-expected">
          Expected chunk ids (optional, comma or newline separated)
        </label>
        <textarea
          className="rm-input"
          id="rag-replay-expected"
          onChange={(event) => setExpectedChunkIds(event.currentTarget.value)}
          placeholder={'chunk_1\nchunk_2'}
          rows={2}
          value={expectedChunkIds}
        />
      </div>

      <label className="flex items-center gap-2 text-sm">
        <input
          checked={compareEnabled}
          onChange={(event) => setCompareEnabled(event.currentTarget.checked)}
          type="checkbox"
        />
        <span>Compare against a candidate case</span>
      </label>

      {compareEnabled ? (
        <div className="grid gap-2">
          <label className="text-sm text-muted" htmlFor="rag-replay-candidate-kb-ids">
            Candidate knowledge base ids
          </label>
          <textarea
            className="rm-input"
            id="rag-replay-candidate-kb-ids"
            onChange={(event) => setCandidateKnowledgeBaseIds(event.currentTarget.value)}
            placeholder={'kb_finance_v2'}
            rows={2}
            value={candidateKnowledgeBaseIds}
          />
          <label className="text-sm text-muted" htmlFor="rag-replay-candidate-query">
            Candidate query
          </label>
          <input
            className="rm-input"
            id="rag-replay-candidate-query"
            onChange={(event) => setCandidateQuery(event.currentTarget.value)}
            placeholder="What is our refund policy?"
            value={candidateQuery}
          />
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {compareEnabled ? (
          <button className="rm-button primary" disabled={busy} onClick={() => void handleCompare()} type="button">
            {busy ? 'Running' : 'Run comparison'}
          </button>
        ) : (
          <button className="rm-button primary" disabled={busy} onClick={() => void handleReplay()} type="button">
            {busy ? 'Running' : 'Run replay'}
          </button>
        )}
      </div>

      {comparison !== null ? (
        <div className="grid gap-2">
          <div className="rm-card-title">Comparison</div>
          <PanelStats
            items={[
              { label: 'Outcome', value: comparison.outcome },
              { label: 'Δ precision', value: formatMetric(comparison.deltas.averagePrecision) },
              { label: 'Δ recall', value: formatMetric(comparison.deltas.averageRecall) },
              { label: 'Δ latency (ms)', value: comparison.deltas.averageLatencyMs },
              { label: 'Δ hits', value: comparison.deltas.hitCount }
            ]}
          />
        </div>
      ) : null}

      {report !== null ? <ReplayReportView report={report} /> : null}
    </div>
  )
}

function formatMetric(value: number | null): string {
  return value === null ? '—' : value.toFixed(3)
}

function ReplayReportView(props: { report: KnowledgeRetrievalReplayReport }) {
  const { report } = props
  return (
    <div className="grid gap-2">
      <div className="rm-card-title">Replay report</div>
      <PanelStats
        items={[
          { label: 'Status', value: report.status },
          { label: 'Cases', value: report.caseCount },
          { label: 'Avg precision', value: formatMetric(report.metrics.averagePrecision) },
          { label: 'Avg recall', value: formatMetric(report.metrics.averageRecall) },
          { label: 'Avg latency (ms)', value: report.metrics.averageLatencyMs },
          { label: 'Hits', value: report.metrics.hitCount }
        ]}
      />
      <div className="grid gap-1">
        {report.cases.map((replayCase, index) => (
          <div className="text-sm" key={replayCase.caseId ?? index}>
            <span className="rm-mono">{replayCase.caseId ?? `case ${index + 1}`}</span>{' '}
            <span className="rm-cell-muted">
              {replayCase.status} · hits {replayCase.hitCount} · precision{' '}
              {formatMetric(replayCase.precision)} · recall {formatMetric(replayCase.recall)} · {replayCase.latencyMs}ms
            </span>
          </div>
        ))}
      </div>
      <div className="text-xs text-muted">Generated {new Date(report.generatedAt).toLocaleString()}</div>
    </div>
  )
}
