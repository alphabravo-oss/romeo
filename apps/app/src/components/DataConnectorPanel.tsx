import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import {
  createDataConnector,
  getDataConnectorCatalog,
  listDataConnectors,
  listDataConnectorSyncs,
  listKnowledgeBases,
  syncLocalDataConnector
} from '../api/client'
import type { DataConnector, DataConnectorCatalogItem, DataConnectorType } from '../api/types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'
import { dataConnectorIcon } from './DataConnectorIcons'
import { type ColumnDef, DataTable, createColumnHelper } from './DataTable'
import { DataConnectorSyncHistory } from './DataConnectorSyncHistory'
import { FormDialog } from './FormDialog'
import { PanelStats } from './PanelStats'
import { Tabs } from './Tabs'

const col = createColumnHelper<DataConnector>()

/** Human-readable labels for the runtime blocked reasons the catalog returns. */
const BLOCKED_REASON_LABELS: Record<string, string> = {
  connector_driver_not_enabled: 'Connector execution driver not enabled',
  egress_allowlist_required: 'Egress allowlist required',
  s3_endpoint_missing: 'S3 endpoint not configured',
  s3_credentials_not_configured: 'S3 credentials not configured'
}

const WARNING_LABELS: Record<string, string> = {
  private_repository_credentials_not_configured: 'Private repository credentials not configured'
}

function labelFor(map: Record<string, string>, key: string): string {
  return map[key] ?? key.replace(/_/g, ' ')
}

export function DataConnectorPanel({ workspaceId }: { workspaceId: string | undefined }) {
  const queryClient = useQueryClient()
  const [addOpen, setAddOpen] = useState(false)
  // The connector type the create dialog is scoped to (app-store "Add" flow).
  const [addType, setAddType] = useState<DataConnectorType>('local_import')
  const [activeConnectorId, setActiveConnectorId] = useState<string>()

  const knowledgeBasesQuery = useQuery({
    queryKey: ['knowledgeBases', workspaceId],
    queryFn: () => listKnowledgeBases(workspaceId!),
    enabled: workspaceId !== undefined
  })
  const connectorsQuery = useQuery({
    queryKey: ['dataConnectors', workspaceId],
    queryFn: () => listDataConnectors(workspaceId!),
    enabled: workspaceId !== undefined
  })
  const catalogQuery = useQuery({ queryKey: ['dataConnectorCatalog'], queryFn: getDataConnectorCatalog })
  const connectors = useMemo(() => connectorsQuery.data ?? [], [connectorsQuery.data])
  const activeConnector = connectors.find((connector) => connector.id === activeConnectorId) ?? connectors[0]
  const syncsQuery = useQuery({
    queryKey: ['dataConnectorSyncs', activeConnector?.id],
    queryFn: () => listDataConnectorSyncs(activeConnector!.id),
    enabled: activeConnector !== undefined
  })
  const createMutation = useMutation({ mutationFn: createDataConnector })
  const syncMutation = useMutation({ mutationFn: syncLocalDataConnector })
  const firstKnowledgeBase = knowledgeBasesQuery.data?.[0]

  const catalogEntry = useMemo(
    () => catalogQuery.data?.connectors.find((c) => c.type === addType),
    [catalogQuery.data, addType]
  )

  useEffect(() => {
    if (activeConnectorId === undefined && connectors[0]) setActiveConnectorId(connectors[0].id)
  }, [activeConnectorId, connectors])

  function openAdd(type: DataConnectorType): void {
    setAddType(type)
    createForm.reset()
    setAddOpen(true)
  }

  const createForm = useForm({
    defaultValues: { name: '', configText: '' } as { name: string; configText: string },
    onSubmit: async ({ value }) => {
      if (!workspaceId || !firstKnowledgeBase) return
      const config = buildConfig(addType, value.configText)
      try {
        const connector = await createMutation.mutateAsync({
          workspaceId,
          knowledgeBaseId: firstKnowledgeBase.id,
          type: addType,
          name: value.name,
          config
        })
        setActiveConnectorId(connector.id)
        await queryClient.invalidateQueries({ queryKey: ['dataConnectors', workspaceId] })
        toast('Connector created', 'success')
        createForm.reset()
        setAddOpen(false)
      } catch (caught) {
        toast('Could not create connector', 'error')
        throw caught
      }
    }
  })

  const syncForm = useForm({
    defaultValues: {
      fileName: '',
      content: ''
    },
    onSubmit: async ({ value }) => {
      if (!activeConnector) return
      try {
        await syncMutation.mutateAsync({
          connectorId: activeConnector.id,
          fileName: value.fileName,
          mimeType: mimeTypeFor(value.fileName),
          content: value.content
        })
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['dataConnectorSyncs', activeConnector.id] }),
          queryClient.invalidateQueries({ queryKey: ['knowledgeSources', activeConnector.knowledgeBaseId] }),
          queryClient.invalidateQueries({ queryKey: ['usageEvents'] }),
          queryClient.invalidateQueries({ queryKey: ['usageSummary'] }),
          queryClient.invalidateQueries({ queryKey: ['usageAlerts'] })
        ])
        toast('Connector synced', 'success')
      } catch (caught) {
        toast('Could not sync connector', 'error')
        throw caught
      }
    }
  })

  const columns = useMemo<ColumnDef<DataConnector, any>[]>(
    () => [
      col.accessor('name', {
        header: 'Name',
        cell: (c) => <span className="font-medium">{c.getValue()}</span>
      }),
      col.accessor('type', {
        header: 'Type',
        cell: (c) => <span className="rm-cell-muted rm-mono">{c.getValue()}</span>
      }),
      col.accessor('status', {
        header: 'Status',
        cell: (c) => (
          <span className={`rm-status ${c.getValue() === 'active' ? 'pass' : 'fail'}`}>{c.getValue()}</span>
        )
      }),
      col.accessor((row) => row.lastSyncAt, {
        id: 'lastSync',
        header: 'Last sync',
        cell: (c) => (
          <span className="rm-cell-muted">{c.getValue() ? new Date(c.getValue()).toLocaleString() : '—'}</span>
        )
      }),
      col.display({
        id: 'actions',
        header: '',
        cell: (c) => (
          <button
            className={`rm-button ${c.row.original.id === activeConnector?.id ? 'selected' : ''}`}
            onClick={() => setActiveConnectorId(c.row.original.id)}
            type="button"
          >
            {c.row.original.id === activeConnector?.id ? 'Selected' : 'Select'}
          </button>
        )
      })
    ],
    [activeConnector?.id]
  )

  const sourcesTab = (
    <div className="grid gap-4">
      <div className="rm-card-header">
        <div className="rm-card-title" style={{ margin: 0, padding: 0, border: 'none' }}>
          Connectors
        </div>
        <button className="rm-button primary" onClick={() => openAdd('local_import')} type="button">
          + Add connector
        </button>
      </div>

      <PanelState
        empty="No connectors yet."
        emptyAction={
          <button className="rm-button primary" onClick={() => openAdd('local_import')} type="button">
            + Add connector
          </button>
        }
        query={connectorsQuery}
      >
        {(rows) => (
          <div className="grid gap-4">
            <PanelStats
              items={[
                { label: 'Total connectors', value: rows.length },
                { label: 'Active', value: rows.filter((row) => row.status === 'active').length }
              ]}
            />
            <DataTable columns={columns} data={rows} empty="No connectors yet." />
          </div>
        )}
      </PanelState>

      <form
        className="grid gap-2"
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void syncForm.handleSubmit()
        }}
      >
        <label className="text-sm text-muted" htmlFor="connector-file-name">
          Source file
        </label>
        <syncForm.Field
          name="fileName"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Source file is required' : undefined) }}
        >
          {(field) => (
            <>
              <input
                className="rm-input"
                id="connector-file-name"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="File name (e.g. notes.md)"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </syncForm.Field>
        <label className="text-sm text-muted" htmlFor="connector-source-content">
          Source text
        </label>
        <syncForm.Field
          name="content"
          validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Source text is required' : undefined) }}
        >
          {(field) => (
            <>
              <textarea
                className="rm-input min-h-24"
                id="connector-source-content"
                onBlur={field.handleBlur}
                onChange={(event) => field.handleChange(event.currentTarget.value)}
                placeholder="Source text to ingest"
                value={field.state.value}
              />
              {field.state.meta.errors.length ? (
                <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
              ) : null}
            </>
          )}
        </syncForm.Field>
        <syncForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
          {({ canSubmit, isSubmitting }) => (
            <button className="rm-button" disabled={!canSubmit || isSubmitting || !activeConnector} type="submit">
              {isSubmitting ? 'Syncing' : 'Sync local text'}
            </button>
          )}
        </syncForm.Subscribe>
      </form>

      <DataConnectorSyncHistory syncs={syncsQuery.data ?? []} />
    </div>
  )

  const catalogTab = (
    <PanelState query={catalogQuery} empty="No connector types in the catalog.">
      {(report) => (
        <div className="grid gap-4">
          <PanelStats
            items={[
              { label: 'Connector types', value: report.connectors.length },
              { label: 'Sync-ready', value: report.connectors.filter((c) => c.runtime.syncEnabled).length },
              { label: 'Execution driver', value: report.executionDriver }
            ]}
          />

          <div className="grid gap-3" style={{ gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))' }}>
            {report.connectors.map((entry) => (
              <CatalogCard
                canCreate={workspaceId !== undefined && firstKnowledgeBase !== undefined}
                entry={entry}
                key={entry.type}
                onAdd={() => openAdd(entry.type)}
              />
            ))}
          </div>
        </div>
      )}
    </PanelState>
  )

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-header">
        <div className="rm-card-title" style={{ margin: 0, padding: 0, border: 'none' }}>
          Data connectors
        </div>
      </div>

      <FormDialog open={addOpen} title={`New ${catalogEntry?.displayName ?? addType} connector`} onClose={() => setAddOpen(false)}>
        <form
          className="grid gap-2"
          onSubmit={(event) => {
            event.preventDefault()
            event.stopPropagation()
            void createForm.handleSubmit()
          }}
        >
          <label className="text-sm text-muted" htmlFor="connector-name">
            Connector name
          </label>
          <createForm.Field
            name="name"
            validators={{ onChange: ({ value }: { value: string }) => (!value?.trim() ? 'Connector name is required' : undefined) }}
          >
            {(field) => (
              <>
                <input
                  className="rm-input"
                  id="connector-name"
                  onBlur={field.handleBlur}
                  onChange={(event) => field.handleChange(event.currentTarget.value)}
                  placeholder="Connector name"
                  value={field.state.value}
                />
                {field.state.meta.errors.length ? (
                  <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
                ) : null}
              </>
            )}
          </createForm.Field>

          {configHint(addType) ? (
            <>
              <label className="text-sm text-muted" htmlFor="connector-config">
                {configHint(addType)!.label}
              </label>
              <createForm.Field
                name="configText"
                validators={{
                  onChange: ({ value }: { value: string }) =>
                    configHint(addType)!.required && !value?.trim() ? `${configHint(addType)!.label} is required` : undefined
                }}
              >
                {(field) => (
                  <>
                    <input
                      className="rm-input"
                      id="connector-config"
                      onBlur={field.handleBlur}
                      onChange={(event) => field.handleChange(event.currentTarget.value)}
                      placeholder={configHint(addType)!.placeholder}
                      value={field.state.value}
                    />
                    {field.state.meta.errors.length ? (
                      <div className="rm-composer-error">{field.state.meta.errors.join(', ')}</div>
                    ) : null}
                  </>
                )}
              </createForm.Field>
            </>
          ) : null}

          <createForm.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
            {({ canSubmit, isSubmitting }) => (
              <button
                className="rm-button primary"
                disabled={!canSubmit || isSubmitting || !workspaceId || !firstKnowledgeBase}
                type="submit"
              >
                {isSubmitting ? 'Creating' : `Create ${catalogEntry?.displayName ?? addType} connector`}
              </button>
            )}
          </createForm.Subscribe>
        </form>
      </FormDialog>

      <div className="mt-4">
        <Tabs
          tabs={[
            { id: 'sources', label: 'Sources', content: sourcesTab },
            { id: 'catalog', label: 'Catalog', content: catalogTab }
          ]}
        />
      </div>
    </section>
  )
}

/** App-store card for one catalog connector type. */
function CatalogCard(props: {
  entry: DataConnectorCatalogItem
  canCreate: boolean
  onAdd: () => void
}): React.ReactNode {
  const { entry, canCreate, onAdd } = props
  const planned = entry.implementationStatus !== 'implemented'
  const syncReady = entry.runtime.syncEnabled

  return (
    <div className="rm-panel" style={{ padding: 14, opacity: planned ? 0.75 : 1 }}>
      <div className="flex items-start gap-3">
        <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>{dataConnectorIcon(entry.type)}</div>
        <div className="min-w-0" style={{ flex: 1 }}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium truncate">{entry.displayName}</span>
            {planned ? (
              <span className="rm-status" style={{ color: 'var(--rm-muted)' }}>
                Coming soon
              </span>
            ) : (
              <span className={`rm-status ${syncReady ? 'pass' : 'warn'}`}>{syncReady ? 'Sync ready' : 'Setup needed'}</span>
            )}
          </div>
          <div className="flex items-center gap-2 mt-1">
            <span className="rm-status rm-mono" style={{ fontSize: 11 }}>
              {entry.type}
            </span>
            <span className="rm-status" style={{ fontSize: 11, color: 'var(--rm-muted)' }}>
              {entry.syncMode === 'inline_items' ? 'inline' : 'managed fetch'}
            </span>
          </div>
        </div>
      </div>

      <div className="text-xs text-muted mt-2">{entry.description}</div>

      {!planned && entry.runtime.blockedReasons.length ? (
        <div className="mt-2 grid gap-1">
          {entry.runtime.blockedReasons.map((reason) => (
            <div className="text-xs" key={reason} style={{ color: 'var(--rm-muted)' }}>
              • {labelFor(BLOCKED_REASON_LABELS, reason)}
            </div>
          ))}
        </div>
      ) : null}

      {!planned && entry.runtime.warnings.length ? (
        <div className="mt-2 grid gap-1">
          {entry.runtime.warnings.map((warning) => (
            <div className="text-xs" key={warning} style={{ color: 'var(--rm-muted)' }}>
              ⚠ {labelFor(WARNING_LABELS, warning)}
            </div>
          ))}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2 mt-3">
        <button className="rm-button primary" disabled={planned || !canCreate} onClick={onAdd} type="button">
          {planned ? 'Coming soon' : 'Add'}
        </button>
      </div>
    </div>
  )
}

/** Primary required/optional config field per connector type shown in the create dialog. */
function configHint(type: DataConnectorType): { key: string; label: string; placeholder: string; required: boolean } | null {
  switch (type) {
    case 'website':
      return { key: 'url', label: 'Website URL', placeholder: 'https://example.com', required: true }
    case 'rss':
      return { key: 'url', label: 'Feed URL', placeholder: 'https://example.com/feed.xml', required: true }
    case 'github':
      return { key: 'repository', label: 'Repository (owner/repo)', placeholder: 'owner/repo', required: true }
    case 's3':
      return { key: 'bucket', label: 'Bucket', placeholder: 'my-bucket', required: true }
    case 'local_import':
    default:
      return null
  }
}

/** Build the create config record from the single config field value. */
function buildConfig(type: DataConnectorType, configText: string): Record<string, unknown> {
  const hint = configHint(type)
  if (!hint) return {}
  const value = configText.trim()
  if (!value) return {}
  return { [hint.key]: value }
}

function mimeTypeFor(fileName: string): string {
  if (fileName.endsWith('.md')) return 'text/markdown'
  if (fileName.endsWith('.json')) return 'application/json'
  if (fileName.endsWith('.csv')) return 'text/csv'
  return 'text/plain'
}
