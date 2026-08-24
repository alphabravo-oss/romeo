// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { Tabs } from "./Tabs";

vi.mock("../lib/i18n", () => ({
  useLocale: () => ({ t: (key: string) => key }),
}));

afterEach(cleanup);

const tabs = [
  { content: <p>First content</p>, id: "first", label: "First" },
  { content: <p>Second content</p>, id: "second", label: "Second" },
];

describe("Tabs", () => {
  it("uses a controlled route value and reports keyboard navigation", async () => {
    const onChange = vi.fn();
    render(<Tabs activeId="second" onActiveIdChange={onChange} tabs={tabs} />);

    expect(
      screen.getByRole("tab", { name: "Second" }).getAttribute("aria-selected"),
    ).toBe("true");
    await userEvent.click(screen.getByRole("tab", { name: "First" }));
    expect(onChange).toHaveBeenCalledWith("first");
  });

  it("falls back safely when a direct link contains an invalid tab", () => {
    render(<Tabs activeId="removed" onActiveIdChange={vi.fn()} tabs={tabs} />);
    expect(
      screen.getByRole("tab", { name: "First" }).getAttribute("aria-selected"),
    ).toBe("true");
  });
});
