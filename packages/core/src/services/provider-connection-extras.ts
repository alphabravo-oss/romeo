import type { RomeoRepository } from "../domain/repository";
import type { SanitizedProviderConnectionConfig } from "./provider-connection-config";

export const PROVIDER_CONNECTION_EXTRAS_SCHEMA =
  "romeo.provider-connection-extras.v1";

export interface ProviderConnectionExtras {
  auth?: SanitizedProviderConnectionConfig["auth"];
  deployment?: string;
  project?: string;
  region?: string;
  target?: SanitizedProviderConnectionConfig["target"];
}

export async function saveProviderConnectionExtras(
  repository: RomeoRepository,
  input: {
    extras: ProviderConnectionExtras;
    orgId: string;
    providerId: string;
  },
): Promise<void> {
  const extras = publicProviderConnectionExtras(input.extras);
  if (Object.keys(extras).length === 0) return;
  await repository.upsertSystemSetting({
    key: extrasKey(input.providerId),
    updatedAt: new Date().toISOString(),
    value: {
      ...extras,
      orgId: input.orgId,
      schema: PROVIDER_CONNECTION_EXTRAS_SCHEMA,
    },
  });
}

export async function readProviderConnectionExtras(
  repository: RomeoRepository,
  orgId: string,
  providerId: string,
): Promise<ProviderConnectionExtras | undefined> {
  return parseExtras(
    (await repository.getSystemSetting(extrasKey(providerId)))?.value,
    orgId,
  );
}

export async function readProviderConnectionExtrasById(
  repository: RomeoRepository,
  orgId: string,
): Promise<Map<string, ProviderConnectionExtras>> {
  const extras = new Map<string, ProviderConnectionExtras>();
  for (const setting of await repository.listSystemSettings()) {
    if (!setting.key.startsWith("provider.connection-extras.v1:")) continue;
    const parsed = parseExtras(setting.value, orgId);
    if (parsed === undefined) continue;
    extras.set(setting.key.slice("provider.connection-extras.v1:".length), parsed);
  }
  return extras;
}

export function publicProviderConnectionExtras(
  extras: ProviderConnectionExtras,
): ProviderConnectionExtras {
  return {
    ...(extras.auth === undefined ? {} : { auth: extras.auth }),
    ...(extras.deployment === undefined ? {} : { deployment: extras.deployment }),
    ...(extras.project === undefined ? {} : { project: extras.project }),
    ...(extras.region === undefined ? {} : { region: extras.region }),
    ...(extras.target === undefined ? {} : { target: extras.target }),
  };
}

function extrasKey(providerId: string): string {
  return `provider.connection-extras.v1:${providerId}`;
}

function parseExtras(
  value: unknown,
  orgId: string,
): ProviderConnectionExtras | undefined {
  if (value === null || typeof value !== "object" || Array.isArray(value))
    return undefined;
  const candidate = value as Record<string, unknown>;
  if (
    candidate.schema !== PROVIDER_CONNECTION_EXTRAS_SCHEMA ||
    candidate.orgId !== orgId
  )
    return undefined;
  return publicProviderConnectionExtras({
    ...(typeof candidate.auth === "string" ? { auth: candidate.auth as never } : {}),
    ...(typeof candidate.deployment === "string"
      ? { deployment: candidate.deployment }
      : {}),
    ...(typeof candidate.project === "string" ? { project: candidate.project } : {}),
    ...(typeof candidate.region === "string" ? { region: candidate.region } : {}),
    ...(typeof candidate.target === "string"
      ? { target: candidate.target as never }
      : {}),
  });
}
