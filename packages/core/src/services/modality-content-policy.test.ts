import { describe, expect, it } from "vitest";

import {
  classifierCannotAuthoritativelyBlock,
  evaluateModalityContentPolicy,
  normalizePolicyEncoding,
} from "./modality-content-policy";

const blockTokens = {
  credit_card: "disabled",
  email_address: "disabled",
  us_ssn: "disabled",
  api_token: "block",
} as const;

describe("modality content policy", () => {
  it("normalizes encodings and scans OCR/transcript before text rules", () => {
    const result = evaluateModalityContentPolicy({
      surfaces: [
        { kind: "text", content: "plain" },
        { kind: "ocr", content: "\uFEFFsk-abcdefghijklmnopqrstuvwxyz123456" },
        { kind: "transcript", content: "hello" },
      ],
      detectors: blockTokens,
    });
    expect(result.surfacesScanned.slice(0, 3)).toEqual(["ocr", "transcript", "text"]);
    expect(result.action).toBe("block");
    expect(result.detections).toEqual([
      { code: "api_token", count: 1, action: "block" },
    ]);
    expect(JSON.stringify(result.detections)).not.toContain(
      "sk-abcdefghijklmnopqrstuvwxyz",
    );
  });

  it("treats image classifiers as advisory only", () => {
    expect(
      classifierCannotAuthoritativelyBlock(blockTokens, {
        label: "sensitive_document",
        score: 0.99,
      }),
    ).toBe(true);
    const result = evaluateModalityContentPolicy({
      surfaces: [{ kind: "image_classifier", content: "advisory" }],
      detectors: blockTokens,
      imageClassifier: { label: "sensitive_document", score: 0.99 },
    });
    expect(result.action).toBe("allow");
    expect(result.classifierAdvisory).toBe(true);
  });

  it("strips a UTF-8 BOM and NFC-normalizes", () => {
    expect(normalizePolicyEncoding("\uFEFFe\u0301")).toBe("é");
  });
});
