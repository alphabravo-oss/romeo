export type RealtimeRetention = "none" | "transcript_only" | "audio_governed";

export interface RealtimeSessionRequest {
  platformDisabled: boolean;
  gatewayInstalled: boolean;
  retention: RealtimeRetention;
  durationSeconds: number;
  maxDurationSeconds: number;
}

export type RealtimeSessionDecision =
  | {
      outcome: "accepted";
      retention: RealtimeRetention;
      fallback: "none";
    }
  | {
      outcome: "denied";
      code: "capability_platform_disabled" | "realtime_runtime_uninstalled";
      fallback: "batch_stt_tts";
    };

export function authorizeRealtimeSession(
  request: RealtimeSessionRequest,
): RealtimeSessionDecision {
  if (request.platformDisabled)
    return {
      outcome: "denied",
      code: "capability_platform_disabled",
      fallback: "batch_stt_tts",
    };
  if (!request.gatewayInstalled || request.durationSeconds > request.maxDurationSeconds)
    return {
      outcome: "denied",
      code: "realtime_runtime_uninstalled",
      fallback: "batch_stt_tts",
    };
  return { outcome: "accepted", retention: request.retention, fallback: "none" };
}

export function defaultRealtimeRetention(): RealtimeRetention {
  return "none";
}
