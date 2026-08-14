import { assertScope, canAccessOrg, type AuthSubject } from "@romeo/auth";
import {
  deleteOllamaModel,
  getProviderAdapter,
  pullOllamaModel,
  type ProviderInstance,
} from "@romeo/providers";

import type { RomeoRepository } from "../domain/repository";
import { ApiError, notFound } from "../errors";
import { writeAuditLog } from "./audit-log";
import { providerApiError } from "./provider-api-error";
import type { SecretResolver } from "./secret-resolver";
import { withTelemetryFetch } from "./telemetry-context";

export async function verifyProviderConnection(input: {
  fetchImpl?: typeof fetch;
  providerId: string;
  repository: RomeoRepository;
  secretResolver?: SecretResolver;
  subject: AuthSubject;
}) {
  assertScope(input.subject, "providers:write");
  const provider = await input.repository.getProvider(input.providerId);
  if (provider === undefined || !canAccessOrg(input.subject, provider.orgId))
    throw notFound("Provider");
  const resolution = await resolveProviderCredential(
    provider,
    input.secretResolver,
  );
  const startedAt = Date.now();
  const result = await getProviderAdapter(provider.type).health(provider, {
    ...(resolution?.value === undefined ? {} : { apiKey: resolution.value }),
    fetchImpl: withTelemetryFetch(input.fetchImpl ?? fetch),
  });
  const credentialRequired = provider.capabilities.deployment.credentialRequired;
  return {
    ...result,
    latencyMs: Date.now() - startedAt,
    checks: [
      {
        label: "Base URL",
        status: "pass" as const,
        detail: provider.baseUrl,
      },
      {
        label: "Credential",
        status:
          credentialRequired && resolution?.value === undefined
            ? ("fail" as const)
            : resolution?.value === undefined
              ? ("warning" as const)
              : ("pass" as const),
        detail:
          resolution?.value !== undefined
            ? "Managed credential resolved."
            : credentialRequired
              ? "A managed API credential is required."
              : "No credential required by this provider type.",
      },
      {
        label: "Model discovery",
        status: result.ok ? ("pass" as const) : ("fail" as const),
        detail: result.ok
          ? "The endpoint returned usable models."
          : provider.modelIds?.length
            ? "The configured model allowlist could not be verified."
            : "Check network reachability and Models API access, or configure allowed model IDs.",
      },
    ],
  };
}

export async function pullProviderRuntimeModel(input: {
  fetchImpl?: typeof fetch;
  model: string;
  providerId: string;
  repository: RomeoRepository;
  secretResolver?: SecretResolver;
  subject: AuthSubject;
}) {
  const provider = await requireOllamaProvider(input);
  const resolution = await resolveProviderCredential(
    provider,
    input.secretResolver,
  );
  let result;
  try {
    result = await pullOllamaModel(provider, input.model, {
      ...(resolution?.value === undefined ? {} : { apiKey: resolution.value }),
      fetchImpl: withTelemetryFetch(input.fetchImpl ?? fetch),
    });
  } catch (caught) {
    throw providerApiError(caught, {
      kind: provider.type,
      operation: "modelManagement",
    });
  }
  await writeAuditLog(input.repository, {
    action: "provider.model.pull",
    metadata: { model: input.model, status: result.status },
    resourceId: provider.id,
    resourceType: "provider",
    subject: input.subject,
  });
  return result;
}

export async function deleteProviderRuntimeModel(input: {
  fetchImpl?: typeof fetch;
  model: string;
  providerId: string;
  repository: RomeoRepository;
  secretResolver?: SecretResolver;
  subject: AuthSubject;
}) {
  const provider = await requireOllamaProvider(input, "delete");
  const resolution = await resolveProviderCredential(
    provider,
    input.secretResolver,
  );
  let result;
  try {
    result = await deleteOllamaModel(provider, input.model, {
      ...(resolution?.value === undefined ? {} : { apiKey: resolution.value }),
      fetchImpl: withTelemetryFetch(input.fetchImpl ?? fetch),
    });
  } catch (caught) {
    throw providerApiError(caught, {
      kind: provider.type,
      operation: "modelManagement",
    });
  }
  await writeAuditLog(input.repository, {
    action: "provider.model.delete",
    metadata: { model: input.model, status: result.status },
    resourceId: provider.id,
    resourceType: "provider",
    subject: input.subject,
  });
  return result;
}

function resolveProviderCredential(
  provider: ProviderInstance,
  secretResolver: SecretResolver | undefined,
) {
  return provider.credentialRef === undefined ||
    secretResolver?.resolveValue === undefined
    ? Promise.resolve(undefined)
    : secretResolver.resolveValue(provider.credentialRef);
}

async function requireOllamaProvider(
  input: {
    providerId: string;
    repository: RomeoRepository;
    subject: AuthSubject;
  },
  operation: "delete" | "pull" = "pull",
) {
  assertScope(input.subject, "providers:write");
  const provider = await input.repository.getProvider(input.providerId);
  if (provider === undefined || !canAccessOrg(input.subject, provider.orgId))
    throw notFound("Provider");
  if (provider.type !== "ollama") {
    throw new ApiError(
      "provider_operation_not_supported",
      operation === "delete"
        ? "Deleting runtime models is only supported for Ollama connections."
        : "Pulling models is only supported for Ollama connections.",
      400,
    );
  }
  return provider;
}
