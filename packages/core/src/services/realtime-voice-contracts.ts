export type RealtimeAdapterKind = "native" | "pipeline";
export type VadMode = "client" | "server";

export function selectRealtimeAdapter(input: {
  nativeAvailable: boolean;
  pipelineAvailable: boolean;
}):
  | { outcome: "accepted"; adapter: RealtimeAdapterKind }
  | { outcome: "denied"; code: "realtime_runtime_uninstalled"; fallback: "batch_stt_tts" } {
  if (input.nativeAvailable) return { outcome: "accepted", adapter: "native" };
  if (input.pipelineAvailable) return { outcome: "accepted", adapter: "pipeline" };
  return {
    outcome: "denied",
    code: "realtime_runtime_uninstalled",
    fallback: "batch_stt_tts",
  };
}

export function authorizeVadInterruption(input: {
  mode: VadMode;
  sensitivity: number;
  bargeIn: boolean;
  rawAudioRetained: boolean;
}):
  | {
      outcome: "accepted";
      cancelTts: boolean;
      audit: { interrupted: boolean; audioStored: false };
    }
  | { outcome: "denied"; code: "realtime_runtime_uninstalled" } {
  if (input.rawAudioRetained)
    return { outcome: "denied", code: "realtime_runtime_uninstalled" };
  const sensitivity = Math.min(Math.max(input.sensitivity, 0), 1);
  return {
    outcome: "accepted",
    cancelTts: input.bargeIn,
    audit: { interrupted: input.bargeIn, audioStored: false },
  };
}

export function scanCommittedTranscriptWindow(input: {
  committed: string;
  highSecurity: boolean;
  policyCleared: boolean;
}):
  | { outcome: "release"; text: string }
  | { outcome: "hold" }
  | { outcome: "block"; code: "firewall_output_blocked" } {
  if (input.highSecurity && !input.policyCleared) return { outcome: "hold" };
  if (/\bsk-[A-Za-z0-9_-]{16,}\b/u.test(input.committed))
    return { outcome: "block", code: "firewall_output_blocked" };
  return { outcome: "release", text: input.committed };
}

export function pauseRealtimeForToolApproval(input: {
  approvalRequired: boolean;
  voiceConfirmed: boolean;
}):
  | { outcome: "pause"; audio: "paused" }
  | { outcome: "continue" }
  | { outcome: "denied"; code: "content_policy_approval_required" } {
  if (!input.approvalRequired) return { outcome: "continue" };
  if (input.voiceConfirmed)
    return { outcome: "denied", code: "content_policy_approval_required" };
  return { outcome: "pause", audio: "paused" };
}

export function negotiateRealtimeQuality(input: {
  language?: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  sampleRateHz: number;
  captions: boolean;
}): {
  language: string;
  noiseSuppression: boolean;
  echoCancellation: boolean;
  sampleRateHz: number;
  captions: boolean;
} {
  const allowed = new Set([8_000, 16_000, 24_000, 48_000]);
  return {
    language: (input.language ?? "en").slice(0, 16),
    noiseSuppression: input.noiseSuppression,
    echoCancellation: input.echoCancellation,
    sampleRateHz: allowed.has(input.sampleRateHz) ? input.sampleRateHz : 16_000,
    captions: input.captions,
  };
}

export function meterRealtimeUsage(input: {
  inputSeconds: number;
  outputSeconds: number;
  sttSeconds: number;
  ttsSeconds: number;
  interruptedSeconds: number;
  modelMicroUsd: number;
}): {
  inputSeconds: number;
  outputSeconds: number;
  sttSeconds: number;
  ttsSeconds: number;
  interruptionWasteSeconds: number;
  estimatedMicroUsd: number;
} {
  const clamp = (value: number) => Math.max(0, Math.min(value, 86_400));
  return {
    inputSeconds: clamp(input.inputSeconds),
    outputSeconds: clamp(input.outputSeconds),
    sttSeconds: clamp(input.sttSeconds),
    ttsSeconds: clamp(input.ttsSeconds),
    interruptionWasteSeconds: clamp(input.interruptedSeconds),
    estimatedMicroUsd: Math.max(0, Math.trunc(input.modelMicroUsd)),
  };
}
