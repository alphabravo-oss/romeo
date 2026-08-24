import { InMemoryRomeoRepository, type RomeoRepository } from "@romeo/core";
import { describe, expect, it } from "vitest";

import { createShortLivedScopedRepository } from "./tenant-database-context";

describe("short-lived repository request scope", () => {
  it("does not open a database unit for the request lifetime", async () => {
    const base = new InMemoryRomeoRepository();
    let active = 0;
    let acquisitions = 0;
    const scoped = createShortLivedScopedRepository(
      base.runtime,
      async (work) => {
        acquisitions += 1;
        active += 1;
        try {
          return await work(base);
        } finally {
          active -= 1;
        }
      },
    );

    expect(active).toBe(0);
    expect(acquisitions).toBe(0);
    await expect(scoped.listOrganizations("org_default")).resolves.toHaveLength(
      1,
    );
    expect(active).toBe(0);
    expect(acquisitions).toBe(1);
    await scoped.getOrganization("org_default");
    expect(acquisitions).toBe(2);
  });

  it("pins one scope only for an explicit atomic callback", async () => {
    const base = new InMemoryRomeoRepository();
    let acquisitions = 0;
    let active = 0;
    let repositorySeen: RomeoRepository | undefined;
    const scoped = createShortLivedScopedRepository(
      base.runtime,
      async (work) => {
        acquisitions += 1;
        active += 1;
        try {
          return await work(base);
        } finally {
          active -= 1;
        }
      },
    );

    await scoped.transaction(async (repository) => {
      repositorySeen = repository;
      expect(active).toBe(1);
      await repository.getOrganization("org_default");
      await repository.listOrganizations("org_default");
      expect(acquisitions).toBe(1);
    });
    expect(repositorySeen).toBe(base);
    expect(active).toBe(0);
    expect(acquisitions).toBe(1);
  });

  it("lets work retained after request setup acquire a fresh scope later", async () => {
    const base = new InMemoryRomeoRepository();
    let acquisitions = 0;
    const scoped = createShortLivedScopedRepository(
      base.runtime,
      async (work) => {
        acquisitions += 1;
        return await work(base);
      },
    );
    const retained = () => scoped.getOrganization("org_default");

    expect(acquisitions).toBe(0);
    await expect(retained()).resolves.toMatchObject({ id: "org_default" });
    await expect(retained()).resolves.toMatchObject({ id: "org_default" });
    expect(acquisitions).toBe(2);
  });
});
