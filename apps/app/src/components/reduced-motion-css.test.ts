// @vitest-environment jsdom

import { readFileSync } from "node:fs";
import path from "node:path";

import { afterEach, describe, expect, it } from "vitest";

const styles = readFileSync(
  path.join(process.cwd(), "src/styles/app-conversation.css"),
  "utf8",
);

afterEach(() => {
  document.head.replaceChildren();
  document.body.replaceChildren();
  document.documentElement.classList.remove("reduce-motion");
});

describe("attachment progress reduced motion", () => {
  it("computes no transition for the explicit interface preference", () => {
    const style = document.createElement("style");
    style.textContent = styles;
    document.head.append(style);
    document.documentElement.classList.add("reduce-motion");
    const progress = document.createElement("span");
    progress.className = "rm-tray-progress-bar";
    document.body.append(progress);

    expect(getComputedStyle(progress).transition).toBe("none");
  });

  it("keeps a valid system-preference media rule for the progress bar", () => {
    const style = document.createElement("style");
    style.textContent = styles;
    document.head.append(style);
    const rules = [...(style.sheet?.cssRules ?? [])];
    const reducedMotion = rules.find(
      (rule) =>
        "conditionText" in rule &&
        rule.conditionText === "(prefers-reduced-motion: reduce)",
    );

    expect(reducedMotion?.cssText).toContain(".rm-tray-progress-bar");
    expect(reducedMotion?.cssText).toContain("transition: none");
  });
});
