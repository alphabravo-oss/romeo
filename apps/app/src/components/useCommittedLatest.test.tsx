// @vitest-environment jsdom

import { act, startTransition, useCallback } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { useCommittedLatest } from "./useCommittedLatest";

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

describe("useCommittedLatest", () => {
  it("does not expose a value from a suspended render", async () => {
    const observed: string[] = [];
    const rendered: string[] = [];
    const suspendedForever = new Promise<never>(() => undefined);

    function Harness({ suspend, value }: { suspend?: boolean; value: string }) {
      const latest = useCommittedLatest(value);
      const observe = useCallback(
        () => observed.push(latest.current),
        [latest],
      );
      rendered.push(value);
      if (suspend === true) throw suspendedForever;
      return <button onClick={observe}>observe</button>;
    }

    await act(async () => {
      root.render(<Harness value="committed" />);
    });

    await act(async () => {
      startTransition(() => {
        root.render(<Harness suspend value="abandoned" />);
      });
      await Promise.resolve();
    });

    const button = container.querySelector("button");
    expect(rendered).toContain("abandoned");
    expect(button).not.toBeNull();
    act(() => button?.click());
    expect(observed).toEqual(["committed"]);

    await act(async () => {
      root.render(<Harness value="next commit" />);
    });
    act(() => container.querySelector("button")?.click());
    expect(observed).toEqual(["committed", "next commit"]);
  });
});
