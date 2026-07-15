import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useRef, useState } from 'react'

import {
  approveWorkflowRun,
  createWorkflow,
  createWorkflowFromTemplate,
  listWorkflowRuns,
  listWorkflowTemplates,
  listWorkflows,
  resumeWorkflowRun,
  startWorkflowRun
} from '../api/workflows-client'
import type { Workflow, WorkflowRun, WorkflowScheduleInput, WorkflowTemplate } from '../api/workflows-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { FormDialog } from './FormDialog'
import { PanelStats } from './PanelStats'
import { WorkflowStepBuilder } from './WorkflowStepBuilder'
import { type StepDraft, buildWorkflowSteps, newStepDraft } from './workflow-step-builder'
import { useWorkspace } from './WorkspaceContext'

const workflowCol = createColumnHelper<Workflow>()
const templateCol = createColumnHelper<WorkflowTemplate>()
const runCol = createColumnHelper<WorkflowRun>()

export function WorkflowsPanel() {
  const queryClient = useQueryClient()
  const { workspaceId } = useWorkspace()
  const [addOpen, setAddOpen] = useState(false)
  const [newOpen, setNewOpen] = useState(false)
  const [selectedWorkflowId, setSelectedWorkflowId] = useState<string | undefined>(undefined)

  const workflowsQuery = useQuery({ queryKey: ['workflows', workspaceId], queryFn: () => listWorkflows(workspaceId), enabled: workspaceId !== undefined })
  const templatesQuery = useQuery({ queryKey: ['workflowTemplates', workspaceId], queryFn: listWorkflowTemplates })
  const runsQuery = useQuery({
    queryKey: ['workflowRuns', selectedWorkflowId],
    queryFn: () => listWorkflowRuns(selectedWorkflowId!),
    enabled: selectedWorkflowId !== undefined
  })

  const createMutation = useMutation({ mutationFn: createWorkflowFromTemplate })
  const createWorkflowMutation = useMutation({ mutationFn: createWorkflow })
  const startRunMutation = useMutation({ mutationFn: startWorkflowRun })
  const approveMutation = useMutation({ mutationFn: approveWorkflowRun })
  const resumeMutation = useMutation({ mutationFn: resumeWorkflowRun })

  const createForm = useForm({
    defaultValues: {
      templateId: '',
      agentId: ''
    },
    onSubmit: async ({ value }) => {
      if (workspaceId === undefined) {
        toast('No workspace selected', 'error')
        return
      }
      try {
        await createMutation.mutateAsync({
          templateId: value.templateId,
          workspaceId,
          ...(value.agentId.trim() ? { agentId: value.agentId.trim() } : {})
        })
        await queryClient.invalidateQueries({ queryKey: ['workflows', workspaceId] })
        toast('Workflow created', 'success')
        createForm.reset()
        setAddOpen(false)
      } catch (caught) {
        toast('Could not create workflow', 'error')
        throw caught
      }
    }
  })

  // Multi-step builder state. Step keys are stable ids for React only; the
  // backend assigns the real step ids in order (buildWorkflowSteps mirrors that).
  const stepKey = useRef(0)
  const makeDraft = (): StepDraft => {
    stepKey.current += 1
    return newStepDraft(`k${stepKey.current}`)
  }
  const [newName, setNewName] = useState('')
  const [newDescription, setNewDescription] = useState('')
  const [scheduleEnabled, setScheduleEnabled] = useState(false)
  const [intervalMinutes, setIntervalMinutes] = useState('60')
  const [drafts, setDrafts] = useState<StepDraft[]>(() => [makeDraft()])

  function resetNewWorkflow() {
    setNewName('')
    setNewDescription('')
    setScheduleEnabled(false)
    setIntervalMinutes('60')
    stepKey.current = 0
    setDrafts([makeDraft()])
  }

  async function handleCreateWorkflow(): Promise<void> {
    if (workspaceId === undefined) {
      toast('No workspace selected', 'error')
      return
    }
    const name = newName.trim()
    if (!name) {
      toast('Workflow name is required', 'error')
      return
    }
    const built = buildWorkflowSteps(drafts)
    if (!built.ok) {
      toast(built.error, 'error')
      return
    }
    const description = newDescription.trim()
    let schedule: WorkflowScheduleInput | undefined
    if (scheduleEnabled) {
      const minutes = Number(intervalMinutes)
      if (!Number.isInteger(minutes) || minutes < 5 || minutes > 43_200) {
        toast('Schedule interval must be between 5 and 43200 minutes', 'error')
        return
      }
      schedule = { enabled: true, intervalMinutes: minutes }
    }
    try {
      await createWorkflowMutation.mutateAsync({
        workspaceId,
        name,
        steps: built.steps,
        ...(description ? { description } : {}),
        ...(schedule ? { schedule } : {})
      })
      await queryClient.invalidateQueries({ queryKey: ['workflows', workspaceId] })
      toast('Workflow created', 'success')
      resetNewWorkflow()
      setNewOpen(false)
    } catch {
      toast('Could not create workflow', 'error')
    }
  }

  async function handleRun(workflowId: string) {
    try {
      await startRunMutation.mutateAsync({ workflowId })
      await queryClient.invalidateQueries({ queryKey: ['workflowRuns', workflowId] })
      toast('Run started', 'success')
    } catch {
      toast('Could not start run', 'error')
    }
  }

  async function handleApprove(workflowRunId: string) {
    try {
      await approveMutation.mutateAsync(workflowRunId)
      await queryClient.invalidateQueries({ queryKey: ['workflowRuns', selectedWorkflowId] })
      toast('Run approved', 'success')
    } catch {
      toast('Could not approve run', 'error')
    }
  }

  async function handleResume(workflowRunId: string) {
    try {
      await resumeMutation.mutateAsync(workflowRunId)
      await queryClient.invalidateQueries({ queryKey: ['workflowRuns', selectedWorkflowId] })
      toast('Run resumed', 'success')
    } catch {
      toast('Could not resume run', 'error')
    }
  }

  const workflowColumns = useMemo<ColumnDef<Workflow, any>[]>(
    () => [
      workflowCol.accessor('name', {
        header: 'Name',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      workflowCol.accessor((row) => row.steps.length, {
        id: 'steps',
        header: 'Steps',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      workflowCol.accessor((row) => (row.enabled ? 'enabled' : 'disabled'), {
        id: 'enabled',
        header: 'State',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      workflowCol.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <div className="flex gap-2">
            <button className="rm-button primary" disabled={startRunMutation.isPending} onClick={() => void handleRun(c.row.original.id)} type="button">
              Run
            </button>
            <button className="rm-button" onClick={() => setSelectedWorkflowId(c.row.original.id)} type="button">
              View runs
            </button>
          </div>
        )
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [startRunMutation.isPending]
  )

  const templateColumns = useMemo<ColumnDef<WorkflowTemplate, any>[]>(
    () => [
      templateCol.accessor('name', {
        header: 'Template',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      templateCol.accessor('description', {
        header: 'Description',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      templateCol.accessor((row) => row.steps.length, {
        id: 'steps',
        header: 'Steps',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      })
    ],
    []
  )

  const runColumns = useMemo<ColumnDef<WorkflowRun, any>[]>(
    () => [
      runCol.accessor('id', {
        header: 'Run',
        cell: (c) => <span className="rm-mono rm-cell-muted">{c.getValue()}</span>
      }),
      runCol.accessor('status', {
        header: 'Status',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      runCol.accessor((row) => new Date(row.createdAt).toLocaleString(), {
        id: 'createdAt',
        header: 'Created',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      runCol.display({
        id: 'actions',
        header: '',
        cell: (c) => {
          const run = c.row.original
          return (
            <div className="flex gap-2">
              {run.status === 'waiting_approval' ? (
                <button className="rm-button" disabled={approveMutation.isPending} onClick={() => void handleApprove(run.id)} type="button">
                  Approve
                </button>
              ) : null}
              {run.status === 'waiting_run' ? (
                <button className="rm-button" disabled={resumeMutation.isPending} onClick={() => void handleResume(run.id)} type="button">
                  Resume
                </button>
              ) : null}
            </div>
          )
        }
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [approveMutation.isPending, resumeMutation.isPending, selectedWorkflowId]
  )

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title">Workflows</div>
        <div className="flex gap-2">
          <button className="rm-button" disabled={workflowsQuery.isFetching} onClick={() => void workflowsQuery.refetch()} type="button">
            {workflowsQuery.isFetching ? 'Refreshing' : 'Refresh'}
          </button>
          <button className="rm-button" onClick={() => setAddOpen(true)} type="button">
            + From template
          </button>
          <button className="rm-button primary" onClick={() => setNewOpen(true)} type="button">
            + New workflow
          </button>
        </div>
      </div>

      <FormDialog open={addOpen} title="New workflow" onClose={() => setAddOpen(false)}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void createForm.handleSubmit()
        }}
      >
        <div className="text-sm text-muted">Create from template</div>
        <createForm.Field
          name="templateId"
          validators={{ onChange: ({ value }: { value: string }) => (!value ? 'Template is required' : undefined) }}
        >
          {(field) => (
            <>
              <select
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                value={field.state.value}
              >
                <option value="">Select a template…</option>
                {(templatesQuery.data ?? []).map((template) => (
                  <option key={template.id} value={template.id}>
                    {template.name}
                  </option>
                ))}
              </select>
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </createForm.Field>
        <createForm.Field name="agentId">
          {(field) => (
            <input
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value)}
              placeholder="Agent id (optional)"
              value={field.state.value}
            />
          )}
        </createForm.Field>
        <createForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button className="rm-button" disabled={!canSubmit || isSubmitting} type="submit">
              {isSubmitting ? 'Creating' : 'Create workflow'}
            </button>
          )}
        </createForm.Subscribe>
      </form>
      </FormDialog>

      <FormDialog open={newOpen} title="New workflow" onClose={() => setNewOpen(false)}>
      <form
        className="grid gap-3"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void handleCreateWorkflow()
        }}
      >
        <input
          className="rm-input"
          onChange={(event) => setNewName(event.currentTarget.value)}
          placeholder="Workflow name"
          value={newName}
        />
        <input
          className="rm-input"
          onChange={(event) => setNewDescription(event.currentTarget.value)}
          placeholder="Description (optional)"
          value={newDescription}
        />

        <WorkflowStepBuilder drafts={drafts} onAdd={() => setDrafts((prev) => [...prev, makeDraft()])} onChange={setDrafts} />

        <label className="flex items-center gap-2 text-sm">
          <input checked={scheduleEnabled} onChange={(event) => setScheduleEnabled(event.currentTarget.checked)} type="checkbox" />
          <span>Run on a schedule</span>
        </label>
        {scheduleEnabled ? (
          <label className="grid gap-1 text-sm">
            <span className="text-muted">Interval (minutes, 5–43200)</span>
            <input
              className="rm-input"
              max={43_200}
              min={5}
              onChange={(event) => setIntervalMinutes(event.currentTarget.value)}
              type="number"
              value={intervalMinutes}
            />
          </label>
        ) : null}

        <button className="rm-button primary" disabled={createWorkflowMutation.isPending} type="submit">
          {createWorkflowMutation.isPending ? 'Creating' : 'Create workflow'}
        </button>
      </form>
      </FormDialog>

      <div className="mt-4">
        <PanelState
          empty="No workflows yet."
          emptyAction={
            <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
              + Create workflow
            </button>
          }
          query={workflowsQuery}
        >
          {(rows) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: 'Total workflows', value: rows.length },
                  { label: 'Enabled', value: rows.filter((row) => row.enabled).length },
                  { label: 'Templates', value: (templatesQuery.data ?? []).length }
                ]}
              />
              <DataTable columns={workflowColumns} data={rows} />
            </div>
          )}
        </PanelState>
      </div>

      <div className="mt-4">
        <div className="rm-card-title">Templates</div>
        <PanelState query={templatesQuery} empty="No templates available.">
          {(rows) => <DataTable columns={templateColumns} data={rows} />}
        </PanelState>
      </div>

      {selectedWorkflowId !== undefined ? (
        <div className="mt-4">
          <div className="rm-card-header">
            <div className="rm-card-title">Runs</div>
            <button className="rm-button" onClick={() => setSelectedWorkflowId(undefined)} type="button">
              Close
            </button>
          </div>
          <DataTable columns={runColumns} data={runsQuery.data ?? []} empty="No runs for this workflow." />
        </div>
      ) : null}
    </section>
  )
}
