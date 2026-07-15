import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useState } from 'react'

import { listAgentShares, listShareTargets, shareAgentAccess } from '../api/client'
import type { Agent, ResourceGrant, ShareTarget } from '../api/types'
import { PanelState } from '../lib/panel-state'
import { toast } from '../lib/toast'

type AgentPermission = 'read' | 'run' | 'write'

const defaultPermissions: Record<AgentPermission, boolean> = { read: true, run: true, write: false }
const emptyTargets: ShareTarget[] = []

export function AgentAccessPanel({
  activeAgent,
  onNotice
}: {
  activeAgent: Agent | undefined
  onNotice: (notice: string | undefined) => void
}) {
  const queryClient = useQueryClient()
  const [query, setQuery] = useState('')
  const [selectedTargetKey, setSelectedTargetKey] = useState('')
  const [permissions, setPermissions] = useState(defaultPermissions)

  const targetsQuery = useQuery({ queryKey: ['shareTargets', query], queryFn: () => listShareTargets(query) })
  const sharesQuery = useQuery({
    queryKey: ['agentShares', activeAgent?.id],
    queryFn: () => listAgentShares(activeAgent!.id),
    enabled: activeAgent !== undefined
  })
  const shareMutation = useMutation({ mutationFn: shareAgentAccess })
  const targets = targetsQuery.data ?? emptyTargets
  const selectedTarget = targets.find((target) => targetKey(target) === selectedTargetKey)
  const selectedPermissions = (Object.entries(permissions) as Array<[AgentPermission, boolean]>)
    .filter(([, enabled]) => enabled)
    .map(([permission]) => permission)

  useEffect(() => {
    if (targets.length === 0) {
      setSelectedTargetKey('')
      return
    }
    if (!targets.some((target) => targetKey(target) === selectedTargetKey)) setSelectedTargetKey(targetKey(targets[0]!))
  }, [selectedTargetKey, targets])

  async function handleGrant() {
    if (!activeAgent || selectedTarget === undefined || selectedPermissions.length === 0) return
    try {
      await shareMutation.mutateAsync({
        agentId: activeAgent.id,
        principalType: selectedTarget.principalType,
        principalId: selectedTarget.principalId,
        permissions: selectedPermissions
      })
      onNotice('Agent access updated.')
      toast('Access granted', 'success')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['agentShares', activeAgent.id] }),
        queryClient.invalidateQueries({ queryKey: ['agentGallery'] }),
        queryClient.invalidateQueries({ queryKey: ['auditLogs'] })
      ])
    } catch {
      toast('Could not grant access', 'error')
    }
  }

  function togglePermission(permission: AgentPermission) {
    setPermissions((current) => ({ ...current, [permission]: !current[permission] }))
  }

  return (
    <div className="mt-4 grid gap-3 border-t border-border pt-4" data-testid="agent-access-panel">
      <div className="text-sm text-muted">Access</div>
      <div className="grid gap-2 text-sm">
        <input
          className="rm-input"
          onChange={(event) => setQuery(event.currentTarget.value)}
          placeholder="Search users, groups, service accounts"
          value={query}
        />
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-[minmax(0,1fr)_auto]">
          <select className="rm-input" disabled={targets.length === 0} onChange={(event) => setSelectedTargetKey(event.currentTarget.value)} value={selectedTargetKey}>
            {targets.map((target) => (
              <option key={targetKey(target)} value={targetKey(target)}>
                {target.label}
              </option>
            ))}
          </select>
          <button
            className="rm-button"
            disabled={!activeAgent || selectedTarget === undefined || selectedPermissions.length === 0 || shareMutation.isPending}
            onClick={() => void handleGrant()}
            type="button"
          >
            Grant
          </button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {(['read', 'run', 'write'] as const).map((permission) => (
            <label className="flex min-w-0 items-center gap-2 text-xs text-muted" key={permission}>
              <input checked={permissions[permission]} onChange={() => togglePermission(permission)} type="checkbox" />
              <span className="truncate">{permission}</span>
            </label>
          ))}
        </div>
      </div>
      <div className="grid gap-2 text-sm">
        <PanelState query={sharesQuery} empty="No access grants yet.">
          {(shares) =>
            groupShares(shares)
              .slice(0, 6)
              .map((share) => (
                <div className="rounded-md border border-border p-2" key={`${share.principalType}:${share.principalId}`}>
                  <div className="break-all font-medium">{share.principalId}</div>
                  <div className="text-muted">{share.permissions.join(', ')}</div>
                </div>
              ))}
        </PanelState>
      </div>
    </div>
  )
}

function targetKey(target: ShareTarget): string {
  return `${target.principalType}:${target.principalId}`
}

function groupShares(grants: ResourceGrant[]): Array<{
  principalType: string
  principalId: string
  permissions: string[]
}> {
  const grouped = new Map<string, { principalType: string; principalId: string; permissions: string[] }>()
  for (const grant of grants) {
    const key = `${grant.principalType}:${grant.principalId}`
    const existing = grouped.get(key) ?? { principalType: grant.principalType, principalId: grant.principalId, permissions: [] }
    existing.permissions.push(grant.permission)
    grouped.set(key, existing)
  }
  return [...grouped.values()]
    .map((share) => ({ ...share, permissions: [...new Set(share.permissions)].sort() }))
    .sort((left, right) => left.principalType.localeCompare(right.principalType) || left.principalId.localeCompare(right.principalId))
}
