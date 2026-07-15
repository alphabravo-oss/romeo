import type { SpeechRequest, SpeechSynthesisArtifact, TranscriptionRequest, TranscriptionResult, VoiceProfile, VoiceProvider } from './types'

export interface OpenAICompatibleVoiceDefinition {
  id: string
  name?: string
  language?: string
  styleTags?: string[]
}

export interface OpenAICompatibleVoiceProviderOptions {
  apiKey: string
  baseUrl: string
  model: string
  transcriptionModel?: string
  voices?: OpenAICompatibleVoiceDefinition[]
  timeoutMs?: number
  fetchImpl?: typeof fetch
}

export class OpenAICompatibleVoiceProvider implements VoiceProvider {
  private readonly fetchImpl: typeof fetch
  private readonly timeoutMs: number
  private readonly voices: OpenAICompatibleVoiceDefinition[]

  constructor(private readonly options: OpenAICompatibleVoiceProviderOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch
    this.timeoutMs = options.timeoutMs ?? 30_000
    this.voices = options.voices ?? []
  }

  async listVoices(orgId: string): Promise<VoiceProfile[]> {
    return this.voices.map((voice) => ({
      id: `openai_voice_${safeProfilePart(orgId)}_${safeProfilePart(voice.id)}`,
      providerId: 'voice_openai_compatible',
      providerVoiceId: voice.id,
      name: voice.name ?? voice.id,
      language: voice.language ?? 'en',
      styleTags: voice.styleTags ?? ['openai-compatible'],
      cloningAllowed: false
    }))
  }

  async synthesize(request: SpeechRequest): Promise<SpeechSynthesisArtifact> {
    if (this.options.apiKey.length === 0 || this.options.model.length === 0 || this.options.baseUrl.length === 0) {
      throw new Error('OpenAI-compatible voice provider is not configured.')
    }

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(speechUrl(this.options.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`,
          'content-type': 'application/json'
        },
        body: JSON.stringify({
          model: this.options.model,
          voice: request.voiceId,
          input: request.text,
          response_format: request.format
        }),
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`Voice synthesis failed with ${response.status}.`)

      const bytes = new Uint8Array(await response.arrayBuffer())
      if (bytes.byteLength === 0) throw new Error('Voice synthesis returned an empty artifact.')

      const id = crypto.randomUUID()
      const contentType = audioContentType(response.headers.get('content-type'), request.format)
      return {
        id,
        contentType,
        storageKey: `openai-voice/${safeProfilePart(request.orgId)}/${safeProfilePart(request.voiceId)}/${id}.${extensionForFormat(request.format)}`,
        body: bytes
      }
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') throw new Error('Voice synthesis timed out.')
      throw caught
    } finally {
      clearTimeout(timeout)
    }
  }

  async transcribe(request: TranscriptionRequest): Promise<TranscriptionResult> {
    const model = this.options.transcriptionModel ?? 'whisper-1'
    if (this.options.apiKey.length === 0 || model.length === 0 || this.options.baseUrl.length === 0) {
      throw new Error('OpenAI-compatible voice transcription provider is not configured.')
    }

    const form = new FormData()
    form.append('model', model)
    form.append('file', new Blob([plainArrayBuffer(request.audio)], { type: request.contentType }), safeFileName(request.fileName, request.contentType))
    if (request.language !== undefined) form.append('language', request.language)
    if (request.prompt !== undefined) form.append('prompt', request.prompt)

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), this.timeoutMs)
    try {
      const response = await this.fetchImpl(transcriptionsUrl(this.options.baseUrl), {
        method: 'POST',
        headers: {
          authorization: `Bearer ${this.options.apiKey}`
        },
        body: form,
        signal: controller.signal
      })
      if (!response.ok) throw new Error(`Voice transcription failed with ${response.status}.`)
      const payload = await response.json()
      const text = typeof payload.text === 'string' ? payload.text.trim() : ''
      if (text.length === 0) throw new Error('Voice transcription returned empty text.')
      const language = typeof payload.language === 'string' && payload.language.length > 0 ? payload.language : request.language
      const durationMs = typeof payload.duration === 'number' && Number.isFinite(payload.duration) ? Math.max(0, Math.round(payload.duration * 1000)) : undefined
      return {
        text,
        ...(language === undefined ? {} : { language }),
        ...(durationMs === undefined ? {} : { durationMs })
      }
    } catch (caught) {
      if (caught instanceof Error && caught.name === 'AbortError') throw new Error('Voice transcription timed out.')
      throw caught
    } finally {
      clearTimeout(timeout)
    }
  }
}

export function parseOpenAICompatibleVoiceCatalog(value: string): OpenAICompatibleVoiceDefinition[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
    .map((item) => {
      const [id, name] = item.split('=')
      const voiceId = id?.trim() ?? ''
      return { id: voiceId, ...(name === undefined || name.trim().length === 0 ? {} : { name: name.trim() }) }
    })
    .filter((voice) => /^[A-Za-z0-9_-]+$/u.test(voice.id))
}

function speechUrl(baseUrl: string): string {
  return audioEndpointUrl(baseUrl, 'speech')
}

function transcriptionsUrl(baseUrl: string): string {
  return audioEndpointUrl(baseUrl, 'transcriptions')
}

function audioEndpointUrl(baseUrl: string, endpoint: 'speech' | 'transcriptions'): string {
  const url = new URL(baseUrl)
  if (!['http:', 'https:'].includes(url.protocol) || url.username.length > 0 || url.password.length > 0 || url.search.length > 0 || url.hash.length > 0) {
    throw new Error('OpenAI-compatible voice base URL must be an http(s) origin or versioned API path without credentials, query, or fragment.')
  }
  if (url.protocol === 'http:' && !isLocalHostname(url.hostname)) throw new Error('OpenAI-compatible voice base URL must use HTTPS outside localhost.')
  const prefix = url.pathname.replace(/\/+$/u, '')
  url.pathname = `${prefix}/audio/${endpoint}`
  return url.toString()
}

function audioContentType(contentType: string | null, format: SpeechRequest['format']): string {
  if (contentType?.startsWith('audio/') === true) return contentType.split(';')[0] ?? contentType
  if (format === 'mp3') return 'audio/mpeg'
  if (format === 'ogg') return 'audio/ogg'
  return 'audio/wav'
}

function extensionForFormat(format: SpeechRequest['format']): string {
  return format === 'mp3' ? 'mp3' : format === 'ogg' ? 'ogg' : 'wav'
}

function safeProfilePart(value: string): string {
  return value.replace(/[^A-Za-z0-9_-]/gu, '_').slice(0, 80)
}

function safeFileName(fileName: string | undefined, contentType: string): string {
  const candidate = fileName?.replace(/[^A-Za-z0-9_.-]/gu, '_').slice(0, 120)
  if (candidate !== undefined && candidate.length > 0) return candidate
  if (contentType === 'audio/mpeg') return 'audio.mp3'
  if (contentType === 'audio/ogg') return 'audio.ogg'
  if (contentType === 'audio/webm') return 'audio.webm'
  if (contentType === 'audio/mp4' || contentType === 'video/mp4') return 'audio.mp4'
  return 'audio.wav'
}

function plainArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  const buffer = new ArrayBuffer(bytes.byteLength)
  new Uint8Array(buffer).set(bytes)
  return buffer
}

function isLocalHostname(hostname: string): boolean {
  return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1'
}
