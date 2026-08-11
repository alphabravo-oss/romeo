import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

// Resending used to be destructive: regenerate deleted the trailing assistant
// AND the user turn before re-sending, and edit-and-resend deleted everything
// from the edited message down. Both now fork instead, which is only true as
// long as no deletion creeps back in. The hook itself needs React and a query
// client to run, so the guarantee is asserted against its source -- the same
// approach enterprise-inventory-contract.test.ts takes. That the fork lands as
// a sibling is asserted end-to-end in packages/core/src/api.test.ts and
// message-tree.test.ts, so nothing here parses the source beyond this.
const source = readFileSync(
  new URL("useWorkspaceTurnActions.ts", import.meta.url),
  "utf8",
);

describe("resending a turn", () => {
  it("never deletes a message anywhere in the hook", () => {
    expect(source).not.toMatch(/\bdeleteMessage\b/u);
  });
});
