// @vitest-environment jsdom
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { RoutedTableSearchInput } from "./RoutedTableSearchInput";

describe("RoutedTableSearchInput", () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
  });

  it("keeps typing responsive and commits one debounced route update", () => {
    const commit = vi.fn();
    render(
      <RoutedTableSearchInput
        ariaLabel="Search"
        delayMs={250}
        id="search"
        name="search"
        onCommit={commit}
        placeholder="Search"
        routeValue=""
      />,
    );
    fireEvent.change(screen.getByRole("textbox"), {
      target: { value: "romeo" },
    });
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "romeo",
    );
    expect(commit).not.toHaveBeenCalled();
    act(() => vi.advanceTimersByTime(250));
    expect(commit).toHaveBeenCalledOnce();
    expect(commit).toHaveBeenCalledWith("romeo");
  });

  it("restores the field when browser history changes the route", () => {
    const commit = vi.fn();
    const { rerender } = render(
      <RoutedTableSearchInput
        ariaLabel="Search"
        id="search"
        key="current"
        name="search"
        onCommit={commit}
        placeholder="Search"
        routeValue="current"
      />,
    );
    rerender(
      <RoutedTableSearchInput
        ariaLabel="Search"
        id="search"
        key="from-history"
        name="search"
        onCommit={commit}
        placeholder="Search"
        routeValue="from-history"
      />,
    );
    expect((screen.getByRole("textbox") as HTMLInputElement).value).toBe(
      "from-history",
    );
    act(() => vi.advanceTimersByTime(250));
    expect(commit).not.toHaveBeenCalled();
  });
});
