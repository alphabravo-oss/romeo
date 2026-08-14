import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { testEnv } from "./test-support/env";

describe("content policy version and approval HTTP", () => {
  it("creates, dry-runs, publishes, and rolls back an immutable version", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv(),
    });
    const created = await api.request("/api/v1/admin/content-policy/versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        detectors: {
          credit_card: "disabled",
          email_address: "redact",
          us_ssn: "disabled",
          api_token: "block",
        },
        approvalRequired: true,
      }),
    });
    expect(created.status).toBe(200);
    const version = (await created.json()).data;
    expect(version.state).toBe("draft");
    const sentinel = "email private@example.com token sk-abcdefghijklmnopqrstuvwxyz123456";
    const dry = await api.request(
      `/api/v1/admin/content-policy/versions/${version.id}/dry-run`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ content: sentinel }),
      },
    );
    expect(dry.status).toBe(200);
    const dryBody = await dry.json();
    expect(dryBody.data.action).toBe("block");
    expect(JSON.stringify(dryBody)).not.toContain("private@example.com");
    expect(JSON.stringify(dryBody)).not.toContain("sk-abcdefghijklmnopqrstuvwxyz");

    const published = await api.request(
      `/api/v1/admin/content-policy/versions/${version.id}/publish`,
      { method: "POST" },
    );
    expect(published.status).toBe(200);
    expect((await published.json()).data.state).toBe("published");

    const listed = await api.request("/api/v1/admin/content-policy/versions");
    expect(listed.status).toBe(200);
    expect((await listed.json()).data).toHaveLength(1);

    const second = await api.request("/api/v1/admin/content-policy/versions", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        detectors: {
          credit_card: "disabled",
          email_address: "audit",
          us_ssn: "disabled",
          api_token: "audit",
        },
      }),
    });
    const secondId = (await second.json()).data.id;
    await api.request(`/api/v1/admin/content-policy/versions/${secondId}/publish`, {
      method: "POST",
    });
    const rolled = await api.request("/api/v1/admin/content-policy/rollback", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ versionId: version.id }),
    });
    expect(rolled.status).toBe(200);
    expect((await rolled.json()).data.id).toBe(version.id);

    const decisions = await api.request("/api/v1/admin/content-policy/decisions");
    expect(decisions.status).toBe(200);
    expect(JSON.stringify(await decisions.json())).not.toContain("private@example.com");
  });

  it("requests and resolves a scoped expiring approval without match text", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv(),
    });
    const requested = await api.request("/api/v1/admin/content-policy/approvals", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        runId: "run_policy",
        decisionId: "dec_policy",
        expiresAt: "2027-08-14T12:00:00.000Z",
      }),
    });
    expect(requested.status).toBe(200);
    const approval = (await requested.json()).data;
    expect(approval.state).toBe("pending");
    expect(JSON.stringify(approval)).not.toContain("sk-");
    const resolved = await api.request(
      `/api/v1/admin/content-policy/approvals/${approval.id}/resolve`,
      {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ decision: "approve", runId: "run_policy" }),
      },
    );
    expect(resolved.status).toBe(200);
    expect((await resolved.json()).data.state).toBe("approved");
    const listed = await api.request("/api/v1/admin/content-policy/approvals");
    expect((await listed.json()).data[0].state).toBe("approved");
  });
});
