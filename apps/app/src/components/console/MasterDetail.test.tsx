// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { MasterListItem } from "./MasterDetail";

afterEach(cleanup);

describe("MasterListItem navigation", () => {
  it("provides real current-page links and preserves modified navigation", async () => {
    const onSelect = vi.fn();
    const user = userEvent.setup();
    render(
      <MasterListItem
        href="/workspace?section=agents&agent=agent-1"
        onSelect={onSelect}
        selected
        title="Support agent"
      />,
    );
    const link = screen.getByRole("link", { name: "Support agent" });
    expect(link.getAttribute("href")).toBe(
      "/workspace?section=agents&agent=agent-1",
    );
    expect(link.getAttribute("aria-current")).toBe("page");

    fireEvent.click(link, { ctrlKey: true });
    expect(onSelect).not.toHaveBeenCalled();
    link.focus();
    await user.keyboard("{Enter}");
    expect(onSelect).toHaveBeenCalledOnce();
  });
});
