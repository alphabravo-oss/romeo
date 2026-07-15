import { apiJson } from './http'
import type { Agent, Envelope, SpeechArtifact, TranscriptionResult, VoiceCatalogSyncResult, VoiceProfile } from './types'

export async function listVoices(): Promise<VoiceProfile[]> {
  const response = await apiJson<Envelope<VoiceProfile[]>>('/api/v1/voices')
  return response.data
}

export async function syncVoices(): Promise<VoiceCatalogSyncResult> {
  const response = await apiJson<Envelope<VoiceCatalogSyncResult>>('/api/v1/voices/sync', { method: 'POST' })
  return response.data
}

export async function previewVoice(input: { voiceProfileId: string; text: string }): Promise<SpeechArtifact> {
  const response = await apiJson<Envelope<SpeechArtifact>>(`/api/v1/voices/${encodeURIComponent(input.voiceProfileId)}/preview`, {
    method: 'POST',
    body: JSON.stringify({ text: input.text })
  })
  return response.data
}

export async function generateMessageSpeech(input: { messageId: string; voiceProfileId: string }): Promise<SpeechArtifact> {
  const response = await apiJson<Envelope<SpeechArtifact>>(`/api/v1/messages/${encodeURIComponent(input.messageId)}/speech`, {
    method: 'POST',
    body: JSON.stringify({ voiceProfileId: input.voiceProfileId })
  })
  return response.data
}

export async function transcribeVoice(input: { audioBase64: string; contentType: string; fileName?: string }): Promise<TranscriptionResult> {
  const response = await apiJson<Envelope<TranscriptionResult>>('/api/v1/voice/transcriptions', {
    method: 'POST',
    body: JSON.stringify(input)
  })
  return response.data
}

export async function bindAgentVoice(input: { agentId: string; voiceProfileId: string }): Promise<Agent> {
  const response = await apiJson<Envelope<Agent>>(`/api/v1/agents/${encodeURIComponent(input.agentId)}/voice`, {
    method: 'POST',
    body: JSON.stringify({ voiceProfileId: input.voiceProfileId })
  })
  return response.data
}
