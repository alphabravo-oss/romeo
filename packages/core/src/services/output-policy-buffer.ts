import {
  CONTENT_POLICY_DETECTOR_CODES,
  type ContentPolicyAction,
  type ContentPolicyDetectorCode,
} from "./content-policy-service";

export type OutputPolicyMode = "rolling" | "strict";

export interface OutputPolicyBufferInput {
  mode: OutputPolicyMode;
  detectors: Record<ContentPolicyDetectorCode, ContentPolicyAction>;
  lookbehindCharacters?: number;
  failClosed?: boolean;
}

export type OutputPolicyRelease =
  | { action: "hold" }
  | { action: "release"; text: string }
  | {
      action: "block";
      code: "firewall_output_blocked" | "content_policy_unavailable";
      detectors: ContentPolicyDetectorCode[];
    };

const DEFAULT_LOOKBEHIND = 32;

const detectorPatterns: Record<ContentPolicyDetectorCode, RegExp> = {
  credit_card: /(?<!\d)(?:\d[ -]?){12,18}\d(?!\d)/g,
  email_address: /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,63}\b/gi,
  us_ssn:
    /(?<!\d)(?!000|666|9\d\d)\d{3}[- ]?(?!00)\d{2}[- ]?(?!0000)\d{4}(?!\d)/g,
  api_token:
    /\b(?:sk-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{20,}|AKIA[0-9A-Z]{16})\b/g,
};

export class OutputPolicyBuffer {
  private pending = "";
  private released = "";
  private blocked: OutputPolicyRelease | undefined;

  constructor(private readonly input: OutputPolicyBufferInput) {}

  consume(chunk: string): OutputPolicyRelease {
    if (this.blocked !== undefined) return this.blocked;
    if (this.input.failClosed === true && !this.policyReadable()) {
      this.blocked = {
        action: "block",
        code: "content_policy_unavailable",
        detectors: [],
      };
      return this.blocked;
    }
    this.pending += chunk.normalize("NFC");
    if (this.input.mode === "strict") return { action: "hold" };
    return this.releaseSafePrefix();
  }

  finish(): OutputPolicyRelease {
    if (this.blocked !== undefined) return this.blocked;
    if (this.input.failClosed === true && !this.policyReadable()) {
      this.blocked = {
        action: "block",
        code: "content_policy_unavailable",
        detectors: [],
      };
      return this.blocked;
    }
    const detections = detectBlocking(this.pending, this.input.detectors);
    if (detections.length > 0) {
      this.blocked = {
        action: "block",
        code: "firewall_output_blocked",
        detectors: detections,
      };
      return this.blocked;
    }
    const text = this.pending;
    this.released += text;
    this.pending = "";
    return { action: "release", text };
  }

  persisted(): string {
    return this.released;
  }

  private releaseSafePrefix(): OutputPolicyRelease {
    const lookbehind = this.input.lookbehindCharacters ?? DEFAULT_LOOKBEHIND;
    if (this.pending.length <= lookbehind) return { action: "hold" };
    const detections = detectBlocking(this.pending, this.input.detectors);
    if (detections.length > 0) {
      this.blocked = {
        action: "block",
        code: "firewall_output_blocked",
        detectors: detections,
      };
      return this.blocked;
    }
    const releaseLength = this.pending.length - lookbehind;
    const text = this.pending.slice(0, releaseLength);
    this.pending = this.pending.slice(releaseLength);
    this.released += text;
    return { action: "release", text };
  }

  private policyReadable(): boolean {
    return CONTENT_POLICY_DETECTOR_CODES.every(
      (code) => this.input.detectors[code] !== undefined,
    );
  }
}

function detectBlocking(
  content: string,
  detectors: Record<ContentPolicyDetectorCode, ContentPolicyAction>,
): ContentPolicyDetectorCode[] {
  return CONTENT_POLICY_DETECTOR_CODES.filter((code) => {
    if (detectors[code] !== "block") return false;
    const pattern = new RegExp(detectorPatterns[code].source, detectorPatterns[code].flags);
    if (code !== "credit_card") return pattern.test(content);
    for (const match of content.matchAll(pattern)) {
      const digits = match[0]!.replace(/\D/g, "");
      if (digits.length >= 13 && digits.length <= 19 && passesLuhn(digits))
        return true;
    }
    return false;
  });
}

function passesLuhn(digits: string): boolean {
  let sum = 0;
  let alternate = false;
  for (let index = digits.length - 1; index >= 0; index -= 1) {
    let value = Number(digits[index]);
    if (alternate) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    alternate = !alternate;
  }
  return sum % 10 === 0;
}

export function applyOutputPolicyBeforePersist(input: {
  buffer: OutputPolicyBuffer;
  chunk: string;
  persist: (text: string) => void;
  emit: (text: string) => void;
}): OutputPolicyRelease {
  const result = input.buffer.consume(input.chunk);
  if (result.action === "release") {
    input.persist(result.text);
    input.emit(result.text);
  }
  return result;
}
