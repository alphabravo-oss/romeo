import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

import { ROMEO_REPOSITORY_METHOD_NAMES } from "./repository-method-names";

describe("repository method names", () => {
  it("lists every RomeoRepository method", () => {
    const repositoryMethods = [
      methodsFor("./repository.ts", "RomeoRepository"),
      methodsFor("./repository-identity.ts", "RepositoryIdentityCapability"),
      methodsFor("./repository-content.ts", "RepositoryContentCapability"),
      methodsFor(
        "./repository-operations.ts",
        "RepositoryOperationsCapability",
      ),
      methodsFor(
        "./repository-capabilities.ts",
        "RepositoryCapabilityAssignments",
      ),
      methodsFor(
        "./repository-capability-flags.ts",
        "RepositoryCapabilityFlags",
      ),
      methodsFor("./repository-idempotency.ts", "RepositoryIdempotency"),
    ].flat();

    expect(ROMEO_REPOSITORY_METHOD_NAMES).toEqual(repositoryMethods);
    expect(new Set(ROMEO_REPOSITORY_METHOD_NAMES).size).toBe(
      repositoryMethods.length,
    );
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
