import type { SpeechRequest, SpeechSynthesisArtifact, TranscriptionRequest, TranscriptionResult, VoiceProfile, VoiceProvider } from './types'

export class DisabledVoiceProvider implements VoiceProvider {
  async listVoices(_orgId: string): Promise<VoiceProfile[]> {
    return []
  }

  async synthesize(_request: SpeechRequest): Promise<SpeechSynthesisArtifact> {
    throw new Error('Voice synthesis is not configured.')
  }

  async transcribe(_request: TranscriptionRequest): Promise<TranscriptionResult> {
    throw new Error('Voice transcription is not configured.')
  }
}

export const disabledVoiceProvider = new DisabledVoiceProvider()
