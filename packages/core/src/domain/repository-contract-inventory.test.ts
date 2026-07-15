import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ROMEO_REPOSITORY_METHOD_NAMES,
  repositoryContractInventory,
} from "./repository-contract-inventory";

describe("repository contract inventory", () => {
  it("classifies every RomeoRepository method", () => {
    const repositorySource = readFileSync(
      new URL("./repository.ts", import.meta.url),
      "utf8",
    );
    const interfaceBody = repositorySource.match(
      /export interface RomeoRepository \{([\s\S]*?)\n\}/,
    )?.[1];
    const repositoryMethods = [
      ...(interfaceBody ?? "").matchAll(/^\s{2}([a-zA-Z]\w+)(?:<[^>]+>)?\(/gm),
    ].map((match) => match[1]);

    expect(repositoryMethods).toHaveLength(230);
    expect(ROMEO_REPOSITORY_METHOD_NAMES).toEqual(repositoryMethods);
    expect(repositoryContractInventory.map((entry) => entry.method)).toEqual(
      repositoryMethods,
    );
    expect(
      new Set(repositoryContractInventory.map((entry) => entry.method)).size,
    ).toBe(repositoryMethods.length);
    expect(
      repositoryContractInventory.every((entry) =>
        entry.authorizationCaller.endsWith("_service"),
      ),
    ).toBe(true);
  });
});
