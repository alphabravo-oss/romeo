// @vitest-environment jsdom
import { act, type AnchorHTMLAttributes } from "react";
import { createRoot, type Root } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { LocaleProvider } from "../lib/i18n";
import { ConsoleLayout } from "./ConsoleLayout";

vi.mock("@tanstack/react-router", async () => {
  const React = await import("react");
  const Link = React.forwardRef<
    HTMLAnchorElement,
    AnchorHTMLAttributes<HTMLAnchorElement> & {
      preload?: boolean | string;
      search?: unknown;
      to?: string;
    }
  >(function MockLink({ preload, search: _search, to, ...props }, ref) {
    return React.createElement("a", {
      ...props,
      "data-preload": String(preload),
      href: to,
      ref,
    });
  });
  return { Link };
});

vi.mock("./SidebarFrame", () => ({
  SidebarBrand: () => <span>Brand</span>,
  SidebarFrame: ({ children }: { children: React.ReactNode }) => (
    <aside>{children}</aside>
  ),
}));

vi.mock("./ThemeToggle", () => ({ ThemeToggle: () => null }));
vi.mock("./useWorkspaceIntentPrefetch", () => ({
  useWorkspaceIntentPrefetch: () => vi.fn(),
}));
vi.mock("./WorkspaceContext", () => ({
  useWorkspace: () => ({ workspaceId: "workspace-1" }),
}));

let container: HTMLDivElement;
let root: Root;
const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

beforeEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  window.localStorage.clear();
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("ConsoleLayout section intent", () => {
  it("keeps the server render independent from persisted browser groups", () => {
    window.localStorage.setItem(
      "romeo:console-nav:/workspace",
      JSON.stringify(["saved-group"]),
    );
    const html = renderToString(
      <LocaleProvider initialLocale="en">
        <ConsoleLayout
          active="active"
          groups={[
            {
              id: "active-group",
              label: "Active group",
              items: [{ key: "active", label: "Active item" }],
            },
            {
              id: "saved-group",
              label: "Saved group",
              items: [{ key: "saved", label: "Persisted item" }],
            },
          ]}
          route="/workspace"
          title="Workspace"
        >
          Content
        </ConsoleLayout>
      </LocaleProvider>,
    );

    expect(html).toContain("Active item");
    expect(html).not.toContain("Persisted item");
  });

  it("preloads a safe lazy section from keyboard focus and pointer hover", () => {
    const onSectionIntent = vi.fn(() => Promise.resolve());
    act(() =>
      root.render(
        <LocaleProvider initialLocale="en">
          <ConsoleLayout
            active="missing"
            groups={[
              {
                items: [
                  { key: "agents", label: "Agents" },
                  { key: "knowledge", label: "Knowledge" },
                ],
              },
            ]}
            onSectionIntent={onSectionIntent}
            route="/workspace"
            title="Workspace"
          >
            Content
          </ConsoleLayout>
        </LocaleProvider>,
      ),
    );
    const knowledgeLink = Array.from(container.querySelectorAll("a")).find(
      (candidate) => candidate.textContent?.includes("Knowledge"),
    );
    expect(knowledgeLink?.dataset.preload).toBe("intent");

    act(() => knowledgeLink?.focus());
    expect(onSectionIntent).toHaveBeenLastCalledWith("knowledge");

    onSectionIntent.mockClear();
    act(() =>
      knowledgeLink?.dispatchEvent(
        new MouseEvent("mouseover", { bubbles: true }),
      ),
    );
    expect(onSectionIntent).toHaveBeenLastCalledWith("knowledge");
  });
});
