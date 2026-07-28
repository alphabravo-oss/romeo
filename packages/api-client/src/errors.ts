import type { ApiErrorEnvelope } from "./runtime/types";

export class RomeoApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body?: ApiErrorEnvelope,
  ) {
    super(message);
    this.name = "RomeoApiError";
  }

  get code(): string | undefined {
    return this.body?.error.code;
  }

  get details(): Record<string, unknown> {
    return this.body?.error.details ?? {};
  }
}
