import { renderToString } from "react-dom/server";
import { describe, expect, it } from "vitest";

import { useCommittedLatest } from "./useCommittedLatest";

describe("useCommittedLatest SSR", () => {
  it("renders the initial committed value without a browser layout effect", () => {
    function Harness() {
      return <span>{useCommittedLatest("server value").current}</span>;
    }

    expect(renderToString(<Harness />)).toBe("<span>server value</span>");
  });
});
