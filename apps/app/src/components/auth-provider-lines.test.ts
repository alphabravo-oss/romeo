import { describe, expect, it } from "vitest";

import { linesToArray } from "./auth-provider-lines";

describe("linesToArray", () => {
  it("splits real newlines", () => {
    expect(linesToArray("a\nb")).toEqual(["a", "b"]);
  });

  it("supports Windows newlines", () => {
    expect(linesToArray("a\r\nb")).toEqual(["a", "b"]);
  });

  it("trims values and removes empty lines", () => {
    expect(linesToArray(" a \n\n b ")).toEqual(["a", "b"]);
  });

  it("returns an empty list for empty input", () => {
    expect(linesToArray("")).toEqual([]);
  });

  it("round-trips the format used to seed the textarea", () => {
    const values = ["admins", "workspace-owners"];
    expect(linesToArray(values.join("\n"))).toEqual(values);
  });
});
