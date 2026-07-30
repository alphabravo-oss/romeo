import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import {
  ROMEO_REPOSITORY_METHOD_NAMES,
  repositoryContractInventory,
} from "./repository-contract-inventory";

describe("repository contract inventory", () => {
  it("classifies every RomeoRepository method", () => {
    const repositoryMethods = [
      methodsFor("./repository.ts", "RomeoRepository"),
      methodsFor("./repository-identity.ts", "RepositoryIdentityCapability"),
      methodsFor("./repository-content.ts", "RepositoryContentCapability"),
      methodsFor(
        "./repository-operations.ts",
        "RepositoryOperationsCapability",
      ),
    ].flat();

    expect(repositoryMethods).toHaveLength(262);
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

function methodsFor(file: string, interfaceName: string): string[] {
  const source = readFileSync(new URL(file, import.meta.url), "utf8");
  const interfaceBody = source.match(
    new RegExp(`export interface ${interfaceName}[^{]*\\{([\\s\\S]*?)\\n\\}`),
  )?.[1];
  return [
    ...(interfaceBody ?? "").matchAll(/^\s{2}([a-zA-Z]\w+)(?:<[^>]+>)?\(/gm),
  ].flatMap((match) => (match[1] === undefined ? [] : [match[1]]));
}
