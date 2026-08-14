// @vitest-environment jsdom
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PageActions } from "./PageActions";

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
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  reactTestEnvironment.IS_REACT_ACT_ENVIRONMENT = false;
});

describe("PageActions", () => {
  it("does not allow manual refresh while the page query is disabled", () => {
    const onRefresh = vi.fn();
    act(() =>
      root.render(
        <PageActions
          onRefresh={onRefresh}
          refreshDisabled
          refreshLabel="Refresh"
        />,
      ),
    );

    const button = container.querySelector("button");
    expect(button?.disabled).toBe(true);
    button?.click();
    expect(onRefresh).not.toHaveBeenCalled();
  });
});
