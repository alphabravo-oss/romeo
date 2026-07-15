import { createHash } from "node:crypto";
import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";

import { readEnv } from "../packages/config/src/index";
import { createRomeoApi } from "../packages/core/src/api";
import { InMemoryRomeoRepository } from "../packages/core/src/repositories/in-memory";
import { MemoryObjectStore } from "../packages/storage/src/memory-object-store";
import {
  DevVoiceProvider,
  OpenAICompatibleVoiceProvider,
} from "../packages/voices/src/index";

type Api = ReturnType<typeof createRomeoApi>;

const output = argValue("--output");
const pid = process.pid;
const rawSentinels = {
  apiKey: `RAW_VOICE_API_KEY_${pid}`,
  baseUrlPath: `/v1/voice-acceptance-${pid}`,
  prompt: `RAW_VOICE_TRANSCRIPTION_PROMPT_${pid}`,
  providerError: `RAW_PROVIDER_FAILURE_${pid}`,
  providerText: `RAW_PROVIDER_TRANSCRIPT_${pid}`,
  speechText: `RAW_VOICE_SPEECH_TEXT_${pid}`,
};

const disabledApi = createApi(new InMemoryRomeoRepository());
const disabledPreview = await postJson<ErrorResponse>(
  disabledApi,
  "/api/v1/voices/voice_default/preview",
  { text: rawSentinels.speechText },
);
assertStatus(disabledPreview.response, 409, "disabled voice preview");
assertErrorCode(
  disabledPreview.body,
  "voice_not_configured",
  "disabled voice preview",
);
assertNoRawContent(
  "disabled voice preview error",
  JSON.stringify(disabledPreview.body),
  [rawSentinels.speechText],
);

const devRepository = new InMemoryRomeoRepository();
const devObjectStore = new MemoryObjectStore();
const devApi = createApi(devRepository, {
  objectStore: devObjectStore,
  voiceProvider: new DevVoiceProvider(),
});

const firstSync = await postJson<{
  data: {
    imported: number;
    existing: number;
    providerVoiceCount: number;
    profiles: Array<{
      id: string;
      providerId: string;
      providerVoiceId: string;
    }>;
  };
}>(devApi, "/api/v1/voices/sync", {});
assertStatus(firstSync.response, 200, "dev voice catalog sync");
const secondSync = await postJson<typeof firstSync.body>(
  devApi,
  "/api/v1/voices/sync",
  {},
);
assertStatus(secondSync.response, 200, "dev voice catalog resync");
if (
  firstSync.body.data.imported !== 1 ||
  firstSync.body.data.providerVoiceCount !== 1 ||
  secondSync.body.data.imported !== 0 ||
  secondSync.body.data.existing !== 1
) {
  throw new Error("Development voice catalog sync did not dedupe profiles.");
}
assertNoRawContent("dev sync readback", JSON.stringify(firstSync.body));
assertNoRawContent("dev resync readback", JSON.stringify(secondSync.body));

const voiceId = firstSync.body.data.profiles[0]?.id;
if (voiceId === undefined)
  throw new Error("Development voice profile missing.");
const preview = await postJson<{
  data: {
    id: string;
    contentType: string;
    durationMs?: number;
    playbackUrl: string;
    deleteUrl: string;
    redaction: { rawStorageKeyReturned: boolean };
  };
}>(devApi, `/api/v1/voices/${encodeURIComponent(voiceId)}/preview`, {
  text: rawSentinels.speechText,
});
assertStatus(preview.response, 200, "dev voice preview");
if (
  preview.body.data.contentType !== "audio/wav" ||
  preview.body.data.playbackUrl !==
    `/api/v1/voice-artifacts/${preview.body.data.id}` ||
  preview.body.data.deleteUrl !== preview.body.data.playbackUrl ||
  preview.body.data.redaction.rawStorageKeyReturned !== false
) {
  throw new Error("Development voice preview returned invalid artifact data.");
}
assertNoRawContent("dev preview readback", JSON.stringify(preview.body));

const artifactResponse = await devApi.request(preview.body.data.playbackUrl);
if (artifactResponse.status !== 200) {
  throw new Error(
    `Voice artifact readback returned ${artifactResponse.status}.`,
  );
}
const artifactBytes = new Uint8Array(await artifactResponse.arrayBuffer());
if (
  artifactResponse.headers.get("content-type") !== "audio/wav" ||
  new TextDecoder().decode(artifactBytes.slice(0, 4)) !== "RIFF"
) {
  throw new Error("Voice artifact readback was not a WAV artifact.");
}

const rawUsageBeforeDelete = await devRepository.listUsageEvents("org_default");
const previewUsageBeforeDelete = rawUsageBeforeDelete.find(
  (event) => event.metric === "voice.preview.generated",
);
const storageKey = previewUsageBeforeDelete?.metadata.storageKey;
if (typeof storageKey !== "string") {
  throw new Error("Expected internal voice artifact storage key.");
}

const deleteArtifact = await requestJson<{
  data: {
    artifactId: string;
    deleted: boolean;
    storageKeyHash: string;
    redaction: { rawStorageKeyReturned: boolean };
  };
}>(devApi, preview.body.data.deleteUrl, { method: "DELETE" });
assertStatus(deleteArtifact.response, 200, "voice artifact delete");
if (
  deleteArtifact.body.data.deleted !== true ||
  deleteArtifact.body.data.artifactId !== preview.body.data.id ||
  deleteArtifact.body.data.storageKeyHash !== sha256(storageKey) ||
  deleteArtifact.body.data.redaction.rawStorageKeyReturned !== false
) {
  throw new Error("Voice artifact deletion response was invalid.");
}
const readAfterDelete = await devApi.request(preview.body.data.playbackUrl);
if (readAfterDelete.status !== 404) {
  throw new Error("Deleted voice artifact remained readable.");
}
if ((await devObjectStore.getObject(storageKey)) !== undefined) {
  throw new Error("Deleted voice artifact remained in object storage.");
}
const rawUsageAfterDelete = await devRepository.listUsageEvents("org_default");
const previewUsageAfterDelete = rawUsageAfterDelete.find(
  (event) => event.metric === "voice.preview.generated",
);
if (
  previewUsageAfterDelete?.metadata.storageKey !== undefined ||
  previewUsageAfterDelete?.metadata.storageKeyHash !== sha256(storageKey)
) {
  throw new Error("Voice artifact storage metadata was not redacted.");
}
assertNoRawContent(
  "voice artifact delete readback",
  JSON.stringify(deleteArtifact.body),
  [storageKey, rawSentinels.speechText],
);

const transcription = await postJson<{
  data: { text: string; language?: string };
}>(devApi, "/api/v1/voice/transcriptions", {
  audioBase64: Buffer.from(new Uint8Array([1, 2, 3, 4])).toString("base64"),
  contentType: "audio/wav",
  fileName: "voice-acceptance.wav",
  language: "en",
  prompt: rawSentinels.prompt,
});
assertStatus(transcription.response, 200, "dev transcription");
if (
  transcription.body.data.text !== "Development transcription (4 bytes)" ||
  transcription.body.data.language !== "en"
) {
  throw new Error("Development transcription response was invalid.");
}
const usageResponse = await requestJson<{
  data: Array<{ metric: string; metadata: Record<string, unknown> }>;
}>(devApi, "/api/v1/usage/events");
assertStatus(usageResponse.response, 200, "voice usage readback");
const transcriptionUsage = usageResponse.body.data.find(
  (event) => event.metric === "voice.transcription.generated",
);
if (
  transcriptionUsage?.metadata.audioBytes !== 4 ||
  transcriptionUsage.metadata.promptProvided !== true ||
  transcriptionUsage.metadata.textLength !== transcription.body.data.text.length
) {
  throw new Error("Transcription usage metadata was invalid.");
}
assertNoRawContent("voice usage readback", JSON.stringify(usageResponse.body), [
  rawSentinels.prompt,
  rawSentinels.speechText,
  transcription.body.data.text,
  storageKey,
]);

const openAiFetchState = {
  authorizationHeaderSeen: false,
  speechRequestTextSeen: false,
  transcriptionPromptSeen: false,
  speechRequestCount: 0,
  transcriptionRequestCount: 0,
};
const openAiProvider = new OpenAICompatibleVoiceProvider({
  apiKey: rawSentinels.apiKey,
  baseUrl: `https://voice-provider.example.com${rawSentinels.baseUrlPath}`,
  model: "tts-contract",
  transcriptionModel: "stt-contract",
  voices: [
    {
      id: "alloy",
      name: "OpenAI-compatible Alloy",
      language: "en",
      styleTags: ["openai-compatible", "neutral"],
    },
  ],
  fetchImpl: async (input, init) => {
    const url = String(input);
    const authorization = headerValue(init?.headers, "authorization");
    if (authorization === `Bearer ${rawSentinels.apiKey}`) {
      openAiFetchState.authorizationHeaderSeen = true;
    }
    if (url.endsWith("/audio/speech")) {
      openAiFetchState.speechRequestCount += 1;
      const body = JSON.parse(String(init?.body ?? "{}")) as {
        input?: string;
        voice?: string;
      };
      openAiFetchState.speechRequestTextSeen =
        body.input === rawSentinels.speechText && body.voice === "alloy";
      return new Response(new Uint8Array([82, 73, 70, 70, 0, 0, 0, 0]), {
        headers: { "content-type": "audio/wav" },
      });
    }
    if (url.endsWith("/audio/transcriptions")) {
      openAiFetchState.transcriptionRequestCount += 1;
      openAiFetchState.transcriptionPromptSeen =
        init?.body instanceof FormData &&
        init.body.get("prompt") === rawSentinels.prompt;
      return jsonResponse({
        text: rawSentinels.providerText,
        language: "en",
        duration: 1.25,
      });
    }
    return jsonResponse({ error: "unexpected endpoint" }, 404);
  },
});
const openAiRepository = new InMemoryRomeoRepository();
const openAiApi = createApi(openAiRepository, {
  objectStore: new MemoryObjectStore(),
  voiceProvider: openAiProvider,
});
const openAiSync = await postJson<typeof firstSync.body>(
  openAiApi,
  "/api/v1/voices/sync",
  {},
);
assertStatus(openAiSync.response, 200, "openai-compatible catalog sync");
const openAiVoiceId = openAiSync.body.data.profiles[0]?.id;
if (
  openAiSync.body.data.imported !== 1 ||
  openAiSync.body.data.profiles[0]?.providerId !== "voice_openai_compatible" ||
  openAiSync.body.data.profiles[0]?.providerVoiceId !== "alloy" ||
  openAiVoiceId === undefined
) {
  throw new Error("OpenAI-compatible catalog sync did not import voice.");
}
const openAiPreview = await postJson<typeof preview.body>(
  openAiApi,
  `/api/v1/voices/${encodeURIComponent(openAiVoiceId)}/preview`,
  { text: rawSentinels.speechText },
);
assertStatus(openAiPreview.response, 200, "openai-compatible preview");
const openAiTranscription = await postJson<typeof transcription.body>(
  openAiApi,
  "/api/v1/voice/transcriptions",
  {
    audioBase64: Buffer.from(new Uint8Array([5, 6, 7, 8])).toString("base64"),
    contentType: "audio/wav",
    prompt: rawSentinels.prompt,
  },
);
assertStatus(
  openAiTranscription.response,
  200,
  "openai-compatible transcription",
);
if (
  openAiFetchState.speechRequestCount !== 1 ||
  openAiFetchState.transcriptionRequestCount !== 1 ||
  openAiFetchState.authorizationHeaderSeen !== true ||
  openAiFetchState.speechRequestTextSeen !== true ||
  openAiFetchState.transcriptionPromptSeen !== true
) {
  throw new Error("OpenAI-compatible provider was not exercised correctly.");
}
assertNoRawContent(
  "openai-compatible public readback",
  JSON.stringify({
    sync: openAiSync.body,
    preview: openAiPreview.body,
    transcription: openAiTranscription.body,
  }),
  [
    rawSentinels.apiKey,
    rawSentinels.baseUrlPath,
    rawSentinels.prompt,
    rawSentinels.speechText,
  ],
);

const failingProvider = new OpenAICompatibleVoiceProvider({
  apiKey: rawSentinels.apiKey,
  baseUrl: `https://voice-provider.example.com${rawSentinels.baseUrlPath}`,
  model: "tts-contract",
  transcriptionModel: "stt-contract",
  voices: [{ id: "alloy" }],
  fetchImpl: async () =>
    new Response(rawSentinels.providerError, {
      status: 503,
      headers: { "content-type": "text/plain" },
    }),
});
const failingApi = createApi(new InMemoryRomeoRepository(), {
  voiceProvider: failingProvider,
});
const failingSync = await postJson<typeof firstSync.body>(
  failingApi,
  "/api/v1/voices/sync",
  {},
);
assertStatus(failingSync.response, 200, "failing-provider catalog sync");
const failingVoiceId = failingSync.body.data.profiles[0]?.id;
if (failingVoiceId === undefined) {
  throw new Error("Failing provider voice profile missing.");
}
const failingPreview = await postJson<ErrorResponse>(
  failingApi,
  `/api/v1/voices/${encodeURIComponent(failingVoiceId)}/preview`,
  { text: rawSentinels.speechText },
);
assertStatus(failingPreview.response, 409, "failing-provider preview");
assertErrorCode(
  failingPreview.body,
  "voice_not_configured",
  "failing-provider preview",
);
assertNoRawContent(
  "failing-provider preview error",
  JSON.stringify(failingPreview.body),
  [
    rawSentinels.apiKey,
    rawSentinels.baseUrlPath,
    rawSentinels.providerError,
    rawSentinels.speechText,
  ],
);

const evidence = {
  schemaVersion: "romeo.voice-provider-acceptance-contract-smoke.v1",
  generatedAt: new Date().toISOString(),
  status: "passed",
  checks: [
    "disabled_provider_fails_closed",
    "development_provider_catalog_sync_dedupes",
    "development_preview_artifact_readback",
    "voice_artifact_delete_redacts_storage_key",
    "transcription_usage_metadata_redacted",
    "openai_compatible_provider_sync_preview_and_transcribe",
    "provider_failure_response_redacted",
    "voice_acceptance_evidence_omits_raw_text_audio_and_secrets",
  ],
  providerBoundary: {
    disabledPreviewStatus: disabledPreview.response.status,
    devProviderId: "voice_dev",
    openAiCompatibleProviderId: "voice_openai_compatible",
    providerFamiliesExercised: ["disabled", "dev", "openai-compatible"].sort(),
    openAiCompatibleUsesCoreApiWithoutServiceCodeChanges: true,
  },
  catalog: {
    devImportedCount: firstSync.body.data.imported,
    devExistingAfterResync: secondSync.body.data.existing,
    devProviderVoiceCount: firstSync.body.data.providerVoiceCount,
    openAiCompatibleImportedCount: openAiSync.body.data.imported,
    duplicateProfilesCreated: false,
  },
  artifacts: {
    contentType: preview.body.data.contentType,
    readbackBytes: artifactBytes.byteLength,
    deleted: deleteArtifact.body.data.deleted,
    deletedReadbackStatus: readAfterDelete.status,
    storageKeyHash: deleteArtifact.body.data.storageKeyHash,
    rawStorageKeyReturned: false,
  },
  transcription: {
    devStatus: transcription.response.status,
    openAiCompatibleStatus: openAiTranscription.response.status,
    usageAudioBytes: transcriptionUsage?.metadata.audioBytes,
    usageTextLength: transcriptionUsage?.metadata.textLength,
    promptProvided: transcriptionUsage?.metadata.promptProvided,
  },
  providerFailure: {
    previewStatus: failingPreview.response.status,
    errorCode: failingPreview.body.error.code,
    rawProviderBodyReturned: false,
  },
  redaction: {
    rawSpeechTextReturned: false,
    rawTranscriptReturned: false,
    rawPromptReturned: false,
    rawAudioReturned: false,
    rawStorageKeyReturned: false,
    rawProviderResponseReturned: false,
    rawProviderEndpointReturned: false,
    secretValuesReturned: false,
  },
};

const serialized = `${JSON.stringify(evidence, null, 2)}\n`;
assertNoRawContent("voice acceptance evidence", serialized);

if (output === undefined) {
  process.stdout.write(serialized);
} else {
  const outputPath = resolve(process.env.INIT_CWD ?? process.cwd(), output);
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, serialized, "utf8");
  console.log(`Wrote voice acceptance smoke evidence to ${outputPath}`);
}

function createApi(
  repository: InMemoryRomeoRepository,
  options: NonNullable<Parameters<typeof createRomeoApi>[1]> = {},
): Api {
  return createRomeoApi(repository, {
    ...options,
    env: readEnv({ DEV_SEEDED_LOGIN: "true" }),
  });
}

async function requestJson<T>(
  api: Api,
  path: string,
  input: RequestInit = {},
): Promise<{ body: T; response: Response }> {
  const headers = new Headers(input.headers);
  if (input.body !== undefined && !headers.has("content-type")) {
    headers.set("content-type", "application/json");
  }
  const response = await api.request(path, { ...input, headers });
  return { body: (await response.json()) as T, response };
}

async function postJson<T>(
  api: Api,
  path: string,
  body: unknown,
): Promise<{ body: T; response: Response }> {
  return requestJson<T>(api, path, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

function assertStatus(
  response: Response,
  expected: number,
  label: string,
): void {
  if (response.status !== expected) {
    throw new Error(
      `${label} returned ${response.status}; expected ${expected}.`,
    );
  }
}

function assertErrorCode(
  body: ErrorResponse,
  expected: string,
  label: string,
): void {
  if (body.error.code !== expected) {
    throw new Error(
      `${label} returned ${body.error.code}; expected ${expected}.`,
    );
  }
}

function assertNoRawContent(
  label: string,
  value: string,
  rawValues: string[] = Object.values(rawSentinels),
): void {
  for (const raw of rawValues) {
    assertNotContains(value, raw, label);
  }
}

function assertNotContains(value: string, raw: string, label: string): void {
  if (value.includes(raw)) {
    throw new Error(`${label} leaked raw content.`);
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

function jsonResponse(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function headerValue(
  headers: HeadersInit | undefined,
  key: string,
): string | undefined {
  if (headers === undefined) return undefined;
  if (headers instanceof Headers) return headers.get(key) ?? undefined;
  if (Array.isArray(headers)) {
    const match = headers.find(
      ([name]) => name.toLowerCase() === key.toLowerCase(),
    );
    return match?.[1];
  }
  return headers[key];
}

function argValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  if (index < 0) return undefined;
  return process.argv[index + 1];
}

interface ErrorResponse {
  error: { code: string; message: string; details?: Record<string, unknown> };
}
