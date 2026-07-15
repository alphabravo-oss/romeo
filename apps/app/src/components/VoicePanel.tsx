import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'

import { bindAgentVoice, listVoices, previewVoice, syncVoices } from '../api/client'
import type { Agent, SpeechArtifact } from '../api/types'
import { toast } from '../lib/toast'

export function VoicePanel({ activeAgent, workspaceId }: { activeAgent: Agent | undefined; workspaceId: string | undefined }) {
  const queryClient = useQueryClient()
  const voicesQuery = useQuery({ queryKey: ['voices'], queryFn: listVoices })
  const voices = useMemo(() => voicesQuery.data ?? [], [voicesQuery.data])
  const [voiceProfileId, setVoiceProfileId] = useState('')
  const [notice, setNotice] = useState<string>()
  const [previewArtifact, setPreviewArtifact] = useState<SpeechArtifact>()

  const bindMutation = useMutation({ mutationFn: bindAgentVoice })
  const previewMutation = useMutation({ mutationFn: previewVoice })
  const syncMutation = useMutation({ mutationFn: syncVoices })

  useEffect(() => {
    setVoiceProfileId(activeAgent?.voiceProfileId ?? voices[0]?.id ?? '')
  }, [activeAgent?.id, activeAgent?.voiceProfileId, voices])

  async function handleBind() {
    if (!activeAgent || !voiceProfileId) return
    try {
      await bindMutation.mutateAsync({ agentId: activeAgent.id, voiceProfileId })
      setNotice('Voice bound to agent draft.')
      if (workspaceId) await queryClient.invalidateQueries({ queryKey: ['agents', workspaceId] })
      toast('Voice bound to agent', 'success')
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Voice bind failed.')
      toast('Could not bind voice', 'error')
    }
  }

  async function handlePreview() {
    if (!voiceProfileId) return
    try {
      const artifact = await previewMutation.mutateAsync({ voiceProfileId, text: 'Romeo voice preview.' })
      setPreviewArtifact(artifact)
      setNotice('Voice preview generated.')
      toast('Voice preview generated', 'success')
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Voice preview failed.')
      toast('Could not generate voice preview', 'error')
    }
  }

  async function handleSync() {
    try {
      const result = await syncMutation.mutateAsync()
      setNotice(`Voice catalog synced: ${result.imported} new, ${result.existing} existing.`)
      await queryClient.invalidateQueries({ queryKey: ['voices'] })
      toast('Voice catalog synced', 'success')
    } catch (caught) {
      setNotice(caught instanceof Error ? caught.message : 'Voice catalog sync failed.')
      toast('Could not sync voice catalog', 'error')
    }
  }

  return (
    <section className="rm-panel p-4">
      <div className="rm-card-title">Voice</div>
      <div className="grid gap-2 text-sm">
        {voices.map((voice) => (
          <button
            className={`rm-button min-w-0 text-left ${voice.id === voiceProfileId ? 'selected' : ''}`}
            key={voice.id}
            onClick={() => setVoiceProfileId(voice.id)}
            type="button"
          >
            <span className="block truncate">{voice.name}</span>
          </button>
        ))}
      </div>
      <div className="mt-4 grid grid-cols-3 gap-2">
        <button className="rm-button" disabled={syncMutation.isPending} onClick={handleSync} type="button">
          {syncMutation.isPending ? 'Syncing' : 'Sync'}
        </button>
        <button className="rm-button" disabled={!voiceProfileId || previewMutation.isPending} onClick={handlePreview} type="button">
          {previewMutation.isPending ? 'Previewing' : 'Preview'}
        </button>
        <button className="rm-button" disabled={!activeAgent || !voiceProfileId || bindMutation.isPending} onClick={handleBind} type="button">
          {bindMutation.isPending ? 'Binding' : 'Bind voice'}
        </button>
      </div>
      {notice ? <div className="mt-3 text-sm text-muted">{notice}</div> : null}
      {previewArtifact ? (
        <div className="mt-3 grid gap-2 text-xs text-muted">
          <span>{formatSpeechArtifact(previewArtifact)}</span>
          {previewArtifact.playbackUrl ? <audio className="w-full" controls preload="metadata" src={previewArtifact.playbackUrl} /> : null}
        </div>
      ) : null}
    </section>
  )
}

function formatSpeechArtifact(artifact: SpeechArtifact): string {
  if (artifact.durationMs === undefined) return artifact.contentType
  return `${artifact.contentType} · ${Math.round(artifact.durationMs / 1000)}s`
}
