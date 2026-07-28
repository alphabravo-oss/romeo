import { and, asc, eq } from "drizzle-orm";
import type {
  ManagedModelCustomizationPolicyRecord,
  ManagedModelPreferenceRecord,
} from "@romeo/core";

import type { RomeoDatabase } from "./client";
import {
  managedModelCustomizationPolicies,
  managedModelPreferences,
} from "./schema";
import { toIsoString } from "./repository-mapping";

export class PgManagedModelPreferenceRepository {
  constructor(protected readonly db: RomeoDatabase) {}

  async getManagedModelCustomizationPolicy(
    orgId: string,
    agentId: string,
  ): Promise<ManagedModelCustomizationPolicyRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(managedModelCustomizationPolicies)
      .where(
        and(
          eq(managedModelCustomizationPolicies.orgId, orgId),
          eq(managedModelCustomizationPolicies.agentId, agentId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toManagedModelPolicyRecord(row);
  }

  async upsertManagedModelCustomizationPolicy(
    policy: ManagedModelCustomizationPolicyRecord,
  ): Promise<ManagedModelCustomizationPolicyRecord> {
    const [row] = await this.db
      .insert(managedModelCustomizationPolicies)
      .values({
        ...policy,
        createdAt: new Date(policy.createdAt),
        updatedAt: new Date(policy.updatedAt),
      })
      .onConflictDoUpdate({
        target: [
          managedModelCustomizationPolicies.orgId,
          managedModelCustomizationPolicies.agentId,
        ],
        set: {
          allowCommunicationStyle: policy.allowCommunicationStyle,
          allowCustomInstructions: policy.allowCustomInstructions,
          allowLanguage: policy.allowLanguage,
          allowPersonalMemory: policy.allowPersonalMemory,
          allowResponseLength: policy.allowResponseLength,
          allowVoiceSelection: policy.allowVoiceSelection,
          updatedAt: new Date(policy.updatedAt),
        },
      })
      .returning();
    return row === undefined ? policy : toManagedModelPolicyRecord(row);
  }

  async getManagedModelPreference(
    orgId: string,
    agentId: string,
    principalType: ManagedModelPreferenceRecord["principalType"],
    principalId: string,
  ): Promise<ManagedModelPreferenceRecord | undefined> {
    const [row] = await this.db
      .select()
      .from(managedModelPreferences)
      .where(
        and(
          eq(managedModelPreferences.orgId, orgId),
          eq(managedModelPreferences.agentId, agentId),
          eq(managedModelPreferences.principalType, principalType),
          eq(managedModelPreferences.principalId, principalId),
        ),
      )
      .limit(1);
    return row === undefined ? undefined : toManagedModelPreferenceRecord(row);
  }

  async listManagedModelPreferences(
    orgId: string,
    agentId: string,
  ): Promise<ManagedModelPreferenceRecord[]> {
    const rows = await this.db
      .select()
      .from(managedModelPreferences)
      .where(
        and(
          eq(managedModelPreferences.orgId, orgId),
          eq(managedModelPreferences.agentId, agentId),
        ),
      )
      .orderBy(
        asc(managedModelPreferences.principalType),
        asc(managedModelPreferences.principalId),
      );
    return rows.map(toManagedModelPreferenceRecord);
  }

  async upsertManagedModelPreference(
    preference: ManagedModelPreferenceRecord,
  ): Promise<ManagedModelPreferenceRecord> {
    const [row] = await this.db
      .insert(managedModelPreferences)
      .values({
        ...preference,
        createdAt: new Date(preference.createdAt),
        updatedAt: new Date(preference.updatedAt),
      })
      .onConflictDoUpdate({
        target: [
          managedModelPreferences.orgId,
          managedModelPreferences.agentId,
          managedModelPreferences.principalType,
          managedModelPreferences.principalId,
        ],
        set: {
          communicationStyle: preference.communicationStyle ?? null,
          encodedCustomInstructions:
            preference.encodedCustomInstructions ?? null,
          language: preference.language ?? null,
          personalMemoryEnabled: preference.personalMemoryEnabled ?? null,
          responseLength: preference.responseLength ?? null,
          updatedAt: new Date(preference.updatedAt),
          voiceProfileId: preference.voiceProfileId ?? null,
        },
      })
      .returning();
    return row === undefined ? preference : toManagedModelPreferenceRecord(row);
  }

  async deleteManagedModelPreference(
    orgId: string,
    agentId: string,
    principalType: ManagedModelPreferenceRecord["principalType"],
    principalId: string,
  ): Promise<void> {
    await this.db
      .delete(managedModelPreferences)
      .where(
        and(
          eq(managedModelPreferences.orgId, orgId),
          eq(managedModelPreferences.agentId, agentId),
          eq(managedModelPreferences.principalType, principalType),
          eq(managedModelPreferences.principalId, principalId),
        ),
      );
  }
}

export function toManagedModelPolicyRecord(
  row: typeof managedModelCustomizationPolicies.$inferSelect,
): ManagedModelCustomizationPolicyRecord {
  return {
    agentId: row.agentId,
    allowCommunicationStyle: row.allowCommunicationStyle,
    allowCustomInstructions: row.allowCustomInstructions,
    allowLanguage: row.allowLanguage,
    allowPersonalMemory: row.allowPersonalMemory,
    allowResponseLength: row.allowResponseLength,
    allowVoiceSelection: row.allowVoiceSelection,
    createdAt: toIsoString(row.createdAt),
    orgId: row.orgId,
    updatedAt: toIsoString(row.updatedAt),
  };
}

export function toManagedModelPreferenceRecord(
  row: typeof managedModelPreferences.$inferSelect,
): ManagedModelPreferenceRecord {
  const preference: ManagedModelPreferenceRecord = {
    agentId: row.agentId,
    createdAt: toIsoString(row.createdAt),
    orgId: row.orgId,
    principalId: row.principalId,
    principalType: principalType(row.principalType),
    updatedAt: toIsoString(row.updatedAt),
  };
  const communicationStyle = communicationStyleValue(row.communicationStyle);
  if (communicationStyle !== undefined)
    preference.communicationStyle = communicationStyle;
  if (row.encodedCustomInstructions !== null)
    preference.encodedCustomInstructions = row.encodedCustomInstructions;
  if (row.language !== null) preference.language = row.language;
  if (row.personalMemoryEnabled !== null)
    preference.personalMemoryEnabled = row.personalMemoryEnabled;
  const responseLength = responseLengthValue(row.responseLength);
  if (responseLength !== undefined) preference.responseLength = responseLength;
  if (row.voiceProfileId !== null)
    preference.voiceProfileId = row.voiceProfileId;
  return preference;
}

function principalType(
  value: string,
): ManagedModelPreferenceRecord["principalType"] {
  if (value === "user" || value === "group" || value === "service_account")
    return value;
  throw new Error(`Invalid managed-model principal type: ${value}`);
}

function communicationStyleValue(
  value: string | null,
): ManagedModelPreferenceRecord["communicationStyle"] | undefined {
  return value === "balanced" ||
    value === "concise" ||
    value === "detailed" ||
    value === "formal" ||
    value === "friendly"
    ? value
    : undefined;
}

function responseLengthValue(
  value: string | null,
): ManagedModelPreferenceRecord["responseLength"] | undefined {
  return value === "short" || value === "standard" || value === "long"
    ? value
    : undefined;
}
