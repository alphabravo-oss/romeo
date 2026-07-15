import { readEnv } from "@romeo/config";
import { ROMEO_REPOSITORY_METHOD_NAMES } from "@romeo/core";
import { createPostgresRomeoRepositoryFromDatabase } from "@romeo/db";
import { describe, expect, it } from "vitest";

import { createServerRepository } from "./romeo-api";

describe("Romeo server repository runtime", () => {
  it("keeps memory persistence development-only", () => {
    const devRepository = createServerRepository(
      readEnv({
        DEV_SEEDED_LOGIN: "true",
        REPOSITORY_DRIVER: "memory",
      }),
    );

    expect(devRepository.runtime).toMatchObject({
      driver: "memory",
      durable: false,
    });
    expect(() =>
      createServerRepository(
        readEnv({
          DEV_SEEDED_LOGIN: "false",
          REPOSITORY_DRIVER: "memory",
        }),
      ),
    ).toThrow("REPOSITORY_DRIVER=postgres is required");
  });

  it("composes every RomeoRepository method for Postgres", () => {
    const repository = createPostgresRomeoRepositoryFromDatabase(
      {} as never,
    );

    expect(repository.runtime).toMatchObject({
      driver: "postgres",
      durable: true,
      storageScope: "database",
    });
    for (const method of ROMEO_REPOSITORY_METHOD_NAMES) {
      expect(typeof repository[method]).toBe("function");
    }
  });
});
