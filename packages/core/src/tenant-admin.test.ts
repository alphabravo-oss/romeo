import { describe, expect, it } from "vitest";
import { MemoryObjectStore } from "@romeo/storage";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";

describe("tenant organization administration", () => {
  it("provisions organizations, gates global administration, and blocks suspended tenant uploads", async () => {
    const repository = new InMemoryRomeoRepository();
    const objectStore = new MemoryObjectStore();
    const api = createRomeoApi(repository, { objectStore });
    const password = "correct horse battery staple";

    const provisionResponse = await api.request("/api/v1/admin/organizations", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Acme Inc",
        slug: "acme-inc",
        defaultWorkspace: { name: "Operations", slug: "ops" },
        initialAdmin: {
          email: "ops-admin@acme.example",
          name: "Acme Ops Admin",
          password,
        },
      }),
    });
    const provisioned = await provisionResponse.json();

    const listResponse = await api.request("/api/v1/admin/organizations");
    const listed = await listResponse.json();
    const loginResponse = await api.request("/api/v1/auth/local/login", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        email: "ops-admin@acme.example",
        orgId: "org_acme_inc",
        password,
      }),
    });
    const orgAdminCookie = loginResponse.headers.get("set-cookie") ?? "";
    const orgAdminGlobalListResponse = await api.request(
      "/api/v1/admin/organizations",
      { headers: { cookie: orgAdminCookie } },
    );
    const fileResponse = await api.request("/api/v1/files", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: orgAdminCookie,
      },
      body: JSON.stringify({
        workspaceId: "workspace_acme_inc_ops",
        fileName: "purge-me.txt",
        mimeType: "text/plain",
        sizeBytes: 8,
        dataBase64: Buffer.from("purge me").toString("base64"),
      }),
    });
    const file = await fileResponse.json();
    const [createdFileRecord] =
      await repository.listFileObjects("org_acme_inc");
    const fileObjectKey = createdFileRecord?.objectKey ?? "";
    const objectBeforePurge = await objectStore.getObject(fileObjectKey);

    const suspendResponse = await api.request(
      "/api/v1/admin/organizations/org_acme_inc/suspend",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmOrgId: "org_acme_inc",
          reasonCode: "abuse_review",
        }),
      },
    );
    const suspended = await suspendResponse.json();
    const reactivateResponse = await api.request(
      "/api/v1/admin/organizations/org_acme_inc/reactivate",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmOrgId: "org_acme_inc" }),
      },
    );
    const reactivated = await reactivateResponse.json();
    const deletionResponse = await api.request(
      "/api/v1/admin/organizations/org_acme_inc/deletion-request",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmOrgId: "org_acme_inc",
          reasonCode: "customer_request",
        }),
      },
    );
    const deletionRequested = await deletionResponse.json();
    const previewBeforeEvidenceResponse = await api.request(
      "/api/v1/admin/organizations/org_acme_inc/deletion-finalization-preview",
    );
    const previewBeforeEvidence = await previewBeforeEvidenceResponse.json();
    const finalizationEvidenceResponse = await api.request(
      "/api/v1/admin/organizations/org_acme_inc/deletion-finalization-evidence",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmOrgId: "org_acme_inc",
          controls: [
            {
              control: "backup_retention_review",
              evidenceRefHash:
                "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
              status: "passed",
            },
            {
              control: "external_secret_store_review",
              status: "not_applicable",
            },
            {
              control: "external_vector_purge_review",
              status: "not_applicable",
            },
            {
              control: "object_store_purge_plan_review",
              status: "passed",
            },
            {
              control: "operational_log_retention_review",
              status: "passed",
            },
            {
              control: "postgres_purge_plan_review",
              status: "passed",
            },
            {
              control: "support_bundle_retention_review",
              status: "passed",
            },
          ],
        }),
      },
    );
    const finalizationEvidence = await finalizationEvidenceResponse.json();
    const blockedUploadResponse = await api.request("/api/v1/files/uploads", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        cookie: orgAdminCookie,
      },
      body: JSON.stringify({
        workspaceId: "workspace_acme_inc_ops",
        fileName: "blocked.txt",
        mimeType: "text/plain",
        sizeBytes: 7,
        sha256:
          "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef",
      }),
    });
    const blockedUpload = await blockedUploadResponse.json();
    const cancelDeletionResponse = await api.request(
      "/api/v1/admin/organizations/org_acme_inc/deletion-request/cancel",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ confirmOrgId: "org_acme_inc" }),
      },
    );
    const cancelDeletion = await cancelDeletionResponse.json();
    const secondDeletionResponse = await api.request(
      "/api/v1/admin/organizations/org_acme_inc/deletion-request",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmOrgId: "org_acme_inc",
          reasonCode: "customer_request",
        }),
      },
    );
    const purgeResponse = await api.request(
      "/api/v1/admin/organizations/org_acme_inc/deletion-finalization/execute",
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          confirmOrgId: "org_acme_inc",
          confirmPermanentDeletion: true,
        }),
      },
    );
    const purge = await purgeResponse.json();
    const purgedGetResponse = await api.request(
      "/api/v1/admin/organizations/org_acme_inc",
    );
    const auditResponse = await api.request("/api/v1/audit-logs");
    const audit = await auditResponse.json();
    const auditBody = JSON.stringify(audit);

    expect(provisionResponse.status).toBe(201);
    expect(provisioned.data).toMatchObject({
      organization: {
        id: "org_acme_inc",
        name: "Acme Inc",
        slug: "acme-inc",
      },
      defaultWorkspace: {
        id: "workspace_acme_inc_ops",
        orgId: "org_acme_inc",
        name: "Operations",
        slug: "ops",
      },
      initialAdmin: {
        email: "ops-admin@acme.example",
        role: "org_admin",
        localPasswordConfigured: true,
      },
      counts: { users: 1, workspaces: 1 },
      suspension: { suspended: false },
    });
    expect(listResponse.status).toBe(200);
    expect(
      listed.data.some(
        (item: { organization: { id: string } }) =>
          item.organization.id === "org_acme_inc",
      ),
    ).toBe(true);
    expect(loginResponse.status).toBe(200);
    expect(orgAdminGlobalListResponse.status).toBe(403);
    expect(fileResponse.status).toBe(201);
    expect(createdFileRecord?.id).toBe(file.data.id);
    expect(objectBeforePurge).toBeDefined();
    expect(suspendResponse.status).toBe(200);
    expect(suspended.data.suspension).toMatchObject({
      suspended: true,
      reasonCode: "abuse_review",
    });
    expect(reactivateResponse.status).toBe(200);
    expect(reactivated.data.suspension).toEqual({ suspended: false });
    expect(deletionResponse.status).toBe(200);
    expect(deletionRequested.data.deletionRequest).toMatchObject({
      status: "requested",
      reasonCode: "customer_request",
    });
    expect(deletionRequested.data.suspension).toMatchObject({
      suspended: true,
      reasonCode: "customer_request",
    });
    expect(previewBeforeEvidenceResponse.status).toBe(200);
    expect(previewBeforeEvidence.data).toMatchObject({
      orgId: "org_acme_inc",
      status: "blocked",
      preconditions: {
        deletionRequestActive: true,
        evidenceComplete: false,
        suspended: true,
      },
      redaction: {
        evidenceBodiesReturned: false,
        objectStoreKeysReturned: false,
        rawEvidenceRefsReturned: false,
        rawLogsReturned: false,
        secretValuesReturned: false,
        vectorValuesReturned: false,
      },
    });
    expect(previewBeforeEvidence.data.evidence.missingControls).toContain(
      "backup_retention_review",
    );
    expect(finalizationEvidenceResponse.status).toBe(200);
    expect(finalizationEvidence.data.status).toBe("ready");
    expect(finalizationEvidence.data.evidence.missingControls).toEqual([]);
    expect(finalizationEvidence.data.storageClasses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          evidenceControl: "postgres_purge_plan_review",
          id: "postgres_domain_records",
          status: "app_tracked",
        }),
        expect.objectContaining({
          evidenceControl: "object_store_purge_plan_review",
          id: "object_store_artifacts",
          status: "app_tracked",
        }),
      ]),
    );
    expect(blockedUploadResponse.status).toBe(403);
    expect(blockedUpload.error.details).toMatchObject({
      action: "file.upload",
      reasonCodes: ["org_suspended"],
    });
    expect(cancelDeletionResponse.status).toBe(200);
    expect(cancelDeletion.data.deletionRequest).toMatchObject({
      status: "cancelled",
      reasonCode: "customer_request",
    });
    expect(secondDeletionResponse.status).toBe(200);
    expect(purgeResponse.status).toBe(200);
    expect(purge.data).toMatchObject({
      schema: "romeo.tenant-physical-purge-result.v1",
      orgId: "org_acme_inc",
      status: "deleted",
      database: {
        organizationDeleted: true,
      },
      objectStore: {
        deletionFailures: 0,
        objectStoreKeysReturned: false,
        trackedObjectCount: 1,
        deletedObjectCount: 1,
        trackedObjectsByClass: {
          file_object: 1,
        },
      },
      externalEvidence: {
        backupsHandledByEvidence: true,
        externalSecretsHandledByEvidence: true,
        externalVectorsHandledByEvidence: true,
        operationalLogsHandledByEvidence: true,
        supportBundlesHandledByEvidence: true,
      },
      redaction: {
        evidenceBodiesReturned: false,
        objectStoreKeysReturned: false,
        rawEvidenceRefsReturned: false,
        secretValuesReturned: false,
        vectorValuesReturned: false,
      },
    });
    expect(purge.data.database.recordCounts.organizations).toBe(1);
    expect(purge.data.database.totalRecordCount).toBeGreaterThan(1);
    expect(await objectStore.getObject(fileObjectKey)).toBeUndefined();
    expect(purgedGetResponse.status).toBe(404);
    expect(
      (await repository.listSystemSettings()).some(
        (setting) =>
          setting.key ===
          "tenant_lifecycle.deletion_purge_result.v1:org_acme_inc",
      ),
    ).toBe(true);
    expect(auditBody).not.toContain(password);
    expect(
      audit.data.some(
        (log: { action: string; metadata: Record<string, unknown> }) =>
          log.action === "admin.organization.create" &&
          log.metadata.initialAdminCreated === true &&
          log.metadata.localPasswordConfigured === true,
      ),
    ).toBe(true);
    expect(
      audit.data.some(
        (log: { action: string; metadata: Record<string, unknown> }) =>
          log.action === "admin.organization.deletion_request" &&
          log.metadata.finalDeletionSupported === true,
      ),
    ).toBe(true);
    expect(
      audit.data.some(
        (log: { action: string; metadata: Record<string, unknown> }) =>
          log.action === "admin.organization.deletion_finalization_evidence" &&
          log.metadata.controlCount === 7 &&
          log.metadata.rawEvidenceReturned === false,
      ),
    ).toBe(true);
    expect(auditBody).not.toContain("var/run");
  });
});
