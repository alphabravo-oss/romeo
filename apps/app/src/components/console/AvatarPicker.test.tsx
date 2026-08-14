// @vitest-environment jsdom

import { act, useState } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AvatarPicker } from "./AvatarPicker";

const labels = {
  browse: "Choose image",
  dropHere: "Drop an image",
  invalidUrl: "Use a public HTTPS image URL",
  remove: "Remove",
  tooLarge: "Too large",
  unsupported: "Unsupported",
  urlLabel: "Image URL",
  useUrl: "Use a URL",
};

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

function renderPicker(onChange = vi.fn()) {
  function Harness() {
    const [value, setValue] = useState("");
    return (
      <AvatarPicker
        label="Picture"
        labels={labels}
        onChange={(next) => {
          onChange(next);
          setValue(next);
        }}
        preview={<span>Preview</span>}
        value={value}
      />
    );
  }
  act(() => root.render(<Harness />));
  const useUrl = [...container.querySelectorAll("button")].find(
    (button) => button.textContent === labels.useUrl,
  );
  if (useUrl === undefined) throw new Error("URL toggle was not rendered");
  act(() => useUrl.click());
  const input = container.querySelector<HTMLInputElement>(
    'input[name="avatarUrl"]',
  );
  if (input === null) throw new Error("URL input was not rendered");
  return { input, onChange };
}

function enterUrl(input: HTMLInputElement, value: string) {
  const setter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value",
  )?.set;
  if (setter === undefined) throw new Error("input value setter unavailable");
  act(() => {
    setter.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  act(() => input.dispatchEvent(new FocusEvent("focusout", { bubbles: true })));
}

describe("AvatarPicker", () => {
  it("accepts raster image files but excludes SVG", () => {
    renderPicker();
    const fileInput =
      container.querySelector<HTMLInputElement>('input[type="file"]');

    expect(fileInput?.accept).toContain("image/png");
    expect(fileInput?.accept).toContain("image/webp");
    expect(fileInput?.accept).not.toContain("image/svg+xml");
  });

  it("normalizes a valid public HTTPS URL on blur", () => {
    const onChange = vi.fn();
    const { input } = renderPicker(onChange);
    enterUrl(input, "HTTPS://cdn.example.com/avatar.png");

    expect(onChange).toHaveBeenLastCalledWith(
      "https://cdn.example.com/avatar.png",
    );
    expect(input.getAttribute("aria-invalid")).toBe("false");
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it("announces and marks a private remote URL as invalid", () => {
    const { input } = renderPicker();
    enterUrl(input, "https://127.0.0.1/avatar.png");

    expect(input.getAttribute("aria-invalid")).toBe("true");
    const alert = container.querySelector('[role="alert"]');
    expect(alert?.textContent).toBe(labels.invalidUrl);
    expect(input.getAttribute("aria-describedby")).toBe(alert?.id);
  });
});
