import { describe, expect, it } from "vitest";

import { createRomeoApi } from "./api";
import { legacyBillingEventId } from "./http/routes/billing";
import { InMemoryRomeoRepository } from "./repositories/in-memory";
import { testEnv } from "./test-support/env";

describe("public API compatibility retirement", () => {
  it("keeps retired workflow operations observable without executing them", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv(),
    });

    const response = await api.request("/api/v1/workflows");
    const body = await response.json();

    expect(response.status).toBe(409);
    expect(body.error.code).toBe("workflow_feature_retired");
    expect(response.headers.get("deprecation")).toBe("@1787443200");
    expect(response.headers.get("sunset")).toBe(
      "Tue, 23 Feb 2027 00:00:00 GMT",
    );
    expect(response.headers.get("link")).toContain('rel="deprecation"');
  });

  it("accepts legacy connector values at the schema boundary and rejects them explicitly", async () => {
    const api = createRomeoApi(new InMemoryRomeoRepository(), {
      env: testEnv(),
    });

    const connectorResponse = await api.request("/api/v1/data-connectors", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        workspaceId: "workspace_default",
        knowledgeBaseId: "kb_default",
        type: "notion",
        name: "Retired Notion connector",
      }),
    });
    const connectorBody = await connectorResponse.json();
    expect(connectorResponse.status).toBe(400);
    expect(connectorBody.error.code).toBe("connector_type_not_implemented");

    const oauthResponse = await api.request("/api/v1/delegated-oauth/start", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        providerId: "github",
        workspaceId: "workspace_default",
        connectorType: "slack",
      }),
    });
    const oauthBody = await oauthResponse.json();
    expect(oauthResponse.status).toBe(400);
    expect(oauthBody.error.code).toBe("delegated_oauth_connector_unsupported");
  });

  it("derives stable legacy billing event ids independent of object key order", () => {
    const first = legacyBillingEventId({
      provider: "stripe",
      eventType: "invoice.paid",
      metadata: { z: 1, a: 2 },
    });
    const second = legacyBillingEventId({
      metadata: { a: 2, z: 1 },
      eventType: "invoice.paid",
      provider: "stripe",
    });

    expect(first).toBe(second);
    expect(first).toMatch(/^legacy_[a-f0-9]{48}$/u);
  });
});
