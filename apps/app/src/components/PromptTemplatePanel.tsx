import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useMemo, useState } from 'react'

import {
  createPromptTemplate,
  deletePromptTemplate,
  listPromptMarketplace,
  listPromptTemplates,
  updatePromptTemplate
} from '../api/prompt-template-client'
import type { CreatePromptTemplateInput, PromptTemplate, PromptTemplateVisibility } from '../api/prompt-template-types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { useConfirm } from './ConfirmDialog'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { FormDialog } from './FormDialog'
import { PanelStats } from './PanelStats'
import { useWorkspace } from './WorkspaceContext'

const templateCol = createColumnHelper<PromptTemplate>()
const marketplaceCol = createColumnHelper<PromptTemplate>()

const visibilities: PromptTemplateVisibility[] = ['private', 'workspace', 'marketplace']

export function PromptTemplatePanel() {
  const queryClient = useQueryClient()
  const { workspaceId } = useWorkspace()
  const { ask, dialog } = useConfirm()
  const templatesQuery = useQuery({ queryKey: ['promptTemplates', workspaceId], queryFn: () => listPromptTemplates(workspaceId), enabled: workspaceId !== undefined })
  const marketplaceQuery = useQuery({ queryKey: ['promptMarketplace', workspaceId], queryFn: () => listPromptMarketplace(workspaceId), enabled: workspaceId !== undefined })
  const createMutation = useMutation({ mutationFn: createPromptTemplate })
  const deleteMutation = useMutation({ mutationFn: deletePromptTemplate })
  const [addOpen, setAddOpen] = useState(false)
  const [editing, setEditing] = useState<PromptTemplate | null>(null)

  const form = useForm({
    defaultValues: {
      name: '',
      body: '',
      visibility: 'private' as PromptTemplateVisibility
    },
    onSubmit: async ({ value }) => {
      if (workspaceId === undefined) {
        toast('No workspace selected', 'error')
        return
      }
      try {
        const input: CreatePromptTemplateInput = {
          workspaceId,
          name: value.name,
          body: value.body,
          visibility: value.visibility
        }
        await createMutation.mutateAsync(input)
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['promptTemplates', workspaceId] }),
          queryClient.invalidateQueries({ queryKey: ['promptMarketplace'] })
        ])
        form.reset()
        toast('Template created', 'success')
        setAddOpen(false)
      } catch (caught) {
        toast('Could not create template', 'error')
        throw caught
      }
    }
  })

  const columns = useMemo<ColumnDef<PromptTemplate, any>[]>(
    () => [
      templateCol.accessor('name', {
        header: 'Name',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      templateCol.accessor('visibility', {
        header: 'Visibility',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      templateCol.accessor((row) => row.tags.join(', '), {
        id: 'tags',
        header: 'Tags',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      templateCol.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <div className="flex items-center gap-2">
            <button className="rm-button" onClick={() => setEditing(c.row.original)} type="button">
              Edit
            </button>
            <button
              className="rm-button"
              disabled={deleteMutation.isPending}
              onClick={() => void handleDelete(c.row.original.id)}
              type="button"
            >
              Delete
            </button>
          </div>
        )
      })
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [deleteMutation.isPending]
  )

  const marketplaceColumns = useMemo<ColumnDef<PromptTemplate, any>[]>(
    () => [
      marketplaceCol.accessor('name', {
        header: 'Name',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      marketplaceCol.accessor((row) => row.description ?? '', {
        id: 'description',
        header: 'Description',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      }),
      marketplaceCol.accessor((row) => row.tags.join(', '), {
        id: 'tags',
        header: 'Tags',
        cell: (c) => <span className="rm-cell-muted">{c.getValue()}</span>
      })
    ],
    []
  )

  async function handleDelete(promptTemplateId: string) {
    if (!(await ask({ title: 'Delete template?', confirmLabel: 'Delete', tone: 'danger' }))) return
    try {
      await deleteMutation.mutateAsync(promptTemplateId)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['promptTemplates', workspaceId] }),
        queryClient.invalidateQueries({ queryKey: ['promptMarketplace'] })
      ])
      toast('Template removed', 'success')
    } catch {
      toast('Could not remove template', 'error')
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="flex items-center justify-between gap-3">
        <div className="rm-card-title">Prompt templates</div>
        <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
          + Add template
        </button>
      </div>
      <FormDialog open={addOpen} title="New template" onClose={() => setAddOpen(false)}>
      <form
        className="mt-3 grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <form.Field
          name="name"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Name is required' : undefined) }}
        >
          {(field) => (
            <>
              <input
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Template name"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </form.Field>
        <form.Field
          name="body"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Body is required' : undefined) }}
        >
          {(field) => (
            <>
              <textarea
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Template body"
                rows={4}
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </form.Field>
        <form.Field name="visibility">
          {(field) => (
            <select
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value as PromptTemplateVisibility)}
              value={field.state.value}
            >
              {visibilities.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </form.Field>
        <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button className="rm-button" disabled={!canSubmit || isSubmitting} type="submit">
              {isSubmitting ? 'Creating' : 'Create template'}
            </button>
          )}
        </form.Subscribe>
      </form>
      </FormDialog>
      {editing !== null && workspaceId !== undefined ? (
        <PromptTemplateEditDialog
          key={editing.id}
          template={editing}
          onClose={() => setEditing(null)}
          onSaved={async () => {
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['promptTemplates', workspaceId] }),
              queryClient.invalidateQueries({ queryKey: ['promptMarketplace', workspaceId] })
            ])
            setEditing(null)
          }}
        />
      ) : null}
      <div className="mt-4">
        <PanelState
          query={templatesQuery}
          empty="No prompt templates yet."
          emptyAction={
            <button className="rm-button primary" onClick={() => setAddOpen(true)} type="button">
              + Add template
            </button>
          }
        >
          {(rows) => (
            <div className="grid gap-4">
              <PanelStats
                items={[
                  { label: 'Total templates', value: rows.length },
                  { label: 'Marketplace', value: rows.filter((row) => row.visibility === 'marketplace').length }
                ]}
              />
              <DataTable columns={columns} data={rows} />
            </div>
          )}
        </PanelState>
      </div>
      <div className="rm-card-title mt-6">Marketplace</div>
      <div className="mt-3">
        <PanelState query={marketplaceQuery} empty="No marketplace templates.">
          {(rows) => <DataTable columns={marketplaceColumns} data={rows} />}
        </PanelState>
      </div>
      {dialog}
    </section>
  )
}

function PromptTemplateEditDialog({
  template,
  onClose,
  onSaved
}: {
  template: PromptTemplate
  onClose: () => void
  onSaved: () => Promise<void>
}) {
  const editForm = useForm({
    defaultValues: {
      name: template.name,
      body: template.body,
      visibility: template.visibility
    },
    onSubmit: async ({ value }) => {
      try {
        await updatePromptTemplate(template.id, {
          name: value.name,
          body: value.body,
          visibility: value.visibility
        })
        toast('Template updated', 'success')
        await onSaved()
      } catch (caught) {
        toast('Could not update template', 'error')
        throw caught
      }
    }
  })

  return (
    <FormDialog open title="Edit template" onClose={onClose}>
      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void editForm.handleSubmit()
        }}
      >
        <editForm.Field
          name="name"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Name is required' : undefined) }}
        >
          {(field) => (
            <>
              <input
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Template name"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </editForm.Field>
        <editForm.Field
          name="body"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Body is required' : undefined) }}
        >
          {(field) => (
            <>
              <textarea
                className="rm-input"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Template body"
                rows={4}
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </editForm.Field>
        <editForm.Field name="visibility">
          {(field) => (
            <select
              className="rm-input"
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(event.currentTarget.value as PromptTemplateVisibility)}
              value={field.state.value}
            >
              {visibilities.map((option) => (
                <option key={option} value={option}>
                  {option}
                </option>
              ))}
            </select>
          )}
        </editForm.Field>
        <editForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button className="rm-button" disabled={!canSubmit || isSubmitting} type="submit">
              {isSubmitting ? 'Saving' : 'Save template'}
            </button>
          )}
        </editForm.Subscribe>
      </form>
    </FormDialog>
  )
}
