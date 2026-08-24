import { seededSubject } from "@romeo/auth";
import { MemoryObjectStore } from "@romeo/storage";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import {
  createGovernedDataExportPackage,
  listGovernedDataExportPackages,
  readGovernedDataExportPackage,
  removeGovernedDataExportPackageRegistration,
} from "./data-export-package";

describe("governed data export package reads", () => {
  it("does not lose concurrent package registrations or removals", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const create = () =>
      createGovernedDataExportPackage({
        objectStore,
        repository,
        request: { includeContent: false, scope: "org" },
        subject: seededSubject,
      });
    const created = await Promise.all([create(), create()]);
    const listed = await listGovernedDataExportPackages({
      orgId: seededSubject.orgId,
      repository,
    });
    expect(listed.packages.map((item) => item.packageId).sort()).toEqual(
      created.map((item) => item.packageId).sort(),
    );

    await Promise.all(
      created.map((packaged) =>
        removeGovernedDataExportPackageRegistration({
          orgId: seededSubject.orgId,
          packageId: packaged.packageId,
          repository,
        }),
      ),
    );
    await expect(
      listGovernedDataExportPackages({
        orgId: seededSubject.orgId,
        repository,
      }),
    ).resolves.toMatchObject({ packages: [] });
  });

  it("requires a registered artifact and verifies streamed integrity", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const packaged = await createGovernedDataExportPackage({
      objectStore,
      repository,
      request: {
        includeContent: false,
        scope: "workspace",
        workspaceId: "workspace_default",
      },
      subject: seededSubject,
    });
    const read = await readGovernedDataExportPackage({
      objectStore,
      orgId: seededSubject.orgId,
      packageId: packaged.packageId,
      repository,
    });
    await expect(new Response(read.body).json()).resolves.toMatchObject({
      schema: "romeo.data-export.v1",
    });

    const objectKey = `governance/data-exports/org_default/${packaged.packageId}.json`;
    await objectStore.putObject({
      body: new Uint8Array(packaged.artifact.sizeBytes).fill(32),
      contentType: "application/json",
      key: objectKey,
    });
    const corrupt = await readGovernedDataExportPackage({
      objectStore,
      orgId: seededSubject.orgId,
      packageId: packaged.packageId,
      repository,
    });
    await expect(
      new Response(corrupt.body).arrayBuffer(),
    ).rejects.toMatchObject({
      code: "data_export_package_integrity_failed",
      status: 500,
    });
  });

  it("does not expose an object that has no governed registration", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const packageId = "export_pkg_aaaaaaaaaaaaaaaaaaaa";
    await objectStore.putObject({
      body: new TextEncoder().encode("{}"),
      contentType: "application/json",
      key: `governance/data-exports/org_default/${packageId}.json`,
    });

    await expect(
      readGovernedDataExportPackage({
        objectStore,
        orgId: seededSubject.orgId,
        packageId,
        repository,
      }),
    ).rejects.toMatchObject({ status: 404 });
  });
});
