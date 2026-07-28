import type { TenantDataPurgeResult } from "@romeo/core";

import type { RomeoDatabase } from "./client";
import { purgeTenantPhaseOne } from "./tenant-purge-phase-one";
import { purgeTenantPhaseThree } from "./tenant-purge-phase-three";
import { purgeTenantPhaseTwo } from "./tenant-purge-phase-two";
import { tenantPurgeContext } from "./tenant-purge-support";

export class PgTenantPurgeRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async purgeTenantData(orgId: string): Promise<TenantDataPurgeResult> {
    return this.db.transaction(async (tx) => {
      const database = tx as unknown as RomeoDatabase;
      const context = await tenantPurgeContext(database, orgId);
      const counts: Record<string, number> = {};
      const state = { context, counts, database, orgId };

      await purgeTenantPhaseOne(state);
      await purgeTenantPhaseTwo(state);
      await purgeTenantPhaseThree(state);

      return {
        organizationDeleted: (counts.organizations ?? 0) > 0,
        recordCounts: counts,
      };
    });
  }
}
