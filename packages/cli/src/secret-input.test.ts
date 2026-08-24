import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { readCliSecret, rejectSecretFlag } from "./secret-input";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("CLI secret input", () => {
  it("rejects argv secrets without echoing their values", () => {
    expect(() =>
      rejectSecretFlag({ "api-key": "super-secret-value" }, "api-key"),
    ).toThrow("--api-key is forbidden");
    try {
      rejectSecretFlag({ "api-key": "super-secret-value" }, "api-key");
    } catch (error) {
      expect(String(error)).not.toContain("super-secret-value");
    }
  });

  it("reads protected files and rejects permissive files", () => {
    const directory = mkdtempSync(join(tmpdir(), "romeo-cli-secret-"));
    temporaryDirectories.push(directory);
    const protectedFile = join(directory, "protected");
    writeFileSync(protectedFile, "file-secret\n", { mode: 0o600 });
    expect(
      readCliSecret({ ROMEO_API_KEY_FILE: protectedFile }, "ROMEO_API_KEY"),
    ).toBe("file-secret");

    if (process.platform !== "win32") {
      chmodSync(protectedFile, 0o644);
      expect(() =>
        readCliSecret({ ROMEO_API_KEY_FILE: protectedFile }, "ROMEO_API_KEY"),
      ).toThrow("mode 0400 or 0600");
    }
  });

  it("treats an empty environment value as unset and rejects ambiguity", () => {
    expect(readCliSecret({ ROMEO_API_KEY: "" }, "ROMEO_API_KEY")).toBe(
      undefined,
    );
    expect(() =>
      readCliSecret(
        {
          ROMEO_API_KEY: "direct",
          ROMEO_API_KEY_FILE: "/not/read",
        },
        "ROMEO_API_KEY",
      ),
    ).toThrow("mutually exclusive");
  });
});
