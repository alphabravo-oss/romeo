import { describe, expect, it } from "vitest";

import { matchesConfirmationPhrase } from "./confirm-typed";

describe("typed confirmation", () => {
  it("accepts the exact phrase", () => {
    expect(matchesConfirmationPhrase("Romeo Local", "Romeo Local")).toBe(true);
  });

  it("ignores surrounding whitespace so a trailing space is not a trap", () => {
    expect(matchesConfirmationPhrase("  Romeo Local  ", "Romeo Local")).toBe(
      true,
    );
  });

  it("is case sensitive so the admin must read what they are typing", () => {
    expect(matchesConfirmationPhrase("romeo local", "Romeo Local")).toBe(false);
  });

  it("rejects a partial match", () => {
    expect(matchesConfirmationPhrase("Romeo", "Romeo Local")).toBe(false);
  });

  it("rejects an empty phrase requirement rather than silently passing", () => {
    expect(matchesConfirmationPhrase("", "")).toBe(false);
  });
});
