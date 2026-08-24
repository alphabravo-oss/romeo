import { ApiError } from "../errors";

export function voiceProviderApiError(
  caught: unknown,
  operation: "synthesis" | "transcription",
): ApiError {
  if (caught instanceof ApiError) return caught;
  const message = caught instanceof Error ? caught.message : "";
  if (message.toLowerCase().includes("not configured")) {
    return new ApiError(
      "voice_not_configured",
      `Voice ${operation} is not configured.`,
      409,
    );
  }
  if (
    (caught instanceof Error && caught.name === "AbortError") ||
    message.toLowerCase().includes("timed out")
  ) {
    return new ApiError(
      "provider_timeout",
      `The voice ${operation} provider timed out.`,
      504,
    );
  }
  return new ApiError(
    "provider_unexpected_failure",
    `The voice ${operation} provider returned an invalid response.`,
    502,
  );
}
