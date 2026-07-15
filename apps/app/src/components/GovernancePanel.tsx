import { useForm } from '@tanstack/react-form'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import {
  createDataExportPackage,
  deleteDataExportPackage,
  downloadDataExportPackageContent,
  enforceRetention,
  executeDataExport,
  exportAccessReviewCsv,
  exportAccessReviewReportCsv,
  exportComplianceReportCsv,
  getAccessReviewReport,
  getDataRightsCoverage,
  getRetentionPolicy,
  listAccessReviewGrants,
  listDataExportPackages,
  previewDataExport,
  updateRetentionPolicy
} from '../api/client'
import type { DataExportPreview, DataExportRequest, DataExportScope, Workspace } from '../api/types'
import { downloadCsv } from '../lib/csv'
import { toast } from '../lib/toast'
import { ChatLifecyclePanel } from './ChatLifecyclePanel'
import { DataDeletionPanel } from './DataDeletionPanel'
import { PanelStats } from './PanelStats'
import { Tabs } from './Tabs'
import { WorkspaceLifecyclePanel } from './WorkspaceLifecyclePanel'

export function GovernancePanel({
  activeChatId,
  onChatArchived,
  onChatDeleted,
  onWorkspaceArchived,
  workspace
}: {
  activeChatId: string | undefined
  onChatArchived: (chatId: string) => Promise<void>
  onChatDeleted: (chatId: string) => Promise<void>
  onWorkspaceArchived: (workspaceId: string) => Promise<void>
  workspace: Workspace | undefined
}) {
  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">Governance</div>
      <Tabs
        tabs={[
          { id: 'retention', label: 'Retention & access', content: <RetentionTab /> },
          { id: 'exports', label: 'Data exports', content: <DataExportsTab workspace={workspace} /> },
          { id: 'rights', label: 'Data rights coverage', content: <DataRightsTab /> },
          { id: 'reports', label: 'Reports', content: <ReportsTab /> }
        ]}
      />
      <WorkspaceLifecyclePanel onWorkspaceArchived={onWorkspaceArchived} workspace={workspace} />
      <ChatLifecyclePanel activeChatId={activeChatId} onChatArchived={onChatArchived} />
      <DataDeletionPanel activeChatId={activeChatId} onChatDeleted={onChatDeleted} />
    </section>
  )
}

function RetentionTab() {
  const queryClient = useQueryClient()
  const retentionQuery = useQuery({ queryKey: ['retentionPolicy'], queryFn: getRetentionPolicy })
  const accessQuery = useQuery({ queryKey: ['accessReview'], queryFn: listAccessReviewGrants })
  const updateMutation = useMutation({ mutationFn: updateRetentionPolicy })
  const enforceMutation = useMutation({
    mutationFn: enforceRetention,
    onSuccess: async (result) => {
      toast(`Retention enforced — ${result.deletedAuditLogCount} audit logs removed`, 'success')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['auditLogs'] }),
        queryClient.invalidateQueries({ queryKey: ['dataExportPackages'] })
      ])
    },
    onError: () => toast('Could not enforce retention', 'error')
  })

  const form = useForm({
    defaultValues: { days: retentionQuery.data?.auditLogRetentionDays ?? 365 },
    onSubmit: async ({ value }) => {
      try {
        await updateMutation.mutateAsync({ auditLogRetentionDays: value.days })
        toast('Retention policy saved', 'success')
        await Promise.all([
          queryClient.invalidateQueries({ queryKey: ['retentionPolicy'] }),
          queryClient.invalidateQueries({ queryKey: ['auditLogs'] })
        ])
      } catch {
        toast('Could not save retention policy', 'error')
      }
    }
  })

  const grants = accessQuery.data ?? []

  return (
    <div className="grid gap-4">
      <form
        className="grid gap-2 text-sm"
        key={retentionQuery.data?.auditLogRetentionDays ?? 'default'}
        onSubmit={(event) => {
          event.preventDefault()
          event.stopPropagation()
          void form.handleSubmit()
        }}
      >
        <label className="text-muted" htmlFor="audit-retention-days">Audit retention days</label>
        <form.Field name="days">
          {(field) => (
            <input
              className="rm-input"
              id="audit-retention-days"
              max={3650}
              min={30}
              onBlur={field.handleBlur}
              onChange={(event) => field.handleChange(Number(event.currentTarget.value))}
              type="number"
              value={field.state.value}
            />
          )}
        </form.Field>
        <div className="flex flex-wrap gap-2">
          <form.Subscribe selector={(state) => ({ canSubmit: state.canSubmit, isSubmitting: state.isSubmitting })}>
            {({ canSubmit, isSubmitting }) => (
              <button
                className="rm-button"
                disabled={updateMutation.isPending || !canSubmit || isSubmitting}
                type="submit"
              >
                {updateMutation.isPending ? 'Saving' : 'Save retention'}
              </button>
            )}
          </form.Subscribe>
          <button
            className="rm-button"
            disabled={enforceMutation.isPending}
            onClick={() => {
              if (!window.confirm('Run retention enforcement now? This permanently deletes audit logs and expired export packages older than the retention window.')) return
              enforceMutation.mutate()
            }}
            type="button"
          >
            {enforceMutation.isPending ? 'Enforcing' : 'Run retention now'}
          </button>
        </div>
      </form>
      <div className="grid gap-2 text-sm">
        {grants.slice(0, 6).map((grant) => (
          <div className="rounded-md border border-border p-2" key={grant.id}>
            <div className="font-medium">
              {grant.resourceType}:{grant.resourceId}
            </div>
            <div className="break-words text-muted">
              {grant.principalType}:{grant.principalId} - {grant.permission}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DataExportsTab({ workspace }: { workspace: Workspace | undefined }) {
  const queryClient = useQueryClient()
  const packagesQuery = useQuery({ queryKey: ['dataExportPackages'], queryFn: listDataExportPackages })
  const [scope, setScope] = useState<DataExportScope>('org')
  const [workspaceId, setWorkspaceId] = useState('')
  const [includeContent, setIncludeContent] = useState(false)
  const [preview, setPreview] = useState<DataExportPreview>()

  function buildRequest(): DataExportRequest | undefined {
    if (scope === 'workspace' && workspaceId.trim().length === 0) {
      toast('A workspace id is required for a workspace-scoped export', 'error')
      return undefined
    }
    return {
      scope,
      ...(scope === 'workspace' ? { workspaceId: workspaceId.trim() } : {}),
      ...(includeContent ? { includeContent: true } : {})
    }
  }

  const previewMutation = useMutation({
    mutationFn: previewDataExport,
    onSuccess: (result) => {
      setPreview(result)
      toast('Export preview ready', 'success')
    },
    onError: () => toast('Could not preview export', 'error')
  })
  const executeMutation = useMutation({
    mutationFn: executeDataExport,
    onSuccess: () => toast('Export executed', 'success'),
    onError: () => toast('Could not execute export', 'error')
  })
  const createMutation = useMutation({
    mutationFn: createDataExportPackage,
    onSuccess: async (created) => {
      toast(`Package ${created.packageId} created`, 'success')
      await queryClient.invalidateQueries({ queryKey: ['dataExportPackages'] })
    },
    onError: () => toast('Could not create export package', 'error')
  })
  const deleteMutation = useMutation({
    mutationFn: deleteDataExportPackage,
    onSuccess: async () => {
      toast('Package deleted', 'success')
      await queryClient.invalidateQueries({ queryKey: ['dataExportPackages'] })
    },
    onError: () => toast('Could not delete package', 'error')
  })
  const downloadMutation = useMutation({
    mutationFn: downloadDataExportPackageContent,
    onError: () => toast('Could not download package content', 'error')
  })

  const list = packagesQuery.data
  const packages = list?.packages ?? []

  return (
    <div className="grid gap-4 text-sm">
      <PanelStats
        items={[
          { label: 'Packages', value: packages.length },
          { label: 'Org scope', value: packages.filter((entry) => entry.request.scope === 'org').length },
          { label: 'Workspace scope', value: packages.filter((entry) => entry.request.scope === 'workspace').length },
          { label: 'With content', value: packages.filter((entry) => entry.request.includeContent).length }
        ]}
      />

      <div className="grid gap-2 rounded-md border border-border p-2">
        <div className="font-medium">New export (DSAR)</div>
        <label className="text-muted" htmlFor="export-scope">Scope</label>
        <select
          className="rm-input"
          id="export-scope"
          onChange={(event) => setScope(event.currentTarget.value as DataExportScope)}
          value={scope}
        >
          <option value="org">org</option>
          <option value="workspace">workspace</option>
        </select>
        {scope === 'workspace' ? (
          <>
            <label className="text-muted" htmlFor="export-workspace">Workspace id</label>
            <input
              className="rm-input"
              id="export-workspace"
              onChange={(event) => setWorkspaceId(event.currentTarget.value)}
              placeholder={workspace?.id ?? 'ws_...'}
              value={workspaceId}
            />
          </>
        ) : null}
        <label className="flex items-center gap-2 text-muted">
          <input
            checked={includeContent}
            onChange={(event) => setIncludeContent(event.currentTarget.checked)}
            type="checkbox"
          />
          Include message content
        </label>
        <div className="flex flex-wrap gap-2">
          <button
            className="rm-button"
            disabled={previewMutation.isPending}
            onClick={() => {
              const request = buildRequest()
              if (request) previewMutation.mutate(request)
            }}
            type="button"
          >
            {previewMutation.isPending ? 'Previewing' : 'Preview'}
          </button>
          <button
            className="rm-button"
            disabled={executeMutation.isPending}
            onClick={() => {
              const request = buildRequest()
              if (request) executeMutation.mutate(request)
            }}
            type="button"
          >
            {executeMutation.isPending ? 'Executing' : 'Execute'}
          </button>
          <button
            className="rm-button primary"
            disabled={createMutation.isPending}
            onClick={() => {
              const request = buildRequest()
              if (request) createMutation.mutate(request)
            }}
            type="button"
          >
            {createMutation.isPending ? 'Creating' : 'Create package'}
          </button>
        </div>
        {preview ? (
          <div className="rounded-md border border-border p-2 text-muted">
            <div className="font-medium">Preview — {preview.request.scope}</div>
            <div>Chats {preview.counts.chats} · Messages {preview.counts.messages} · Files {preview.counts.fileObjects}</div>
            {preview.warnings.length > 0 ? <div>Warnings: {preview.warnings.join(', ')}</div> : null}
          </div>
        ) : null}
      </div>

      <div className="grid gap-2">
        <div className="font-medium">Packages</div>
        {packagesQuery.isLoading ? <div className="text-muted">Loading…</div> : null}
        {!packagesQuery.isLoading && packages.length === 0 ? (
          <div className="text-muted">No export packages.</div>
        ) : null}
        {packages.map((entry) => (
          <div className="grid gap-1 rounded-md border border-border p-2" key={entry.packageId}>
            <div className="break-words font-medium">{entry.packageId}</div>
            <div className="text-muted">
              {entry.request.scope}
              {entry.request.workspaceId ? `:${entry.request.workspaceId}` : ''} · {entry.artifact.sizeBytes} bytes · {entry.createdAt}
            </div>
            <div className="flex flex-wrap gap-2">
              <button
                className="rm-button"
                disabled={downloadMutation.isPending}
                onClick={async () => {
                  const content = await downloadMutation.mutateAsync(entry.packageId)
                  downloadCsv(content, `romeo-data-export-${entry.packageId}.json`)
                }}
                type="button"
              >
                Download content
              </button>
              <button
                className="rm-button"
                disabled={deleteMutation.isPending}
                onClick={() => {
                  if (!window.confirm(`Delete export package ${entry.packageId}? This cannot be undone.`)) return
                  deleteMutation.mutate({ packageId: entry.packageId, confirmPackageId: entry.packageId })
                }}
                type="button"
              >
                Delete
              </button>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function DataRightsTab() {
  const coverageQuery = useQuery({ queryKey: ['dataRightsCoverage'], queryFn: getDataRightsCoverage })
  const report = coverageQuery.data

  if (coverageQuery.isLoading) return <div className="text-muted text-sm">Loading…</div>
  if (!report) return <div className="text-muted text-sm">Coverage report unavailable.</div>

  const implementedStorage = report.storageClasses.filter((entry) => entry.deletionCoverage === 'implemented').length

  return (
    <div className="grid gap-4 text-sm">
      <PanelStats
        items={[
          { label: 'Storage classes', value: report.storageClasses.length },
          { label: 'Deletion implemented', value: implementedStorage },
          { label: 'Deletion workflows', value: report.deletionWorkflows.length },
          { label: 'Export workflows', value: report.exportWorkflows.length },
          { label: 'Open gaps', value: report.openGaps.length }
        ]}
      />
      <div className="text-muted">Generated {report.generatedAt}</div>
      <div className="grid gap-2">
        {report.storageClasses.map((entry) => (
          <div className="grid gap-1 rounded-md border border-border p-2" key={entry.id}>
            <div className="font-medium">{entry.label}</div>
            <div className="text-muted">
              delete: {entry.deletionCoverage} · export: {entry.exportCoverage} · retention: {entry.retentionCoverage}
            </div>
          </div>
        ))}
      </div>
      {report.openGaps.length > 0 ? (
        <div className="rounded-md border border-border p-2">
          <div className="font-medium">Open gaps</div>
          <ul className="ml-4 list-disc text-muted">
            {report.openGaps.map((gap) => (
              <li key={gap}>{gap}</li>
            ))}
          </ul>
        </div>
      ) : null}
    </div>
  )
}

function ReportsTab() {
  const reportQuery = useQuery({ queryKey: ['accessReviewReport'], queryFn: getAccessReviewReport })
  const complianceExportMutation = useMutation({
    mutationFn: exportComplianceReportCsv,
    onSuccess: (csv) => downloadCsv(csv, 'romeo-compliance-report.csv'),
    onError: () => toast('Could not export compliance report', 'error')
  })
  const accessExportMutation = useMutation({
    mutationFn: exportAccessReviewCsv,
    onSuccess: (csv) => downloadCsv(csv, 'romeo-access-review.csv'),
    onError: () => toast('Could not export access review', 'error')
  })
  const accessReportExportMutation = useMutation({
    mutationFn: exportAccessReviewReportCsv,
    onSuccess: (csv) => downloadCsv(csv, 'romeo-access-review-report.csv'),
    onError: () => toast('Could not export access review report', 'error')
  })

  const summary = reportQuery.data?.summary

  return (
    <div className="grid gap-4 text-sm">
      {summary ? (
        <PanelStats
          items={[
            { label: 'Users', value: summary.userCount },
            { label: 'Disabled users', value: summary.disabledUserCount },
            { label: 'Service accounts', value: summary.serviceAccountCount },
            { label: 'Resource grants', value: summary.resourceGrantCount },
            { label: 'Risky tool connectors', value: summary.riskyToolConnectorCount }
          ]}
        />
      ) : null}
      <div className="flex flex-wrap gap-2">
        <button
          className="rm-button"
          disabled={complianceExportMutation.isPending}
          onClick={() => complianceExportMutation.mutate()}
          type="button"
        >
          {complianceExportMutation.isPending ? 'Exporting' : 'Export compliance report'}
        </button>
        <button
          className="rm-button"
          disabled={accessExportMutation.isPending}
          onClick={() => accessExportMutation.mutate()}
          type="button"
        >
          {accessExportMutation.isPending ? 'Exporting' : 'Export access review'}
        </button>
        <button
          className="rm-button"
          disabled={accessReportExportMutation.isPending}
          onClick={() => accessReportExportMutation.mutate()}
          type="button"
        >
          {accessReportExportMutation.isPending ? 'Exporting' : 'Export access review report'}
        </button>
      </div>
    </div>
  )
}
