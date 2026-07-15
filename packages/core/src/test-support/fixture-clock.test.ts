import { describe, expect, it } from "vitest";

import { fixtureFuture, fixturePast } from "./fixture-clock";

describe("fixture clock", () => {
  it("returns an ISO timestamp in the future", () => {
    expect(new Date(fixtureFuture()).getTime()).toBeGreaterThan(Date.now());
  });

  it("returns an ISO timestamp in the past", () => {
    expect(new Date(fixturePast()).getTime()).toBeLessThan(Date.now());
  });

  it("honours an explicit offset", () => {
    const oneHour = 60 * 60 * 1000;
    const actual = new Date(fixtureFuture(oneHour)).getTime();
    expect(actual).toBeGreaterThan(Date.now() + oneHour - 5_000);
    expect(actual).toBeLessThan(Date.now() + oneHour + 5_000);
  });
});

import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = join(import.meta.dirname, "..");

function testFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) return testFiles(path);
    return entry.name.endsWith(".test.ts") ? [path] : [];
  });
}

describe("fixture rot guard", () => {
  // A hardcoded future expiresAt is a time bomb: it passes until the date
  // arrives, then silently flips behaviour in any code that filters on expiry.
  // seedLocalSession's 2026-07-08 rotted a week after it was written and made
  // SessionService.revokeOthers look broken when it was fine.
  //
  // Deliberately-expired fixtures are legitimate and common (stale worker
  // leases, expired OAuth tokens). Intent is not inferable from the value, so
  // they must be marked. Everything else uses fixtureFuture()/fixturePast().
  it("has no unmarked expiresAt fixture pinned to a past literal date", () => {
    const offenders: string[] = [];

    for (const file of testFiles(SRC_DIR)) {
      const lines = readFileSync(file, "utf8").split("\n");
      lines.forEach((line, index) => {
        const match = /expiresAt:\s*"(\d{4}-\d{2}-\d{2}T[^"]+)"/.exec(line);
        if (match === null) return;
        // noUncheckedIndexedAccess makes match[1] `string | undefined`. Bind and
        // narrow it: `new Date(match[1])` does not typecheck. vitest will not
        // catch this (it does not typecheck) — only `pnpm check` will.
        const iso = match[1];
        if (iso === undefined) return;
        if (new Date(iso).getTime() > Date.now()) return;
        if (line.includes("deliberately-expired:")) return;
        offenders.push(`${file}:${index + 1} -> ${iso}`);
      });
    }

    expect(offenders).toEqual([]);
  });
});
