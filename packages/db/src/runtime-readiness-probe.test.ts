import { describe, expect, it } from "vitest";

import migrationJournal from "../migrations/meta/_journal.json";
import type { RomeoDatabase } from "./client";
import { createPostgresRuntimeReadinessProbe } from "./runtime-readiness-probe";

describe("Postgres runtime readiness probe", () => {
  it("requires SELECT 1 and the exact ordered migration journal", async () => {
    const probe = createPostgresRuntimeReadinessProbe(
      database([
        [{ ready: 1 }],
        [safeRuntimeRole()],
        migrationJournal.entries.map((entry) => ({
          createdAt: String(entry.when),
        })),
      ]),
    );

    await expect(probe.check(new AbortController().signal)).resolves.toEqual({
      connected: true,
      migrationsCurrent: true,
      runtimeRoleSafe: true,
    });
  });

  it("reports migration drift without exposing migration contents", async () => {
    const probe = createPostgresRuntimeReadinessProbe(
      database([[{ ready: 1 }], [safeRuntimeRole()], [{ createdAt: "1" }]]),
    );

    await expect(probe.check(new AbortController().signal)).resolves.toEqual({
      connected: true,
      migrationsCurrent: false,
      runtimeRoleSafe: true,
    });
  });

  it.each([
    ["superuser", { superuser: true }],
    ["BYPASSRLS", { bypassesRls: true }],
    ["INHERIT", { inheritsPrivileges: true }],
    ["missing tenant membership", { tenantRuntime: false }],
    ["missing coordinator membership", { coordinator: false }],
  ])(
    "rejects an unsafe base login with %s posture",
    async (_name, override) => {
      const probe = createPostgresRuntimeReadinessProbe(
        database([
          [{ ready: 1 }],
          [{ ...safeRuntimeRole(), ...override }],
          migrationJournal.entries.map((entry) => ({
            createdAt: String(entry.when),
          })),
        ]),
      );
      await expect(probe.check(new AbortController().signal)).resolves.toEqual({
        connected: true,
        migrationsCurrent: true,
        runtimeRoleSafe: false,
      });
    },
  );

  it("cooperatively cancels before issuing a query", async () => {
    const controller = new AbortController();
    controller.abort();
    const execute = () => {
      throw new Error("must_not_execute");
    };
    const probe = createPostgresRuntimeReadinessProbe({
      execute,
    } as unknown as RomeoDatabase);

    await expect(probe.check(controller.signal)).rejects.toThrow(
      "runtime_readiness_probe_aborted",
    );
  });
});

function database(results: unknown[]): RomeoDatabase {
  let index = 0;
  return {
    execute: async () => results[index++],
  } as unknown as RomeoDatabase;
}

function safeRuntimeRole() {
  return {
    bypassesRls: false,
    coordinator: true,
    inheritsPrivileges: false,
    superuser: false,
    tenantRuntime: true,
  };
}
