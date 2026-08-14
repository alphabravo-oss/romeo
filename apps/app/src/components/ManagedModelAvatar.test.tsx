// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { ManagedModelAvatar } from "./ManagedModelAvatar";

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

function renderAvatar(avatarUrl: string, icon = "🤖") {
  act(() => {
    root.render(
      <ManagedModelAvatar
        agent={{ avatarUrl, icon, name: "Operations assistant" }}
        size={48}
      />,
    );
  });
}

describe("ManagedModelAvatar", () => {
  it("renders public HTTPS images with a no-referrer anonymous request", () => {
    renderAvatar("https://cdn.example.com/avatar.png");
    const image = container.querySelector("img");

    expect(image?.getAttribute("src")).toBe(
      "https://cdn.example.com/avatar.png",
    );
    expect(image?.getAttribute("crossorigin")).toBe("anonymous");
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image?.getAttribute("alt")).toBe("");
    expect(image?.getAttribute("height")).toBe("48");
    expect(image?.getAttribute("width")).toBe("48");
  });

  it("does not fetch an invalid or private URL and shows the icon fallback", () => {
    renderAvatar("http://169.254.169.254/latest/meta-data", "🛡️");

    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("🛡️");
  });

  it("falls back after an image error and retries when the source changes", () => {
    renderAvatar("https://cdn.example.com/broken.png", "🛡️");
    const image = container.querySelector("img");
    expect(image).not.toBeNull();

    act(() => image?.dispatchEvent(new Event("error")));
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("🛡️");

    renderAvatar("https://cdn.example.com/replacement.png", "🛡️");
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "https://cdn.example.com/replacement.png",
    );
  });

  it("renders approved inline raster data without remote request attributes", () => {
    renderAvatar("data:image/png;base64,aGVsbG8=");
    const image = container.querySelector("img");

    expect(image).not.toBeNull();
    expect(image?.hasAttribute("crossorigin")).toBe(false);
    expect(image?.hasAttribute("referrerpolicy")).toBe(false);
  });
});
