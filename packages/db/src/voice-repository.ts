import { asc, desc, eq } from "drizzle-orm";

import type { RomeoDatabase } from "./client";
import { asStringArray, toIsoString } from "./repository-mapping";
import { voiceProfiles } from "./schema";

export interface VoiceProfileRecord {
  id: string;
  orgId: string;
  providerId: string;
  providerVoiceId: string;
  name: string;
  language: string;
  styleTags: string[];
  cloningAllowed: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export class PgVoiceRepository {
  constructor(private readonly db: RomeoDatabase) {}

  async listVoiceProfiles(orgId: string): Promise<VoiceProfileRecord[]> {
    const rows = await this.db
      .select()
      .from(voiceProfiles)
      .where(eq(voiceProfiles.orgId, orgId))
      .orderBy(desc(voiceProfiles.createdAt), asc(voiceProfiles.id));
    return rows.map(toVoiceProfileRecord);
  }

  async getVoiceProfile(
    voiceProfileId: string,
  ): Promise<VoiceProfileRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(voiceProfiles)
      .where(eq(voiceProfiles.id, voiceProfileId))
      .limit(1);
    return row === undefined ? undefined : toVoiceProfileRecord(row);
  }

  async createVoiceProfile(
    voiceProfile: VoiceProfileRecord,
  ): Promise<VoiceProfileRecord> {
    const [row] = await this.db
      .insert(voiceProfiles)
      .values(toVoiceProfileInsert(voiceProfile))
      .onConflictDoUpdate({
        target: [
          voiceProfiles.orgId,
          voiceProfiles.providerId,
          voiceProfiles.providerVoiceId,
        ],
        set: {
          cloningAllowed: voiceProfile.cloningAllowed,
          enabled: voiceProfile.enabled,
          language: voiceProfile.language,
          name: voiceProfile.name,
          styleTags: voiceProfile.styleTags,
          updatedAt: new Date(voiceProfile.updatedAt),
        },
      })
      .returning();
    return row === undefined ? voiceProfile : toVoiceProfileRecord(row);
  }
}

export function toVoiceProfileRecord(
  row: typeof voiceProfiles.$inferSelect,
): VoiceProfileRecord {
  return {
    id: row.id,
    orgId: row.orgId,
    providerId: row.providerId,
    providerVoiceId: row.providerVoiceId,
    name: row.name,
    language: row.language,
    styleTags: asStringArray(row.styleTags),
    cloningAllowed: row.cloningAllowed,
    enabled: row.enabled,
    createdAt: toIsoString(row.createdAt),
    updatedAt: toIsoString(row.updatedAt),
  };
}

function toVoiceProfileInsert(
  record: VoiceProfileRecord,
): typeof voiceProfiles.$inferInsert {
  return {
    id: record.id,
    orgId: record.orgId,
    providerId: record.providerId,
    providerVoiceId: record.providerVoiceId,
    name: record.name,
    language: record.language,
    styleTags: record.styleTags,
    cloningAllowed: record.cloningAllowed,
    enabled: record.enabled,
    createdAt: new Date(record.createdAt),
    updatedAt: new Date(record.updatedAt),
  };
}
