import { describe, expect, it } from "vitest";

import { canPublishAgent, shouldResetDraftForm } from "./agent-publish-gate";

describe("canPublishAgent", () => {
  it("allows publishing a clean active assistant", () => {
    expect(
      canPublishAgent({
        hasActiveAgent: true,
        isDraftDirty: false,
        isPublishing: false,
      }),
    ).toBe(true);
  });

  it("blocks publishing when the visible draft has unsaved edits", () => {
    expect(
      canPublishAgent({
        hasActiveAgent: true,
        isDraftDirty: true,
        isPublishing: false,
      }),
    ).toBe(false);
  });

  it("blocks publishing without an active assistant", () => {
    expect(
      canPublishAgent({
        hasActiveAgent: false,
        isDraftDirty: false,
        isPublishing: false,
      }),
    ).toBe(false);
  });

  it("blocks a duplicate publish while one is pending", () => {
    expect(
      canPublishAgent({
        hasActiveAgent: true,
        isDraftDirty: false,
        isPublishing: true,
      }),
    ).toBe(false);
  });
});

describe("shouldResetDraftForm", () => {
  it("resets when switching assistants even if the old form is dirty", () => {
    expect(shouldResetDraftForm({ isDirty: true, agentChanged: true })).toBe(
      true,
    );
  });

  it("does not reset a dirty form after a same-assistant refetch", () => {
    expect(shouldResetDraftForm({ isDirty: true, agentChanged: false })).toBe(
      false,
    );
  });

  it("refreshes a clean form from the server", () => {
    expect(shouldResetDraftForm({ isDirty: false, agentChanged: false })).toBe(
      true,
    );
  });
});
