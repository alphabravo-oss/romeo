// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import axe from "axe-core";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { commandStore } from "../lib/commands";
import { CommandPalette } from "./CommandPalette";

vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("./WorkspaceContext", () => ({
  useWorkspace: () => ({ subject: undefined, workspace: undefined }),
}));
vi.mock("../lib/i18n", () => ({
  useLocale: () => ({ locale: "en", t: (key: string) => key }),
}));

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollIntoView = vi.fn();
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => {
    commandStore.setState(() => []);
    root.unmount();
  });
  container.remove();
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("CommandPalette", () => {
  it("implements combobox semantics, skips disabled commands, and restores focus", async () => {
    const disabledRun = vi.fn();
    const enabledRun = vi.fn();
    commandStore.setState(() => [
      {
        disabled: true,
        group: "Actions",
        icon: Search,
        id: "disabled",
        label: "Disabled action",
        run: disabledRun,
      },
      {
        group: "Actions",
        icon: Search,
        id: "enabled",
        label: "Enabled action",
        run: enabledRun,
      },
    ]);

    function Harness() {
      const [open, setOpen] = useState(false);
      return (
        <QueryClientProvider client={new QueryClient()}>
          <button onClick={() => setOpen(true)} type="button">
            Open
          </button>
          <CommandPalette onOpenChange={setOpen} open={open} />
        </QueryClientProvider>
      );
    }

    act(() => root.render(<Harness />));
    const opener = container.querySelector("button")!;
    opener.focus();
    await act(async () => opener.click());

    const input =
      document.querySelector<HTMLInputElement>('[role="combobox"]')!;
    const listbox = document.querySelector('[role="listbox"]')!;
    expect(input.getAttribute("aria-label")).toBe("searchCommands");
    expect(input.getAttribute("aria-controls")).toBe(listbox.id);
    expect(input.getAttribute("aria-expanded")).toBe("true");
    expect(document.activeElement).toBe(input);
    const disabled = document.querySelector('[role="option"]:disabled');
    const selected = document.querySelector(
      '[role="option"][aria-selected="true"]',
    );
    expect(disabled?.textContent).toContain("Disabled action");
    expect(selected?.textContent).toContain("Enabled action");

    act(() =>
      input.dispatchEvent(
        new KeyboardEvent("keydown", { bubbles: true, key: "Enter" }),
      ),
    );
    expect(disabledRun).not.toHaveBeenCalled();
    expect(enabledRun).toHaveBeenCalledOnce();
    expect(document.querySelector('[role="dialog"]')).toBeNull();
    await act(async () => Promise.resolve());
    expect(document.activeElement).toBe(opener);
  });

  it("has no automated accessibility violations in the open state", async () => {
    act(() =>
      root.render(
        <QueryClientProvider client={new QueryClient()}>
          <CommandPalette onOpenChange={vi.fn()} open />
        </QueryClientProvider>,
      ),
    );
    const result = await axe.run(document.body, {
      rules: { "color-contrast": { enabled: false } },
    });
    expect(result.violations).toEqual([]);
  });
});
