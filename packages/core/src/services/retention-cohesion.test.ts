import { describe, expect, it } from "vitest";

import {
  planRetentionCohesion,
  RETENTION_SURFACES,
  surfaceHonorsRetention,
} from "./retention-cohesion";

describe("retention cohesion", () => {
  it("lets legal hold dominate delete and shred across every surface", () => {
    const hold = planRetentionCohesion({
      legalHold: true,
      deleted: true,
      cryptoShredRequested: false,
      backupChecked: true,
    });
    expect(hold).toEqual({
      action: "blocked",
      code: "retention_hold_blocks_delete",
    });
    expect(
      planRetentionCohesion({
        legalHold: true,
        deleted: false,
        cryptoShredRequested: true,
        backupChecked: true,
      }),
    ).toEqual({ action: "blocked", code: "retention_hold_blocks_shred" });
    const retained = planRetentionCohesion({
      legalHold: true,
      deleted: false,
      cryptoShredRequested: false,
      backupChecked: false,
    });
    expect(retained).toMatchObject({ action: "retain", reason: "legal_hold" });
    for (const surface of RETENTION_SURFACES)
      expect(surfaceHonorsRetention(retained, surface)).toBe(true);
  });

  it("requires a backup check before crypto-shred and then covers every surface", () => {
    expect(
      planRetentionCohesion({
        legalHold: false,
        deleted: true,
        cryptoShredRequested: true,
        backupChecked: false,
      }),
    ).toEqual({
      action: "blocked",
      code: "retention_backup_check_required",
    });
    const shred = planRetentionCohesion({
      legalHold: false,
      deleted: true,
      cryptoShredRequested: true,
      backupChecked: true,
    });
    expect(shred.action).toBe("crypto_shred");
    if (shred.action !== "crypto_shred") throw new Error("expected shred");
    expect([...shred.surfaces]).toEqual([...RETENTION_SURFACES]);
    const deleted = planRetentionCohesion({
      legalHold: false,
      deleted: true,
      cryptoShredRequested: false,
      backupChecked: false,
    });
    expect(deleted.action).toBe("delete");
    if (deleted.action !== "delete") throw new Error("expected delete");
    expect(deleted.surfaces).toContain("paging");
    expect(deleted.surfaces).toContain("search");
    expect(deleted.surfaces).toContain("exports");
  });
});
