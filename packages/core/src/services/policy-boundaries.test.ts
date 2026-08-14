import { describe, expect, it } from "vitest";

import {
  authorizeToolBoundary,
  evaluateDestinationPolicy,
  evaluateRetrievalBoundary,
  sanitizePolicyEvidence,
} from "./policy-boundaries";

describe("firewall tool, retrieval, and destination boundaries", () => {
  it("blocks unscanned tool results and retrieval-granted permission", () => {
    expect(
      authorizeToolBoundary({
        argumentsScanned: true,
        argumentsBlocked: false,
        resultsScanned: false,
        resultsBlocked: false,
        permissionFromRetrieval: false,
      }),
    ).toEqual({ outcome: "denied", code: "tool_results_unscanned" });
    expect(
      authorizeToolBoundary({
        argumentsScanned: true,
        argumentsBlocked: false,
        resultsScanned: true,
        resultsBlocked: false,
        permissionFromRetrieval: true,
      }),
    ).toEqual({ outcome: "denied", code: "tool_permission_from_retrieval" });
  });

  it("labels untrusted retrieval and forbids silent destination fallback", () => {
    expect(
      evaluateRetrievalBoundary({
        sourceLabelled: true,
        containsPolicyInstruction: true,
        suspiciousInstruction: false,
      }),
    ).toEqual({ outcome: "untrusted", blocked: "policy_instruction" });
    expect(
      evaluateDestinationPolicy({
        providerAllowed: true,
        toolAllowed: true,
        connectorAllowed: true,
        hostAllowed: true,
        regionAllowed: true,
        dataClassAllowed: true,
        fallbackProvider: "other",
      }),
    ).toEqual({
      outcome: "denied",
      code: "destination_silent_fallback_forbidden",
    });
    const evidence = sanitizePolicyEvidence({
      detectorCodes: ["us_ssn"],
      counts: 1,
      surface: "output",
      action: "block",
      policyVersion: "cp-v1",
      destinationClass: "provider",
      matchText: "078-05-1120",
    });
    expect(evidence).not.toHaveProperty("matchText");
    expect(JSON.stringify(evidence)).not.toContain("078-05-1120");
  });
});
