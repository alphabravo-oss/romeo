import { describe, expect, it } from "vitest";

import {
  canSelectWorkspace,
  resolveWorkspaceSelection,
  visibleWorkspaces,
} from "./workspace-selection";

const alpha = { id: "workspace_alpha", name: "Alpha" };
const beta = { id: "workspace_beta", name: "Beta" };
const listed = [alpha, beta];

describe("workspace selection membership", () => {
  it("hides ungranted workspaces and refuses to land on or switch to them", () => {
    const visible = visibleWorkspaces(listed, ["workspace_beta"]);
    expect(visible.map((workspace) => workspace.id)).toEqual([
      "workspace_beta",
    ]);

    expect(
      resolveWorkspaceSelection({
        persistedId: "workspace_alpha",
        selectedId: undefined,
        workspaces: visible,
      }),
    ).toBe("workspace_beta");

    expect(canSelectWorkspace("workspace_alpha", visible)).toBe(false);
    expect(canSelectWorkspace("workspace_beta", visible)).toBe(true);
  });

  it("keeps an allowed selection and treats a missing allowlist as empty", () => {
    expect(visibleWorkspaces(listed, undefined)).toEqual([]);
    expect(
      resolveWorkspaceSelection({
        persistedId: "workspace_alpha",
        selectedId: "workspace_beta",
        workspaces: visibleWorkspaces(listed, ["workspace_alpha", "workspace_beta"]),
      }),
    ).toBe("workspace_beta");
  });
});
