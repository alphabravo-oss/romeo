import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import { createEvalSuite, getEvalDashboard, listEvalRatings, listEvalResults, listEvalRuns, listEvalSuites, rateEvalResult, runEvalSuite } from '../api/client'
import { toast } from '../lib/toast'
import type { Agent, BaseModel, EvalResultHumanRatingValue } from '../api/types'
import { PanelState } from '../lib/panel-state'
import { PanelStats } from './PanelStats'
import { EvalDashboardSummary } from './EvalDashboardSummary'
import { EvalModelComparisonPanel } from './EvalModelComparisonPanel'
import { FormDialog } from './FormDialog'

export function EvalPanel({ activeAgent, models }: { activeAgent: Agent | undefined; models: BaseModel[] }) {
  const queryClient = useQueryClient()
  const agentId = activeAgent?.id
  const [ratingComment, setRatingComment] = useState('')
  const [suiteDialogOpen, setSuiteDialogOpen] = useState(false)
  const suitesQuery = useQuery({ queryKey: ['evalSuites', agentId], queryFn: () => listEvalSuites(agentId!), enabled: agentId !== undefined })
  const runsQuery = useQuery({ queryKey: ['evalRuns', agentId], queryFn: () => listEvalRuns(agentId!), enabled: agentId !== undefined })
  const dashboardQuery = useQuery({ queryKey: ['evalDashboard', agentId], queryFn: () => getEvalDashboard(agentId!), enabled: agentId !== undefined })
  const activeRun = useMemo(() => runsQuery.data?.[0], [runsQuery.data])
  const resultsQuery = useQuery({ queryKey: ['evalResults', activeRun?.id], queryFn: () => listEvalResults(activeRun!.id), enabled: activeRun !== undefined })
  const ratingsQuery = useQuery({ queryKey: ['evalRatings', activeRun?.id], queryFn: () => listEvalRatings(activeRun!.id), enabled: activeRun !== undefined })
  const createMutation = useMutation({ mutationFn: createEvalSuite })
  const runMutation = useMutation({ mutationFn: runEvalSuite })
  const rateMutation = useMutation({ mutationFn: rateEvalResult })
  const suites = suitesQuery.data ?? []
  const activeSuite = useMemo(() => suites[0], [suites])
  const activeResult = resultsQuery.data?.[0]
  const activeRating = ratingsQuery.data?.find((rating) => rating.resultId === activeResult?.id)

  const form = useForm({
    defaultValues: {
      name: '',
      input: '',
      expectedContains: '',
      mustContain: '',
      mustNotContain: '',
      expectedTools: '',
      requiredCitations: ''
    },
    onSubmit: async ({ value }) => {
      if (!agentId) return
      const rubric = rubricFromInput(value.mustContain, value.mustNotContain, value.expectedTools, value.requiredCitations)
      try {
        await createMutation.mutateAsync({
          agentId,
          name: value.name,
          cases: [{ input: value.input, expectedContains: value.expectedContains, ...(rubric === undefined ? {} : { rubric }) }]
        })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['evalSuites', agentId] }),
          queryClient.invalidateQueries({ queryKey: ['evalDashboard', agentId] })
        ])
        toast('Suite created', 'success')
        setSuiteDialogOpen(false)
      } catch {
        toast('Could not create suite', 'error')
      }
    }
  })

  async function handleRun() {
    if (!activeSuite || !agentId) return
    try {
      await runMutation.mutateAsync(activeSuite.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['evalRuns', agentId] }),
        queryClient.invalidateQueries({ queryKey: ['evalDashboard', agentId] })
      ])
      toast('Eval run started', 'success')
    } catch {
      toast('Could not run suite', 'error')
    }
  }

  async function handleRate(rating: EvalResultHumanRatingValue) {
    if (!activeResult || !activeRun) return
    try {
      await rateMutation.mutateAsync({
        resultId: activeResult.id,
        rating,
        ...(ratingComment.trim().length === 0 ? {} : { comment: ratingComment.trim() })
      })
      await queryClient.invalidateQueries({ queryKey: ['evalRatings', activeRun.id] })
      toast('Rating saved', 'success')
    } catch {
      toast('Could not save rating', 'error')
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="text-sm text-muted">Evals</div>
        <div className="flex gap-2">
          <button className="rm-button primary" onClick={() => setSuiteDialogOpen(true)} type="button">
            + New suite
          </button>
          <button className="rm-button" disabled={!activeSuite || runMutation.isPending} onClick={() => void handleRun()} type="button">
            {runMutation.isPending ? 'Running' : 'Run suite'}
          </button>
        </div>
      </div>
      <FormDialog onClose={() => setSuiteDialogOpen(false)} open={suiteDialogOpen} title="New eval suite">
        <form
          className="grid gap-2 text-sm"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void form.handleSubmit()
          }}
        >
          <form.Field name="name" validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Required' : undefined) }}>
            {(field) => (
              <>
                <input
                  className="rm-input"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  placeholder="suite name"
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div> : null}
              </>
            )}
          </form.Field>
          <form.Field name="input">
            {(field) => (
              <textarea
                className="rm-input min-h-20 resize-y"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="prompt"
                value={field.state.value}
              />
            )}
          </form.Field>
          <form.Field name="expectedContains">
            {(field) => (
              <input
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="expected text"
                value={field.state.value}
              />
            )}
          </form.Field>
          <form.Field name="mustContain">
            {(field) => (
              <input
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="rubric must contain, comma separated"
                value={field.state.value}
              />
            )}
          </form.Field>
          <form.Field name="mustNotContain">
            {(field) => (
              <input
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="rubric must not contain, comma separated"
                value={field.state.value}
              />
            )}
          </form.Field>
          <form.Field name="expectedTools">
            {(field) => (
              <input
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="expected tools, comma separated"
                value={field.state.value}
              />
            )}
          </form.Field>
          <form.Field name="requiredCitations">
            {(field) => (
              <input
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="required citations, comma separated"
                value={field.state.value}
              />
            )}
          </form.Field>
          <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
            {({ canSubmit, isSubmitting }) => (
              <button className="rm-button" disabled={!agentId || !canSubmit || isSubmitting || createMutation.isPending} type="submit">
                {createMutation.isPending ? 'Creating' : 'Create suite'}
              </button>
            )}
          </form.Subscribe>
        </form>
      </FormDialog>
      <div className="mt-4 grid gap-2 text-sm">
        <EvalDashboardSummary dashboard={dashboardQuery.data} />
        <EvalModelComparisonPanel activeAgent={activeAgent} activeSuite={activeSuite} models={models} />
        <PanelState
          query={suitesQuery}
          empty="No eval suites yet."
          emptyAction={
            <button className="rm-button primary" onClick={() => setSuiteDialogOpen(true)} type="button">
              + New suite
            </button>
          }
        >
          {(allSuites) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: 'Total suites', value: allSuites.length },
                  { label: 'Runs', value: runsQuery.data?.length ?? 0 },
                ]}
              />
              <div className="grid gap-2">
                {allSuites.slice(0, 3).map((suite) => (
                  <div className="rounded-md border border-border p-2" key={suite.id}>
                    <div className="font-medium">{suite.name}</div>
                    <div className="break-words text-muted">{suite.id}</div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </PanelState>
        <PanelState query={runsQuery} empty="No eval runs yet.">
          {(allRuns) =>
            allRuns.slice(0, 3).map((run) => (
              <div className="rounded-md border border-border p-2" key={run.id}>
                <div className="font-medium">
                  {run.status} - {Math.round(run.score * 100)}%
                </div>
                <div className="break-words text-muted">{run.modelId}</div>
              </div>
            ))}
        </PanelState>
        {activeResult ? (
          <div className="rounded-md border border-border p-2">
            <div className="font-medium">Human rating {activeRating?.rating ?? 'none'}</div>
            <div className="line-clamp-2 break-words text-muted">{activeResult.output}</div>
            <input
              aria-label="rating comment"
              className="rm-input mt-2"
              onChange={(event) => setRatingComment(event.currentTarget.value)}
              placeholder="rating comment"
              value={ratingComment}
            />
            <div className="mt-2 grid grid-cols-3 gap-2">
              {(['pass', 'neutral', 'fail'] as const).map((rating) => (
                <button className="rm-button" disabled={rateMutation.isPending} key={rating} onClick={() => void handleRate(rating)} type="button">
                  {rating}
                </button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
    </section>
  )
}

function rubricFromInput(mustContain: string, mustNotContain: string, expectedTools: string, requiredCitations: string) {
  const contain = terms(mustContain)
  const notContain = terms(mustNotContain)
  const tools = terms(expectedTools)
  const citations = terms(requiredCitations)
  if (contain.length === 0 && notContain.length === 0 && tools.length === 0 && citations.length === 0) return undefined
  return {
    ...(contain.length > 0 ? { mustContain: contain } : {}),
    ...(notContain.length > 0 ? { mustNotContain: notContain } : {}),
    ...(tools.length > 0 ? { expectedToolCalls: tools.map((name) => ({ name })) } : {}),
    ...(citations.length > 0 ? { requiredCitations: citations } : {})
  }
}

function terms(value: string): string[] {
  return value
    .split(',')
    .map((term) => term.trim())
    .filter((term) => term.length > 0)
}
