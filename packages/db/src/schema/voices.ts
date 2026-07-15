import {
  boolean,
  index,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

import { organizations } from "./tenancy";

export const voiceProfiles = pgTable(
  "voice_profiles",
  {
    id: text("id").primaryKey(),
    orgId: text("org_id")
      .notNull()
      .references(() => organizations.id),
    providerId: text("provider_id").notNull(),
    providerVoiceId: text("provider_voice_id").notNull(),
    name: text("name").notNull(),
    language: text("language").notNull(),
    styleTags: text("style_tags").array().notNull(),
    cloningAllowed: boolean("cloning_allowed").notNull(),
    enabled: boolean("enabled").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true })
      .notNull()
      .defaultNow(),
  },
  (table) => ({
    voiceProfilesOrgCreatedIdx: index("voice_profiles_org_created_idx").on(
      table.orgId,
      table.createdAt,
    ),
    voiceProfilesEnabledLanguageIdx: index(
      "voice_profiles_enabled_language_idx",
    ).on(table.orgId, table.enabled, table.language),
    voiceProfilesProviderVoiceIdx: uniqueIndex(
      "voice_profiles_provider_voice_idx",
    ).on(table.orgId, table.providerId, table.providerVoiceId),
  }),
);
