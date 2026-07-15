import Archive from 'lucide-react/dist/esm/icons/archive.mjs'
import Download from 'lucide-react/dist/esm/icons/download.mjs'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { useState } from 'react'

import { archiveWorkspace, exportWorkspace } from '../api/client'
import type { Workspace } from '../api/types'
import { toast } from '../lib/toast'

export function WorkspaceLifecyclePanel({
  workspace,
  onWorkspaceArchived
}: {
  workspace: Workspace | undefined
  onWorkspaceArchived: (workspaceId: string) => Promise<void>
}) {
  const queryClient = useQueryClient()
  const [confirmSlug, setConfirmSlug] = useState('')
  const [notice, setNotice] = useState<string>()
  const archiveMutation = useMutation({ mutationFn: archiveWorkspace })
  const exportMutation = useMutation({ mutationFn: exportWorkspace })
  const canArchive = workspace !== undefined && confirmSlug === workspace.slug && !archiveMutation.isPending
  const canExport = workspace !== undefined && !exportMutation.isPending

  async function handleExport() {
    if (workspace === undefined) return
    setNotice(undefined)
    try {
      const document = await exportMutation.mutateAsync(workspace.id)
      downloadJson(`romeo-workspace-${workspace.slug}.json`, document)
      await queryClient.invalidateQueries({ queryKey: ['auditLogs'] })
      setNotice('Workspace export ready.')
      toast('Workspace exported', 'success')
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Unable to export workspace.')
      toast('Could not export workspace', 'error')
    }
  }

  async function handleArchive() {
    if (!canArchive || workspace === undefined) return
    setNotice(undefined)
    try {
      const archived = await archiveMutation.mutateAsync(workspace.id)
      await onWorkspaceArchived(archived.id)
      setConfirmSlug('')
      setNotice('Workspace archived.')
      toast('Workspace archived', 'success')
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Unable to archive workspace.')
      toast('Could not archive workspace', 'error')
    }
  }

  return (
    <div className="mt-4 grid gap-2 text-sm">
      <div className="text-muted">Workspace lifecycle</div>
      <button className="rm-button inline-flex items-center justify-center gap-2" disabled={!canExport} onClick={() => void handleExport()} type="button">
        <Download aria-hidden="true" size={16} />
        Export
      </button>
      <label className="text-muted" htmlFor="workspace-archive-confirm">
        Confirm slug
      </label>
      <input
        className="rm-input"
        disabled={workspace === undefined || archiveMutation.isPending}
        id="workspace-archive-confirm"
        onChange={(event) => setConfirmSlug(event.currentTarget.value)}
        value={confirmSlug}
      />
      <button className="rm-button inline-flex items-center justify-center gap-2" disabled={!canArchive} onClick={() => void handleArchive()} type="button">
        <Archive aria-hidden="true" size={16} />
        Archive workspace
      </button>
      {notice ? <div className="text-xs text-muted">{notice}</div> : null}
    </div>
  )
}

function downloadJson(fileName: string, document: unknown): void {
  const blob = new Blob([JSON.stringify(document, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const anchor = documentGlobal().createElement('a')
  anchor.href = url
  anchor.download = fileName
  anchor.click()
  URL.revokeObjectURL(url)
}

function documentGlobal(): Document {
  return globalThis.document
}
