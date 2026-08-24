import { assertScope, type AuthSubject } from "@romeo/auth";
import type { VoiceProvider } from "@romeo/voices";

import type { VoiceProfile } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { assertAbuseControlsAllow } from "./abuse-control-service";
import { authorizeVoiceProcessing } from "./capability-consumer-enforcement";
import type { CapabilityService } from "./capability-resolver";
import {
  auditVoiceProfile,
  boundedVoiceText,
  createVoiceUseGrant,
  voiceCatalogKey,
  voiceProfileFromProvider,
} from "./voice-service-helpers";

export async function syncVoiceCatalog(input: {
  capabilities: CapabilityService;
  repository: RomeoRepository;
  subject: AuthSubject;
  voiceProvider: VoiceProvider;
}) {
  assertScope(input.subject, "voices:manage");
  await authorizeVoiceProcessing(input.capabilities, input.subject);
  await assertAbuseControlsAllow(input.repository, input.subject, {
    action: "voice.request",
    workerClass: "voice.catalog_sync",
  });
  const catalog = await input.voiceProvider.listVoices(input.subject.orgId);
  if (catalog.length > 100)
    throw new ApiError(
      "voice_catalog_too_large",
      "Voice provider catalog sync is limited to 100 voices.",
      413,
    );

  const existing = await input.repository.listVoiceProfiles(
    input.subject.orgId,
  );
  const existingKeys = new Set(
    existing.map((voice) =>
      voiceCatalogKey(voice.providerId, voice.providerVoiceId),
    ),
  );
  const imported = await input.repository.transaction(async (repository) => {
    const createdProfiles: VoiceProfile[] = [];
    for (const providerVoice of catalog) {
      const candidate = voiceProfileFromProvider(
        input.subject.orgId,
        providerVoice,
      );
      const key = voiceCatalogKey(
        candidate.providerId,
        candidate.providerVoiceId,
      );
      if (existingKeys.has(key)) continue;
      const created = await repository.createVoiceProfile(candidate);
      await createVoiceUseGrant(repository, input.subject, created.id);
      existingKeys.add(key);
      createdProfiles.push(created);
    }

    await auditVoiceProfile(
      repository,
      input.subject,
      "voice.catalog_sync",
      "voice_catalog",
      {
        providerVoiceCount: catalog.length,
        importedCount: createdProfiles.length,
        existingCount: catalog.length - createdProfiles.length,
        providerIds: [
          ...new Set(
            catalog.map((voice) => boundedVoiceText(voice.providerId, 120)),
          ),
        ].sort(),
      },
    );
    return createdProfiles;
  });

  return {
    imported: imported.length,
    existing: catalog.length - imported.length,
    providerVoiceCount: catalog.length,
    profiles: imported,
  };
}
