import { seededSubject } from "@romeo/auth";
import { PlatformCapabilityPostureSchema } from "@romeo/contracts";
import type { VoiceProvider } from "@romeo/voices";
import { describe, expect, it, vi } from "vitest";
import { MemoryObjectStore } from "@romeo/storage";

import { createRomeoApi } from "./api";
import { ApiError } from "./errors";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { testEnv } from "./test-support/env";
import {
  getCapabilityDefinition,
  listCapabilityDefinitions,
} from "./services/capability-definition-registry";
import { CapabilityService } from "./services/capability-resolver";
import { snapshotAgentCapabilityDefaults } from "./services/agent-version-capability-defaults";
import { VoiceService } from "./services/voice-service";
import { WebSearchService } from "./services/web-search-service";

describe("capability policy", () => {
  it("keeps the source registry valid and returns defensive copies", () => {
    const first = listCapabilityDefinitions();
    first[0]!.defaultConfiguration.allowedSizes!.length = 0;

    expect(getCapabilityDefinition("image_generation")).toMatchObject({
      id: "image_generation",
      schemaVersion: 1,
      defaultState: "enabled",
    });
    expect(
      listCapabilityDefinitions()[0]!.defaultConfiguration.allowedSizes,
    ).toHaveLength(3);
    expect(getCapabilityDefinition("unknown")).toBeUndefined();
    expect(listCapabilityDefinitions().map(({ id }) => id)).toEqual([
      "image_generation",
      "reasoning_policy",
      "voice_processing",
      "web_retrieval",
      "content_firewall",
      "knowledge_acl",
      "realtime_voice",
      "image_editing",
      "secure_compute",
      "multi_model_compare",
      "tenant_encryption",
      "data_export",
    ]);
  });

  it("applies versioned deny and clamp policy before provider and storage effects", async () => {
    const repository = new InMemoryRomeoRepository();
    const model = (await repository.getModel(
      "model_openai_compatible_default",
    ))!;
    await repository.updateModel({
      ...model,
      capabilities: { ...model.capabilities, imageGeneration: true },
      capabilitiesSource: "override",
    });
    let providerCalls = 0;
    let providerCount: number | undefined;
    const png =
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAusB9Y9ZlJkAAAAASUVORK5CYII=";
    const api = createRomeoApi(repository, {
      objectStore: new MemoryObjectStore(),
      providerFetch: async (_url, init) => {
        providerCalls += 1;
        providerCount = JSON.parse(String(init?.body)).n;
        return Response.json({ data: [{ b64_json: png }] });
      },
    });
    const assignmentUrl =
      "/api/v1/admin/capabilities/image_generation/assignment";
    const disable = await api.request(assignmentUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scopeType: "workspace",
        scopeId: "workspace_default",
        state: "disabled",
        configuration: {},
        reason: "Security rollout",
        expectedVersion: 0,
      }),
    });
    const stale = await api.request(assignmentUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scopeType: "workspace",
        scopeId: "workspace_default",
        state: "enabled",
        configuration: {},
        reason: "Stale editor",
        expectedVersion: 0,
      }),
    });
    const denied = await requestImages(api, 2);
    const disableBody = await disable.json();

    expect({ status: disable.status, body: disableBody }).toMatchObject({
      status: 200,
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error.code).toBe(
      "capability_assignment_version_conflict",
    );
    expect(denied.status).toBe(403);
    expect((await denied.json()).error).toMatchObject({
      code: "capability_not_allowed",
      details: { capabilityId: "image_generation" },
    });
    expect(providerCalls).toBe(0);

    const enable = await api.request(assignmentUrl, {
      method: "PUT",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        scopeType: "workspace",
        scopeId: "workspace_default",
        state: "enabled",
        configuration: {
          maxImagesPerRequest: 1,
          allowedSizes: ["1024x1024"],
        },
        reason: "Bounded pilot",
        expectedVersion: 1,
      }),
    });
    const generated = await requestImages(api, 2);
    const history = await api.request(
      "/api/v1/admin/capabilities/image_generation/history?scopeType=workspace&scopeId=workspace_default",
    );

    expect(enable.status).toBe(200);
    expect(generated.status).toBe(201);
    expect(providerCalls).toBe(1);
    expect(providerCount).toBe(1);
    expect((await generated.json()).data).toHaveLength(1);
    expect(history.status).toBe(200);
    expect(
      (await history.json()).data.map(
        (item: { version: number }) => item.version,
      ),
    ).toEqual([2, 1]);
  });

  it("exposes sanitized definitions, overview, explain, and effective APIs", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const definitions = await api.request(
      "/api/v1/admin/capabilities/definitions",
    );
    const overview = await api.request(
      "/api/v1/admin/capabilities/overview?scopeType=workspace&scopeId=workspace_default",
    );
    const explain = await api.request(
      "/api/v1/admin/capabilities/image_generation/explain?scopeType=workspace&scopeId=workspace_default",
    );
    const effective = await api.request("/api/v1/capabilities/effective", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilityIds: [
          "image_generation",
          "voice_processing",
          "web_retrieval",
        ],
        context: { workspaceId: "workspace_default" },
        requested: { web_retrieval: { maxSearchResults: 10 } },
      }),
    });

    expect(definitions.status).toBe(200);
    expect(overview.status).toBe(200);
    expect(explain.status).toBe(200);
    expect(effective.status).toBe(200);
    const definitionBody = await definitions.json();
    expect(definitionBody.data.map(({ id }: { id: string }) => id)).toEqual([
      "image_generation",
      "reasoning_policy",
      "voice_processing",
      "web_retrieval",
      "content_firewall",
      "knowledge_acl",
      "realtime_voice",
      "image_editing",
      "secure_compute",
      "multi_model_compare",
      "tenant_encryption",
      "data_export",
    ]);
    expect(definitionBody.data[0]).not.toHaveProperty("handler");
    expect(
      (await overview.json()).data.capabilities[0].effective,
    ).toHaveProperty("dimensions.installed");
    expect((await explain.json()).data).not.toHaveProperty("subject");
    const effectiveBody = await effective.json();
    expect(effectiveBody.data).toHaveLength(3);
    expect(effectiveBody.data[2]).toMatchObject({
      capabilityId: "web_retrieval",
      status: "enabled",
      effective: { maxSearchResults: 10, maxUrlsPerRequest: 5 },
      requestedChanges: [],
    });
    expect(effectiveBody.data[0].reasons).toEqual(
      expect.not.arrayContaining([
        expect.objectContaining({ secret: expect.anything() }),
      ]),
    );
  });

  it("makes the operator platform deny absolute and exposes only sanitized posture", async () => {
    const repository = new InMemoryRomeoRepository();
    const model = (await repository.getModel(
      "model_openai_compatible_default",
    ))!;
    await repository.updateModel({
      ...model,
      capabilities: { ...model.capabilities, imageGeneration: true },
      capabilitiesSource: "override",
    });
    let providerCalls = 0;
    const api = createRomeoApi(repository, {
      env: testEnv({
        CAPABILITY_PLATFORM_DISABLED_IDS:
          "image_generation,secure_compute,multi_model_compare",
      }),
      objectStore: new MemoryObjectStore(),
      providerFetch: async () => {
        providerCalls += 1;
        return Response.json({ data: [] });
      },
    });
    const tenantEnable = await api.request(
      "/api/v1/admin/capabilities/image_generation/assignment",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeType: "workspace",
          scopeId: "workspace_default",
          state: "enabled",
          configuration: {},
          reason: "Tenant enable cannot override operator control",
          expectedVersion: 0,
        }),
      },
    );
    const generated = await requestImages(api, 1);
    const effectiveResponse = await api.request(
      "/api/v1/capabilities/effective",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          capabilityIds: ["image_generation"],
          context: { workspaceId: "workspace_default" },
        }),
      },
    );
    const overviewResponse = await api.request(
      "/api/v1/admin/capabilities/overview?scopeType=workspace&scopeId=workspace_default",
    );
    const readinessResponse = await api.request("/api/v1/admin/readiness");
    const generatedBody = await generated.json();
    const effective = (await effectiveResponse.json()).data[0];
    const overview = (await overviewResponse.json()).data.capabilities[0];
    const readiness = (await readinessResponse.json()).data.checks.find(
      (check: { id: string }) => check.id === "capability_platform_policy",
    );
    const serialized = JSON.stringify({ effective, overview, readiness });

    expect(tenantEnable.status).toBe(200);
    expect(generated.status).toBe(403);
    expect(generatedBody.error).toMatchObject({
      code: "capability_platform_disabled",
      details: {
        capabilityId: "image_generation",
        reasonCodes: expect.arrayContaining(["platform_disabled"]),
      },
    });
    expect(providerCalls).toBe(0);
    expect(await repository.listFileObjects("org_default")).toHaveLength(0);
    expect(effective).toMatchObject({
      status: "disabled",
      dimensions: { allowed: "no" },
      reasons: [{ code: "platform_disabled", layer: "platform" }],
    });
    expect(overview.effective).toMatchObject({
      status: "disabled",
      dimensions: { allowed: "no" },
    });
    expect(readiness).toMatchObject({
      status: "pass",
      details: {
        operatorOnly: true,
        disabledCount: 3,
        imageGeneration: {
          allowed: false,
          reason: "platform_disabled",
        },
        rawConfigurationReturned: false,
      },
    });
    expect(serialized).not.toContain("secure_compute");
    expect(serialized).not.toContain("multi_model_compare");
    expect(serialized).not.toContain("CAPABILITY_PLATFORM_DISABLED_IDS");
  });

  it("exposes the deployment ceiling only to global administrators", async () => {
    const repository = new InMemoryRomeoRepository();
    const capabilities = new CapabilityService(repository, {
      disabledCapabilityIds: ["image_generation"],
    });
    const posture = capabilities.platformPosture(seededSubject);

    expect(PlatformCapabilityPostureSchema.parse(posture)).toEqual(posture);
    expect(posture).toMatchObject({
      controlPlane: "deployment_environment",
      mutableViaApi: false,
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          capabilityId: "image_generation",
          state: "disabled",
          reason: "platform_disabled",
        }),
      ]),
    });
    expect(JSON.stringify(posture)).not.toMatch(
      /CAPABILITY_PLATFORM_DISABLED_IDS|process\.env|secret/iu,
    );

    await expect(
      Promise.resolve().then(() =>
        capabilities.platformPosture({
          ...seededSubject,
          adminRole: "org_admin",
        }),
      ),
    ).rejects.toMatchObject({
      code: "global_admin_required",
      status: 403,
    });

    const api = createRomeoApi(repository, {
      env: testEnv({ CAPABILITY_PLATFORM_DISABLED_IDS: "image_generation" }),
      startBackgroundWorkers: false,
    });
    const response = await api.request("/api/v1/admin/capabilities/platform");
    expect(response.status).toBe(200);
    expect((await response.json()).data).toMatchObject({
      mutableViaApi: false,
      capabilities: expect.arrayContaining([
        expect.objectContaining({
          capabilityId: "image_generation",
          state: "disabled",
        }),
      ]),
    });
  });

  it("keeps organization denies dominant over workspace enables", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const update = async (
      scopeType: "organization" | "workspace",
      scopeId: string,
      state: "disabled" | "enabled",
    ) =>
      api.request("/api/v1/admin/capabilities/image_generation/assignment", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeType,
          scopeId,
          state,
          configuration: {},
          reason: "Layer precedence test",
          expectedVersion: 0,
        }),
      });

    expect(
      (await update("organization", "org_default", "disabled")).status,
    ).toBe(200);
    expect(
      (await update("workspace", "workspace_default", "enabled")).status,
    ).toBe(200);
    const response = await api.request("/api/v1/capabilities/effective", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilityIds: ["image_generation"],
        context: { workspaceId: "workspace_default" },
      }),
    });
    const effective = (await response.json()).data[0];

    expect(effective.status).toBe("not_allowed");
    expect(effective.reasons).toContainEqual({
      code: "organization_policy",
      layer: "organization",
    });
  });

  it("derives group and user assignments from the authenticated subject with deny dominance", async () => {
    const repository = new InMemoryRomeoRepository();
    const capabilities = new CapabilityService(repository);
    await capabilities.updateAssignment({
      subject: seededSubject,
      capabilityId: "web_retrieval",
      scope: { scopeType: "group", scopeId: "group_admins" },
      state: "disabled",
      configuration: {},
      reason: "Deny retrieval for the administrators group",
      expectedVersion: 0,
    });
    await capabilities.updateAssignment({
      subject: seededSubject,
      capabilityId: "web_retrieval",
      scope: { scopeType: "user", scopeId: seededSubject.id },
      state: "enabled",
      configuration: { maxSearchResults: 10 },
      reason: "A user enable cannot override a group deny",
      expectedVersion: 0,
    });

    const effective = await capabilities.resolve({
      subject: seededSubject,
      capabilityId: "web_retrieval",
    });
    expect(effective).toMatchObject({
      status: "not_allowed",
      dimensions: { allowed: "no" },
      reasons: expect.arrayContaining([
        { code: "group_policy", layer: "group" },
      ]),
      assignmentVersions: expect.arrayContaining([
        { layer: "group", version: 1 },
        { layer: "user", version: 1 },
      ]),
    });
    const audits = (await repository.listAuditLogs("org_default")).filter(
      (item) => item.action === "admin.capability_assignment.replace",
    );
    expect(audits).toHaveLength(2);
    expect(JSON.stringify(audits)).not.toContain(
      "A user enable cannot override a group deny",
    );
    expect(JSON.stringify(audits)).not.toContain('maxSearchResults":10');
  });

  it("keeps published agent-version defaults immutable while mutable agent policy can narrow them", async () => {
    const repository = new InMemoryRomeoRepository();
    const capabilities = new CapabilityService(repository);
    const agent = (await repository.getAgent("agent_default"))!;
    const baseVersion = (await repository.getAgentVersion(
      "agent_version_default_v1",
    ))!;
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    const version = await repository.createAgentVersion({
      ...baseVersion,
      id: "agent_version_capability_snapshot",
      version: 2,
      capabilityDefaults: [
        {
          capabilityId: "image_generation",
          state: "enabled",
          configuration: { maxImagesPerRequest: 1 },
          assignmentVersion: 7,
          expiresAt,
        },
      ],
    });
    await repository.updateAgent({
      ...agent,
      publishedVersionId: version.id,
      updatedAt: new Date().toISOString(),
    });
    await capabilities.updateAssignment({
      subject: seededSubject,
      capabilityId: "image_generation",
      scope: { scopeType: "agent", scopeId: agent.id },
      state: "enabled",
      configuration: { maxImagesPerRequest: 4 },
      reason: "Mutable assignment remains broader than the published default",
      expectedVersion: 0,
    });

    const effective = await capabilities.resolve({
      subject: seededSubject,
      capabilityId: "image_generation",
      workspaceId: agent.workspaceId,
      agentId: agent.id,
    });
    expect(effective.effective.maxImagesPerRequest).toBe(1);
    expect(effective.assignmentVersions).toEqual(
      expect.arrayContaining([
        { layer: "agent_version", version: 7 },
        { layer: "agent", version: 1 },
      ]),
    );
    const explanation = await capabilities.explain({
      subject: seededSubject,
      capabilityId: "image_generation",
      scope: { scopeType: "agent", scopeId: agent.id },
    });
    expect(explanation.assignments).toContainEqual({
      id: version.id,
      layer: "agent_version",
      version: 7,
      state: "enabled",
      expiresAt,
    });
    expect(JSON.stringify(explanation.assignments)).not.toContain(
      "maxImagesPerRequest",
    );
    const versionsResponse = await createRomeoApi(repository).request(
      `/api/v1/agents/${agent.id}/versions`,
    );
    expect(versionsResponse.status).toBe(200);
    expect(JSON.stringify(await versionsResponse.json())).not.toContain(
      "capabilityDefaults",
    );
  });

  it("does not extend an expiring agent assignment through its published snapshot", async () => {
    const repository = new InMemoryRomeoRepository();
    const now = Date.now();
    const createdAt = new Date(now - 3_000).toISOString();
    const snapshotAt = new Date(now - 2_000).toISOString();
    const expiresAt = new Date(now - 1_000).toISOString();
    await repository.replaceCapabilityAssignment({
      assignment: {
        id: "assignment_expiring_agent_default",
        orgId: "org_default",
        scopeType: "agent",
        scopeId: "agent_default",
        capabilityId: "web_retrieval",
        state: "disabled",
        configuration: {},
        actorId: "user_dev_admin",
        reason: "Time-limited agent policy",
        effectiveAt: createdAt,
        expiresAt,
        createdAt,
      },
    });
    const defaults = await snapshotAgentCapabilityDefaults(repository, {
      agentId: "agent_default",
      orgId: "org_default",
      at: snapshotAt,
    });
    expect(defaults[0]).toMatchObject({ expiresAt, state: "disabled" });
    const agent = (await repository.getAgent("agent_default"))!;
    const baseVersion = (await repository.getAgentVersion(
      "agent_version_default_v1",
    ))!;
    const version = await repository.createAgentVersion({
      ...baseVersion,
      id: "agent_version_expired_capability_default",
      version: 2,
      capabilityDefaults: defaults,
    });
    await repository.updateAgent({
      ...agent,
      publishedVersionId: version.id,
      updatedAt: new Date(now).toISOString(),
    });

    const effective = await new CapabilityService(repository).resolve({
      subject: seededSubject,
      capabilityId: "web_retrieval",
      agentId: agent.id,
    });
    expect(effective.status).toBe("enabled");
    expect(effective.assignmentVersions).not.toContainEqual(
      expect.objectContaining({ layer: "agent_version" }),
    );
  });

  it("does not accept caller-supplied identity targets in effective previews", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository());
    const response = await api.request("/api/v1/capabilities/effective", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        capabilityIds: ["web_retrieval"],
        context: {
          workspaceId: "workspace_default",
          userId: "user_foreign",
          groupIds: ["group_foreign"],
        },
      }),
    });
    expect(response.status).toBe(400);
    expect(JSON.stringify(await response.json())).not.toContain("user_foreign");
  });

  it("requires an explicit workspace for identity previews and uses that exact ceiling", async () => {
    const repository = new InMemoryRomeoRepository();
    const capabilities = new CapabilityService(repository);
    await repository.createWorkspace({
      id: "workspace_capability_second",
      orgId: "org_default",
      name: "Second capability workspace",
      slug: "second-capability-workspace",
    });
    for (const [scopeId, maximum] of [
      ["workspace_default", 1],
      ["workspace_capability_second", 3],
    ] as const) {
      await capabilities.updateAssignment({
        subject: seededSubject,
        capabilityId: "image_generation",
        scope: { scopeType: "workspace", scopeId },
        state: "enabled",
        configuration: { maxImagesPerRequest: maximum },
        reason: "Workspace-specific identity preview ceiling",
        expectedVersion: 0,
      });
    }
    await expect(
      capabilities.adminOverview({
        subject: seededSubject,
        scope: { scopeType: "group", scopeId: "group_admins" },
      }),
    ).rejects.toMatchObject({
      code: "capability_assignment_invalid",
      status: 400,
    });

    const overview = await capabilities.adminOverview({
      subject: seededSubject,
      scope: { scopeType: "group", scopeId: "group_admins" },
      workspaceId: "workspace_capability_second",
    });
    expect(
      overview.capabilities.find(
        (item) => item.definition.id === "image_generation",
      )?.effective.effective.maxImagesPerRequest,
    ).toBe(3);
  });

  it("hides same-organization workspaces outside a delegated subject's access", async () => {
    const capabilities = new CapabilityService(new InMemoryRomeoRepository());
    const { adminRole: _adminRole, ...subjectWithoutAdminRole } = seededSubject;
    const delegated = {
      ...subjectWithoutAdminRole,
      isAdmin: false,
      workspaceIds: [],
    };
    const scope = {
      scopeType: "workspace" as const,
      scopeId: "workspace_default",
    };
    await expect(
      capabilities.adminOverview({ subject: delegated, scope }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      capabilities.explain({
        subject: delegated,
        scope,
        capabilityId: "image_generation",
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
    await expect(
      capabilities.updateAssignment({
        subject: delegated,
        scope,
        capabilityId: "image_generation",
        state: "disabled",
        configuration: {},
        reason: "Must not reach repository",
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("enforces web retrieval assignments and bounded configuration before network and quota effects", async () => {
    const repository = new InMemoryRomeoRepository();
    const capabilities = new CapabilityService(repository);
    const fetchImpl = vi.fn(async () =>
      Response.json({
        results: [
          { title: "one", url: "https://one.example.test", content: "one" },
          { title: "two", url: "https://two.example.test", content: "two" },
        ],
      }),
    );
    const service = new WebSearchService(repository, {
      capabilities,
      fetchImpl,
      hostLookup: async () => [{ address: "93.184.216.34", family: 4 }],
    });
    await service.updateConfiguration(seededSubject, {
      enabled: true,
      endpointUrl: "https://search.example.test/search",
      maxResults: 5,
    });
    await capabilities.updateAssignment({
      subject: seededSubject,
      capabilityId: "web_retrieval",
      scope: { scopeType: "organization", scopeId: "org_default" },
      state: "disabled",
      configuration: {},
      reason: "Disable external retrieval",
      expectedVersion: 0,
    });
    await expect(
      service.search(seededSubject, "denied query"),
    ).rejects.toMatchObject({
      code: "capability_not_allowed",
      status: 403,
    });
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(await repository.listUsageEvents("org_default")).toHaveLength(0);

    try {
      await capabilities.updateAssignment({
        subject: seededSubject,
        capabilityId: "web_retrieval",
        scope: { scopeType: "organization", scopeId: "org_default" },
        state: "enabled",
        configuration: { maxSearchResults: 1, maxUrlsPerRequest: 1 },
        reason: "Bound retrieval fan-out",
        expectedVersion: 1,
      });
      throw new Error("expected policy_bundle_approval_required");
    } catch (caught) {
      if (
        !(caught instanceof ApiError) ||
        caught.code !== "policy_bundle_approval_required"
      )
        throw caught;
      await capabilities.approvePublication({
        subject: { ...seededSubject, id: "user_security" },
        bundleId: String(caught.details.bundleId),
        reason: "Approve bounded retrieval fan-out",
      });
    }
    await expect(
      service.search(seededSubject, "bounded query"),
    ).resolves.toHaveLength(1);
    await expect(
      service.ingestUrls(seededSubject, [
        "https://one.example.test",
        "https://two.example.test",
      ]),
    ).rejects.toMatchObject({
      code: "capability_requested_value_outside_limit",
      status: 403,
    });
    expect(fetchImpl).toHaveBeenCalledTimes(1);

    await capabilities.updateAssignment({
      subject: seededSubject,
      capabilityId: "web_retrieval",
      scope: { scopeType: "agent", scopeId: "agent_default" },
      state: "disabled",
      configuration: {},
      reason: "Block retrieval for this agent",
      expectedVersion: 0,
    });
    await expect(
      service.search(seededSubject, "agent denied query", {
        workspaceId: "workspace_default",
        agentId: "agent_default",
        agentVersionId: "agent_version_default_v1",
      }),
    ).rejects.toMatchObject({ code: "capability_not_allowed", status: 403 });
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it("enforces voice processing assignments before every provider operation", async () => {
    const repository = new InMemoryRomeoRepository();
    const capabilities = new CapabilityService(repository);
    const provider: VoiceProvider = {
      listVoices: vi.fn(async () => []),
      synthesize: vi.fn(async () => ({
        id: "speech",
        contentType: "audio/wav",
        storageKey: "speech.wav",
      })),
      transcribe: vi.fn(async () => ({ text: "transcript" })),
    };
    const service = new VoiceService(
      repository,
      provider,
      new MemoryObjectStore(),
      capabilities,
    );
    await capabilities.updateAssignment({
      subject: seededSubject,
      capabilityId: "voice_processing",
      scope: { scopeType: "organization", scopeId: "org_default" },
      state: "disabled",
      configuration: {},
      reason: "Disable voice provider processing",
      expectedVersion: 0,
    });
    await expect(service.syncCatalog(seededSubject)).rejects.toMatchObject({
      code: "capability_not_allowed",
      status: 403,
    });
    await expect(
      service.transcribe({
        subject: seededSubject,
        audioBase64: "AA==",
        contentType: "audio/wav",
      }),
    ).rejects.toMatchObject({ code: "capability_not_allowed", status: 403 });
    await expect(
      service.preview({
        subject: seededSubject,
        voiceProfileId: "voice_default",
        text: "denied synthesis",
      }),
    ).rejects.toMatchObject({ code: "capability_not_allowed", status: 403 });
    expect(provider.listVoices).not.toHaveBeenCalled();
    expect(provider.transcribe).not.toHaveBeenCalled();
    expect(provider.synthesize).not.toHaveBeenCalled();
  });

  it("rejects unsupported workspace assignments for organization-wide capabilities", async () => {
    const capabilities = new CapabilityService(new InMemoryRomeoRepository());
    await expect(
      capabilities.updateAssignment({
        subject: seededSubject,
        capabilityId: "web_retrieval",
        scope: { scopeType: "workspace", scopeId: "workspace_default" },
        state: "disabled",
        configuration: {},
        reason: "Invalid child override",
        expectedVersion: 0,
      }),
    ).rejects.toMatchObject({
      code: "capability_assignment_invalid",
      status: 400,
    });
  });

  it("patches and previews reasoning controls with optimistic concurrency and no preview write", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository, { env: testEnv() });
    const patchBody = {
      scopeType: "organization",
      scopeId: "org_default",
      state: "enabled",
      configuration: {
        reasoningModeMaximum: "auto",
        reasoningEffortMaximum: "medium",
        maxReasoningTokens: 8_000,
        allowReasoningSummaryRetention: false,
      },
      reason: "Bound organization reasoning",
      expectedVersion: 0,
    };
    const updated = await api.request(
      "/api/v1/admin/capabilities/reasoning_policy/assignment",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patchBody),
      },
    );
    const conflict = await api.request(
      "/api/v1/admin/capabilities/reasoning_policy/assignment",
      {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(patchBody),
      },
    );
    const preview = await api.request(
      "/api/v1/admin/capabilities/reasoning_policy/assignment/preview",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          scopeType: "workspace",
          scopeId: "workspace_default",
          workspaceId: "workspace_default",
          state: "enabled",
          configuration: {
            reasoningEffortMaximum: "low",
            maxReasoningTokens: 2_000,
          },
          requested: {
            reasoningEffort: "high",
            maxReasoningTokens: 3_000,
          },
        }),
      },
    );
    const previewBody = (await preview.json()).data;

    expect(updated.status).toBe(200);
    expect(conflict.status).toBe(409);
    expect(preview.status).toBe(200);
    expect(previewBody.effective).toMatchObject({
      reasoningModeMaximum: "auto",
      reasoningEffortMaximum: "low",
      maxReasoningTokens: 2_000,
      allowReasoningSummaryRetention: false,
    });
    expect(previewBody.requestedChanges).toEqual(
      expect.arrayContaining([
        { path: "reasoningEffort", effect: "rejected" },
        { path: "maxReasoningTokens", effect: "rejected" },
      ]),
    );
    expect(
      await repository.listCapabilityAssignmentHistory({
        orgId: "org_default",
        scope: { scopeType: "workspace", scopeId: "workspace_default" },
        capabilityId: "reasoning_policy",
        limit: 10,
      }),
    ).toHaveLength(0);
    expect(
      JSON.stringify(await repository.listAuditLogs("org_default")),
    ).not.toContain("8000");
  });
});

function requestImages(api: ReturnType<typeof createRomeoApi>, count: number) {
  return api.request("/api/v1/images/generations", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      workspaceId: "workspace_default",
      modelId: "model_openai_compatible_default",
      prompt: "A secure abstract workspace",
      count,
      size: "1024x1024",
    }),
  });
}
