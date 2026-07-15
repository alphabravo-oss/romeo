import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { diffAgentVersions, listAgentVersions, publishAgent, rollbackAgentVersion, updateAgent } from '../api/client'
import { toast } from '../lib/toast'
import type { Agent, AgentVersion, AgentVersionDiff, BaseModel, Provider } from '../api/types'
import { AgentAccessPanel } from './AgentAccessPanel'
import { AgentDraftForm, type AgentDraftInput } from './AgentDraftForm'
import { AgentTestConsole } from './AgentTestConsole'
import { AgentVersionPanel } from './AgentVersionPanel'

const emptyVersions: AgentVersion[] = []

export function AgentStudioPanel({
  activeAgent,
  models,
  providers,
  workspaceId
}: {
  activeAgent: Agent | undefined
  models: BaseModel[]
  providers: Provider[]
  workspaceId: string | undefined
}) {
  const queryClient = useQueryClient()
  const [leftVersionId, setLeftVersionId] = useState('')
  const [rightVersionId, setRightVersionId] = useState('')
  const [diff, setDiff] = useState<AgentVersionDiff>()
  const [notice, setNotice] = useState<string>()

  const versionsQuery = useQuery({
    queryKey: ['agentVersions', activeAgent?.id],
    queryFn: () => listAgentVersions(activeAgent!.id),
    enabled: activeAgent !== undefined
  })
  const versions = versionsQuery.data ?? emptyVersions

  const saveMutation = useMutation({ mutationFn: updateAgent })
  const publishMutation = useMutation({ mutationFn: publishAgent })
  const rollbackMutation = useMutation({ mutationFn: rollbackAgentVersion })
  const diffMutation = useMutation({ mutationFn: diffAgentVersions })

  useEffect(() => {
    setNotice(undefined)
    setDiff(undefined)
  }, [activeAgent?.id])

  useEffect(() => {
    setLeftVersionId(versions[1]?.id ?? versions[0]?.id ?? '')
    setRightVersionId(versions[0]?.id ?? '')
  }, [activeAgent?.id, versions])

  async function handleSave(input: AgentDraftInput): Promise<Agent> {
    try {
      const saved = await saveMutation.mutateAsync(input)
      await invalidateAgentData(saved.id)
      toast('Agent saved', 'success')
      return saved
    } catch (caught) {
      toast('Could not save agent', 'error')
      throw caught
    }
  }

  async function handlePublish() {
    if (!activeAgent) return
    try {
      const version = await publishMutation.mutateAsync(activeAgent.id)
      setNotice(`Published version ${version.version}.`)
      await invalidateAgentData(activeAgent.id)
      toast('Agent published', 'success')
    } catch {
      toast('Could not publish agent', 'error')
    }
  }

  async function handleRollback(versionId: string) {
    if (!activeAgent) return
    try {
      const rolledBack = await rollbackMutation.mutateAsync({ agentId: activeAgent.id, versionId })
      setNotice('Rolled back to published version.')
      await invalidateAgentData(rolledBack.id)
      toast('Agent rolled back', 'success')
    } catch {
      toast('Could not roll back agent', 'error')
    }
  }

  async function handleDiff() {
    if (!activeAgent || !leftVersionId || !rightVersionId) return
    const result = await diffMutation.mutateAsync({ agentId: activeAgent.id, leftVersionId, rightVersionId })
    setDiff(result)
  }

  async function invalidateAgentData(agentId: string) {
    await Promise.all([
      workspaceId ? queryClient.invalidateQueries({ queryKey: ['agents', workspaceId] }) : Promise.resolve(),
      queryClient.invalidateQueries({ queryKey: ['agentVersions', agentId] })
    ])
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">Agent Studio</div>
      <AgentDraftForm
        activeAgent={activeAgent}
        isSaving={saveMutation.isPending}
        models={models}
        onNotice={setNotice}
        onSave={handleSave}
        providers={providers}
      />

      <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className="grid gap-1">
          <span className="text-sm text-muted">Published</span>
          <span className="break-all text-sm">{activeAgent?.publishedVersionId ?? 'Draft only'}</span>
        </div>
        <button className="rm-button primary" disabled={!activeAgent || publishMutation.isPending} onClick={handlePublish} type="button">
          {publishMutation.isPending ? 'Publishing' : 'Publish'}
        </button>
      </div>

      {notice ? <div className="mt-3 text-sm text-muted">{notice}</div> : null}

      <AgentAccessPanel activeAgent={activeAgent} onNotice={setNotice} />

      <AgentTestConsole activeAgent={activeAgent} workspaceId={workspaceId} />

      <AgentVersionPanel
        activeAgent={activeAgent}
        diff={diff}
        isComparing={diffMutation.isPending}
        isRollingBack={rollbackMutation.isPending}
        leftVersionId={leftVersionId}
        onCompare={() => void handleDiff()}
        onLeftVersionChange={setLeftVersionId}
        onRightVersionChange={setRightVersionId}
        onRollback={(versionId) => void handleRollback(versionId)}
        rightVersionId={rightVersionId}
        versions={versions}
      />
    </section>
  )
}
