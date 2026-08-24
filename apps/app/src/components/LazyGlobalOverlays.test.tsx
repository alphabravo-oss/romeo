// @vitest-environment jsdom

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  COMMAND_PALETTE_INTENT_EVENT,
  COMMAND_PALETTE_OPEN_EVENT,
} from "../lib/command-palette-events";
import { LazyGlobalOverlays } from "./LazyGlobalOverlays";

vi.mock("../lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));
vi.mock("@tanstack/react-router", () => ({ useNavigate: () => vi.fn() }));
vi.mock("./WorkspaceContext", () => ({
  useWorkspace: () => ({ subject: undefined, workspace: undefined }),
}));
vi.mock("./ShortcutsModal", () => ({ ShortcutsModal: () => null }));
vi.mock("./CommandPalette", () => ({
  CommandPalette: ({ open }: { open: boolean }) =>
    open ? (
      <>
        <input
          aria-controls="test-commands"
          aria-expanded="true"
          aria-label="Commands"
          role="combobox"
        />
        <div id="test-commands" role="listbox" />
      </>
    ) : null,
}));

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};
let container: HTMLDivElement;
let root: Root;

beforeEach(() => {
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = true;
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  act(() =>
    root.render(
      <QueryClientProvider client={new QueryClient()}>
        <LazyGlobalOverlays />
      </QueryClientProvider>,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("LazyGlobalOverlays", () => {
  it("queues a cold first-click request while intent alone only preloads", async () => {
    act(() =>
      window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_INTENT_EVENT)),
    );
    expect(document.querySelector('[role="combobox"]')).toBeNull();

    await act(async () => {
      window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_OPEN_EVENT));
      await Promise.resolve();
    });
    await vi.waitFor(() =>
      expect(document.querySelector('[role="combobox"]')).not.toBeNull(),
    );
  });

  it("owns one keyboard toggle before and after the lazy module mounts", async () => {
    await act(async () => {
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "k",
        }),
      );
      await Promise.resolve();
    });
    expect(document.querySelector('[role="combobox"]')).not.toBeNull();

    act(() =>
      window.dispatchEvent(
        new KeyboardEvent("keydown", {
          bubbles: true,
          ctrlKey: true,
          key: "k",
        }),
      ),
    );
    expect(document.querySelector('[role="combobox"]')).toBeNull();
  });
});
