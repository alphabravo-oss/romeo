import { seededSubject, type AuthSubject } from "@romeo/auth";
import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { OrganizationCapabilityFlagService } from "./services/organization-capability-flag-service";
import { capabilityFlagUsageStore } from "./services/capability-flag-observability";

describe("organization capability flags", () => {
  it("resolves disabled, preview allowlists, idempotency, and platform precedence", async () => {
    capabilityFlagUsageStore.reset();
    const repository = new InMemoryRomeoRepository();
    const service = new OrganizationCapabilityFlagService(repository, {
      disabledCapabilityIds: [],
    });
    const disabled = await service.update({
      subject: seededSubject,
      flagId: "image_jobs_v2",
      state: "disabled",
      allowlistedSubjects: [],
      reason: "Controlled rollout",
      expectedVersion: 0,
    });
    const idempotent = await service.update({
      subject: seededSubject,
      flagId: "image_jobs_v2",
      state: "disabled",
      allowlistedSubjects: [],
      reason: "Repeated request does not append another revision",
      expectedVersion: 0,
    });
    expect(idempotent.id).toBe(disabled.id);
    expect(
      (await service.resolve(seededSubject, "image_jobs_v2")).effectiveState,
    ).toBe("disabled");

    const preview = await service.update({
      subject: seededSubject,
      flagId: "image_jobs_v2",
      state: "preview",
      allowlistedSubjects: [
        { subjectType: "user", subjectId: seededSubject.id },
      ],
      reason: "Preview cohort",
      expectedVersion: 1,
    });
    expect(preview.version).toBe(2);
    expect(
      (await service.resolve(seededSubject, "image_jobs_v2")).reasonCode,
    ).toBe("preview_allowlisted");
    const other = { ...seededSubject, id: "not_allowlisted" };
    expect((await service.resolve(other, "image_jobs_v2")).reasonCode).toBe(
      "preview_not_allowlisted",
    );

    const platformService = new OrganizationCapabilityFlagService(repository, {
      disabledCapabilityIds: ["image_generation", "external_provider_use"],
    });
    expect(
      (await platformService.resolve(seededSubject, "image_jobs_v2"))
        .reasonCode,
    ).toBe("platform_disabled");
    await service.update({
      subject: seededSubject,
      flagId: "provider_capabilities_v2",
      state: "enabled",
      allowlistedSubjects: [],
      reason: "Tenant enable cannot override the deployment",
      expectedVersion: 0,
    });
    expect(
      (await platformService.resolve(seededSubject, "provider_capabilities_v2"))
        .reasonCode,
    ).toBe("platform_disabled");
    const report = await platformService.adminReport(seededSubject);
    expect(report.platformDisabledFlagIds).toEqual([
      "provider_capabilities_v2",
      "image_jobs_v2",
    ]);
    expect(
      report.definitions.find((item) => item.id === "image_jobs_v2")
        ?.consumerStatus,
    ).toBe("enforced");
    expect(
      report.definitions.find((item) => item.id === "trust_plane_v1")
        ?.consumerStatus,
    ).toBe("enforced");
    const operational = capabilityFlagUsageStore.snapshot();
    expect(operational.total).toBeGreaterThan(0);
    expect(JSON.stringify(operational)).not.toContain(seededSubject.id);
    expect(JSON.stringify(operational)).not.toContain("Controlled rollout");
  });

  it("serves tenant-scoped routes and does not put subject ids or reasons in audit metadata", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const response = await api.request(
      "/api/v1/admin/capability-flags/image_jobs_v2",
      {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          state: "preview",
          allowlistedSubjects: [
            { subjectType: "user", subjectId: seededSubject.id },
          ],
          reason: "PRIVATE_REASON_SENTINEL",
          expectedVersion: 0,
        }),
      },
    );
    expect(response.status).toBe(200);
    const effective = await api.request("/api/v1/capability-flags/effective");
    expect(effective.status).toBe(200);
    const report = await api.request("/api/v1/admin/capability-flags");
    expect(report.status).toBe(200);
    const reportBody = await report.json();
    expect(reportBody.data.platformDisabledFlagIds).not.toContain(
      "image_jobs_v2",
    );
    expect(reportBody.data.platformDisabledFlagIds).toContain(
      "compute_artifacts_v1",
    );
    expect(
      reportBody.data.definitions.find(
        (item: { id: string }) => item.id === "image_jobs_v2",
      ),
    ).toMatchObject({ consumerStatus: "enforced" });
    expect(
      reportBody.data.definitions.find(
        (item: { id: string }) => item.id === "stream_transport_v2",
      ),
    ).toMatchObject({ consumerStatus: "enforced" });
    expect(
      reportBody.data.definitions.find(
        (item: { id: string }) => item.id === "virtual_transcript_v1",
      ),
    ).toMatchObject({ consumerStatus: "reserved" });
    const audit = (await repository.listAuditLogs(seededSubject.orgId)).find(
      (entry) => entry.action === "admin.capability_flag.replace",
    );
    const serializedMetadata = JSON.stringify(audit?.metadata);
    expect(serializedMetadata).not.toContain("PRIVATE_REASON_SENTINEL");
    expect(serializedMetadata).not.toContain(seededSubject.id);
  });

  it("blocks image jobs before provider or file side effects", async () => {
    const repository = new InMemoryRomeoRepository();
    let providerCalls = 0;
    const api = createRomeoApi(repository, {
      providerFetch: async () => {
        providerCalls += 1;
        return Response.json({ data: [] });
      },
    });
    expect(
      (
        await api.request("/api/v1/admin/capability-flags/image_jobs_v2", {
          method: "PUT",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({
            state: "disabled",
            reason: "Emergency disable",
            expectedVersion: 0,
          }),
        })
      ).status,
    ).toBe(200);
    const response = await api.request("/api/v1/images/generations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        modelId: "model_openai_compatible_default",
        prompt: "privacy sentinel",
        count: 1,
        size: "1024x1024",
      }),
    });
    expect(response.status).toBe(403);
    expect(providerCalls).toBe(0);
    expect(await repository.listFileObjects("org_default")).toEqual([]);
  });

  it("rejects unauthorized updates and cross-tenant allowlist probes with stable errors", async () => {
    const repository = new InMemoryRomeoRepository();
    const service = new OrganizationCapabilityFlagService(repository, {
      disabledCapabilityIds: [],
    });
    const unauthorized: AuthSubject = {
      id: seededSubject.id,
      type: seededSubject.type,
      orgId: seededSubject.orgId,
      workspaceIds: seededSubject.workspaceIds,
      groupIds: seededSubject.groupIds,
      scopes: ["capabilities:read"],
      isAdmin: false,
    };
    await expect(
      service.update({
        subject: unauthorized,
        flagId: "trust_plane_v1",
        state: "enabled",
        allowlistedSubjects: [],
        reason: "No authority",
      }),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      service.update({
        subject: seededSubject,
        flagId: "trust_plane_v1",
        state: "preview",
        allowlistedSubjects: [
          { subjectType: "user", subjectId: "foreign_user" },
        ],
        reason: "Probe",
      }),
    ).rejects.toMatchObject({ code: "not_found", status: 404 });
  });

  it("rejects a limited principal at the admin route", async () => {
    const repository = new InMemoryRomeoRepository();
    const api = createRomeoApi(repository);
    const authorization = await api.request("/api/v1/device-authorizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "capability flag reader",
        scopes: ["me:read"],
      }),
    });
    const credentials = await authorization.json();
    const response = await api.request(
      "/api/v1/admin/capability-flags/trust_plane_v1",
      {
        method: "PUT",
        headers: {
          authorization: `Bearer ${credentials.data.accessToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ state: "enabled", reason: "unauthorized" }),
      },
    );
    expect(response.status).toBe(403);
    expect(
      await repository.listActiveOrganizationCapabilityFlags({
        orgId: "org_default",
      }),
    ).toEqual([]);
  });
});
