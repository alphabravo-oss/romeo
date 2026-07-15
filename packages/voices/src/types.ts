export interface VoiceProfile {
  id: string
  providerId: string
  providerVoiceId?: string
  name: string
  language: string
  styleTags: string[]
  cloningAllowed: boolean
}

export interface SpeechRequest {
  orgId: string
  voiceId: string
  text: string
  format: 'mp3' | 'wav' | 'ogg'
}

export interface SpeechArtifact {
  id: string
  contentType: string
  storageKey: string
  durationMs?: number
  playbackUrl?: string
}

export interface SpeechSynthesisArtifact extends SpeechArtifact {
  body?: Uint8Array
}

export interface TranscriptionRequest {
  orgId: string
  audio: Uint8Array
  contentType: string
  fileName?: string
  language?: string
  prompt?: string
}

export interface TranscriptionResult {
  text: string
  language?: string
  durationMs?: number
}

export interface VoiceProvider {
  listVoices(orgId: string): Promise<VoiceProfile[]>
  synthesize(request: SpeechRequest): Promise<SpeechSynthesisArtifact>
  transcribe(request: TranscriptionRequest): Promise<TranscriptionResult>
}
