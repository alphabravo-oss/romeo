import type { AuthSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { InMemoryRomeoRepository } from "../repositories/in-memory";
import { RunEventSequencer } from "./run-event-sequencer";
import { RunService } from "./run-service";

// Per-chat model override: the caller may pass modelId on /api/v1/runs to run
// against a model other than the agent's published baseModelId. These tests
// exercise the security semantics added in resolveRunContext (run-context.ts)
// end to end through RunService.start, so the assertions cover the same path
// the HTTP route exercises: schema -> service -> resolveRunContext -> the
// persisted run.

describe("resolveRunContext model override", () => {
  it("uses the requested model when an override is supplied", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new RunService(repository, new RunEventSequencer(), undefined, undefined, undefined, {
      // The background streaming call is fire-and-forget from start()'s
      // perspective (see transaction-boundaries.test.ts's "rolls back run
      // start" test for the same pattern) -- start() resolves once the run
      // row is persisted, before this ever runs.
      providerFetch: async () => {
        throw new Error("Provider should not be called for this assertion.");
      },
    });

    const run = await service.start({
      subject: modelOverrideSubject(),
      chatId: "chat_welcome",
      agentId: "agent_default",
      content: "Answer using the Ollama model, please.",
      modelId: "model_ollama_default",
    });

    expect(run.modelId).toBe("model_ollama_default");
    expect(run.providerId).toBe("provider_ollama");

    const persisted = await repository.getRun(run.id);
    expect(persisted?.modelId).toBe("model_ollama_default");
    expect(persisted?.providerId).toBe("provider_ollama");
  });

  it("falls back to the agent version's baseModelId when no override is supplied", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new RunService(repository, new RunEventSequencer(), undefined, undefined, undefined, {
      providerFetch: async () => {
        throw new Error("Provider should not be called for this assertion.");
      },
    });

    const run = await service.start({
      subject: modelOverrideSubject(),
      chatId: "chat_welcome",
      agentId: "agent_default",
      content: "No override supplied.",
    });

    expect(run.modelId).toBe("model_openai_compatible_default");
    expect(run.providerId).toBe("provider_openai_compatible");

    const persisted = await repository.getRun(run.id);
    expect(persisted?.modelId).toBe("model_openai_compatible_default");
  });

  it("rejects a cross-org model id with 404, not 403", async () => {
    const repository = new InMemoryRomeoRepository();
    await repository.createOrganization({
      id: "org_other",
      name: "Other Org",
      slug: "other-org",
    });
    const foreignProvider = await repository.createProvider({
      id: "provider_cross_org",
      orgId: "org_other",
      type: "openai-compatible",
      name: "Cross-org provider",
      baseUrl: "https://provider.example.com/v1",
      enabled: true,
      capabilities: (await repository.getProvider("provider_openai_compatible"))!
        .capabilities,
    });
    const [foreignModel] = await repository.upsertModels([
      {
        id: "model_cross_org",
        providerId: foreignProvider.id,
        name: "cross-org-model",
        displayName: "Cross-org model",
        enabled: true,
        capabilities: foreignProvider.capabilities,
        contextWindow: 8192,
      },
    ]);
    // The caller happens to hold a "use" grant for the foreign model id (e.g.
    // stale or forged). The org-isolation check must still win -- an
    // authorized-looking cross-org id must not leak past cross-org isolation
    // as a 403 (which would confirm the id exists in another org).
    await repository.createResourceGrant({
      id: "grant_cross_org_model_use",
      resourceType: "model",
      resourceId: foreignModel!.id,
      principalType: "group",
      principalId: "group_admins",
      permission: "use",
    });

    const service = new RunService(repository, new RunEventSequencer());

    await expect(
      service.start({
        subject: modelOverrideSubject(),
        chatId: "chat_welcome",
        agentId: "agent_default",
        content: "Try to reach a model in another org.",
        modelId: "model_cross_org",
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("rejects a disabled model with 409", async () => {
    const repository = new InMemoryRomeoRepository();
    const provider = (await repository.getProvider(
      "provider_openai_compatible",
    ))!;
    const [disabledModel] = await repository.upsertModels([
      {
        id: "model_disabled_override",
        providerId: provider.id,
        name: "disabled-model",
        displayName: "Disabled model",
        enabled: false,
        capabilities: provider.capabilities,
        contextWindow: 8192,
      },
    ]);
    await repository.createResourceGrant({
      id: "grant_disabled_model_use",
      resourceType: "model",
      resourceId: disabledModel!.id,
      principalType: "group",
      principalId: "group_admins",
      permission: "use",
    });

    const service = new RunService(repository, new RunEventSequencer());

    await expect(
      service.start({
        subject: modelOverrideSubject(),
        chatId: "chat_welcome",
        agentId: "agent_default",
        content: "Try to run a disabled model.",
        modelId: "model_disabled_override",
      }),
    ).rejects.toMatchObject({ code: "model_disabled", status: 409 });
  });

  it("rejects a disabled provider with 409, even via the agent's own default model", async () => {
    const repository = new InMemoryRomeoRepository();
    const disabledProvider = await repository.createProvider({
      id: "provider_disabled_override",
      orgId: "org_default",
      type: "openai-compatible",
      name: "Disabled provider",
      baseUrl: "https://provider.example.com/v1",
      enabled: false,
      capabilities: (await repository.getProvider("provider_openai_compatible"))!
        .capabilities,
    });
    const [modelOnDisabledProvider] = await repository.upsertModels([
      {
        id: "model_on_disabled_provider",
        providerId: disabledProvider.id,
        name: "model-on-disabled-provider",
        displayName: "Model on disabled provider",
        enabled: true,
        capabilities: disabledProvider.capabilities,
        contextWindow: 8192,
      },
    ]);
    await repository.createResourceGrant({
      id: "grant_disabled_provider_model_use",
      resourceType: "model",
      resourceId: modelOnDisabledProvider!.id,
      principalType: "group",
      principalId: "group_admins",
      permission: "use",
    });
    await repository.createResourceGrant({
      id: "grant_disabled_provider_use",
      resourceType: "provider",
      resourceId: disabledProvider.id,
      principalType: "group",
      principalId: "group_admins",
      permission: "use",
    });

    const service = new RunService(repository, new RunEventSequencer());

    // Override path.
    await expect(
      service.start({
        subject: modelOverrideSubject(),
        chatId: "chat_welcome",
        agentId: "agent_default",
        content: "Try to run against a disabled provider via override.",
        modelId: "model_on_disabled_provider",
      }),
    ).rejects.toMatchObject({ code: "provider_disabled", status: 409 });

    // Agent-default path: the check is not conditional on the override being
    // used -- point the agent's own published version at the disabled
    // provider's model and confirm the default path is rejected identically.
    const agent = (await repository.getAgent("agent_default"))!;
    const version = (await repository.getAgentVersion(
      agent.publishedVersionId!,
    ))!;
    await repository.createAgentVersion({
      ...version,
      id: "agent_version_disabled_provider_default",
      version: version.version + 1,
      baseModelId: "model_on_disabled_provider",
    });
    await repository.updateAgent({
      ...agent,
      publishedVersionId: "agent_version_disabled_provider_default",
    });

    await expect(
      service.start({
        subject: modelOverrideSubject(),
        chatId: "chat_welcome",
        agentId: "agent_default",
        content: "Try to run against a disabled provider via the default.",
      }),
    ).rejects.toMatchObject({ code: "provider_disabled", status: 409 });
  });

  it("rejects an override to a model the caller has no use grant for", async () => {
    const repository = new InMemoryRomeoRepository();
    const provider = (await repository.getProvider(
      "provider_openai_compatible",
    ))!;
    // Enabled model, enabled provider, but deliberately no resource grant --
    // this must be rejected by assertRunAuthorized's model:use check, the
    // same authorization boundary the agent's default model already goes
    // through.
    await repository.upsertModels([
      {
        id: "model_no_grant",
        providerId: provider.id,
        name: "no-grant-model",
        displayName: "No-grant model",
        enabled: true,
        capabilities: provider.capabilities,
        contextWindow: 8192,
      },
    ]);

    const service = new RunService(repository, new RunEventSequencer());

    await expect(
      service.start({
        subject: modelOverrideSubject(),
        chatId: "chat_welcome",
        agentId: "agent_default",
        content: "Try to override to a model with no use grant.",
        modelId: "model_no_grant",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });
});

// Deliberately not isAdmin: true, so assertRunAuthorized's per-resource grant
// checks are actually exercised (an admin subject bypasses grants entirely).
// group_admins holds every seeded resource grant (see seed-data.ts), which is
// exactly what a caller needs to already be allowed to run the agent's
// default model -- the override must never reach further than that.
function modelOverrideSubject(): AuthSubject {
  return {
    id: "user_model_override",
    type: "user",
    orgId: "org_default",
    workspaceIds: ["workspace_default"],
    groupIds: ["group_admins"],
    scopes: ["agents:run", "runs:create"],
    isAdmin: false,
  };
}
