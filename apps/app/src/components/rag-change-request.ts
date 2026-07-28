// Pure policy-patch parsing for RagGovernancePanel. Kept UI-free (and
// import-free) so malformed administrator input can be tested without a DOM.
//
// The change-request API accepts a structured partial RAG policy, not a
// free-text reason. The UI exposes that patch as JSON because every supported
// policy field can then be proposed without duplicating the full policy editor
// and drifting as the contract grows. Arrays, primitives, and an empty object
// are not valid policy patches even though they are valid JSON.

export type RagPolicyPatchParseResult =
  | {
      ok: true;
      policy: Record<string, unknown>;
    }
  | {
      error: "empty_patch" | "invalid_json" | "object_required";
      ok: false;
    };

export function parseRagPolicyPatch(value: string): RagPolicyPatchParseResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    return { error: "invalid_json", ok: false };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { error: "object_required", ok: false };
  }
  if (Object.keys(parsed).length === 0) {
    return { error: "empty_patch", ok: false };
  }
  return { ok: true, policy: parsed as Record<string, unknown> };
}
