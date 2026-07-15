import { describe, expect, it } from 'vitest'

import { OpenAICompatibleVoiceProvider, parseOpenAICompatibleVoiceCatalog } from './openai-compatible-provider'

describe('OpenAI-compatible voice provider', () => {
  it('sends bounded speech requests and returns audio bytes without exposing the API key', async () => {
    const calls: Array<{ body: BodyInit | null | undefined; headers: HeadersInit | undefined; url: string }> = []
    const provider = new OpenAICompatibleVoiceProvider({
      apiKey: 'voice-api-key',
      baseUrl: 'https://voice.example.com/v1',
      model: 'tts-model',
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), headers: init?.headers, body: init?.body })
        return new Response(new Uint8Array([82, 73, 70, 70]), { status: 200, headers: { 'content-type': 'audio/wav; charset=binary' } })
      }
    })

    const artifact = await provider.synthesize({ orgId: 'org_default', voiceId: 'alloy', text: 'Romeo voice preview', format: 'wav' })

    expect(calls[0]?.url).toBe('https://voice.example.com/v1/audio/speech')
    expect(calls[0]?.headers).toMatchObject({ authorization: 'Bearer voice-api-key', 'content-type': 'application/json' })
    expect(JSON.parse(String(calls[0]?.body))).toEqual({
      model: 'tts-model',
      voice: 'alloy',
      input: 'Romeo voice preview',
      response_format: 'wav'
    })
    expect(artifact.contentType).toBe('audio/wav')
    expect(artifact.body).toEqual(new Uint8Array([82, 73, 70, 70]))
    expect(JSON.stringify(artifact)).not.toContain('voice-api-key')
  })

  it('requires HTTPS outside localhost and maps empty or failed artifacts to errors', async () => {
    const insecureProvider = new OpenAICompatibleVoiceProvider({
      apiKey: 'voice-api-key',
      baseUrl: 'http://voice.example.com/v1',
      model: 'tts-model',
      fetchImpl: async () => new Response(new Uint8Array([1]), { status: 200 })
    })
    await expect(insecureProvider.synthesize({ orgId: 'org_default', voiceId: 'alloy', text: 'hello', format: 'mp3' })).rejects.toThrow(
      'must use HTTPS outside localhost'
    )

    const emptyProvider = new OpenAICompatibleVoiceProvider({
      apiKey: 'voice-api-key',
      baseUrl: 'http://localhost:8080/v1',
      model: 'tts-model',
      fetchImpl: async () => new Response(new Uint8Array(), { status: 200 })
    })
    await expect(emptyProvider.synthesize({ orgId: 'org_default', voiceId: 'alloy', text: 'hello', format: 'mp3' })).rejects.toThrow(
      'empty artifact'
    )
  })

  it('sends transcription requests as multipart form data', async () => {
    const calls: Array<{ body: BodyInit | null | undefined; headers: HeadersInit | undefined; url: string }> = []
    const provider = new OpenAICompatibleVoiceProvider({
      apiKey: 'voice-api-key',
      baseUrl: 'https://voice.example.com/v1',
      model: 'tts-model',
      transcriptionModel: 'whisper-large',
      fetchImpl: async (input, init) => {
        calls.push({ url: String(input), headers: init?.headers, body: init?.body })
        return Response.json({ text: 'Transcribed Romeo audio.', language: 'en', duration: 1.25 })
      }
    })

    const result = await provider.transcribe({
      orgId: 'org_default',
      audio: new Uint8Array([1, 2, 3]),
      contentType: 'audio/wav',
      fileName: 'sample.wav',
      language: 'en',
      prompt: 'Vocabulary hint'
    })
    const body = calls[0]?.body

    expect(calls[0]?.url).toBe('https://voice.example.com/v1/audio/transcriptions')
    expect(calls[0]?.headers).toMatchObject({ authorization: 'Bearer voice-api-key' })
    expect(body).toBeInstanceOf(FormData)
    expect((body as FormData).get('model')).toBe('whisper-large')
    expect((body as FormData).get('language')).toBe('en')
    expect((body as FormData).get('prompt')).toBe('Vocabulary hint')
    expect((body as FormData).get('file')).toBeInstanceOf(Blob)
    expect(result).toEqual({ text: 'Transcribed Romeo audio.', language: 'en', durationMs: 1250 })
    expect(JSON.stringify(result)).not.toContain('voice-api-key')
  })

  it('parses a compact configured voice catalog', async () => {
    const voices = parseOpenAICompatibleVoiceCatalog('alloy=Alloy, echo=Echo, bad/path=Bad')
    const provider = new OpenAICompatibleVoiceProvider({
      apiKey: 'voice-api-key',
      baseUrl: 'https://voice.example.com/v1',
      model: 'tts-model',
      voices,
      fetchImpl: async () => new Response(new Uint8Array([1]), { status: 200 })
    })

    await expect(provider.listVoices('org/default')).resolves.toEqual([
      {
        id: 'openai_voice_org_default_alloy',
        providerId: 'voice_openai_compatible',
        providerVoiceId: 'alloy',
        name: 'Alloy',
        language: 'en',
        styleTags: ['openai-compatible'],
        cloningAllowed: false
      },
      {
        id: 'openai_voice_org_default_echo',
        providerId: 'voice_openai_compatible',
        providerVoiceId: 'echo',
        name: 'Echo',
        language: 'en',
        styleTags: ['openai-compatible'],
        cloningAllowed: false
      }
    ])
  })
})
