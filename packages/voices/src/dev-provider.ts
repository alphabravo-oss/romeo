import type { SpeechRequest, SpeechSynthesisArtifact, TranscriptionRequest, TranscriptionResult, VoiceProfile, VoiceProvider } from './types'

export class DevVoiceProvider implements VoiceProvider {
  async listVoices(orgId: string): Promise<VoiceProfile[]> {
    return [
      {
        id: `dev_voice_${orgId}`,
        providerId: 'voice_dev',
        providerVoiceId: 'dev',
        name: 'Development voice',
        language: 'en',
        styleTags: ['dev', 'neutral'],
        cloningAllowed: false
      }
    ]
  }

  async synthesize(request: SpeechRequest): Promise<SpeechSynthesisArtifact> {
    const id = crypto.randomUUID()
    const durationMs = estimateDurationMs(request.text)
    const body = request.format === 'wav' ? createWavTone(durationMs) : undefined
    return {
      id,
      contentType: request.format === 'mp3' ? 'audio/mpeg' : `audio/${request.format}`,
      storageKey: `dev-voice/${request.orgId}/${request.voiceId}/${id}.${request.format}`,
      durationMs,
      ...(body === undefined ? {} : { body })
    }
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    return {
      text: `Development transcription (${request.audio.byteLength} bytes)`,
      language: request.language ?? 'en'
    }
  }
}

function estimateDurationMs(text: string): number {
  return Math.max(500, Math.min(15_000, text.trim().length * 45))
}

function createWavTone(durationMs: number): Uint8Array {
  const sampleRate = 8000
  const bytesPerSample = 2
  const samples = Math.max(1, Math.floor((durationMs / 1000) * sampleRate))
  const dataSize = samples * bytesPerSample
  const bytes = new Uint8Array(44 + dataSize)
  const view = new DataView(bytes.buffer)
  writeAscii(bytes, 0, 'RIFF')
  view.setUint32(4, 36 + dataSize, true)
  writeAscii(bytes, 8, 'WAVE')
  writeAscii(bytes, 12, 'fmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, sampleRate, true)
  view.setUint32(28, sampleRate * bytesPerSample, true)
  view.setUint16(32, bytesPerSample, true)
  view.setUint16(34, 8 * bytesPerSample, true)
  writeAscii(bytes, 36, 'data')
  view.setUint32(40, dataSize, true)
  for (let index = 0; index < samples; index += 1) {
    const fade = Math.min(1, index / 400, (samples - index) / 400)
    const sample = Math.sin((2 * Math.PI * 440 * index) / sampleRate) * 2400 * fade
    view.setInt16(44 + index * bytesPerSample, sample, true)
  }
  return bytes
}

function writeAscii(bytes: Uint8Array, offset: number, value: string): void {
  for (let index = 0; index < value.length; index += 1) {
    bytes[offset + index] = value.charCodeAt(index)
  }
}

export const devVoiceProvider = new DevVoiceProvider()
