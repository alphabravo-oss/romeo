import type {
  BootstrapResponse,
  EffectiveCapability,
} from "@romeo/api-client/generated/query";
import type { GeneratedQueryClient } from "@romeo/api-client/runtime/generated-query-client";
import { dehydrate } from "@tanstack/react-query";
import { describe, expect, it, vi } from "vitest";

import { bootstrapQueryOptions } from "./api-query-options";
import * as appQueryKeys from "./app-query-keys";
import { createRomeoQueryClient, routeDehydrateOptions } from "./query-client";
import {
  effectiveCapabilitiesQueryOptions,
  routerSessionSnapshotQueryOptions,
  sanitizeRouterSession,
} from "./router-runtime-data";

const secretBootstrap: BootstrapResponse = {
  deployment: { tenancyMode: "multi" },
  organizations: [],
  subject: {
    apiKeyId: "key-secret",
    groupIds: ["sensitive-group"],
    id: "subject-a",
    isAdmin: true,
    orgId: "org-a",
    scopes: ["platform:secret"],
    sessionId: "session-secret",
    supportSession: {
      adminUserId: "support-admin",
      createdAuditLogId: "audit-secret",
    },
    type: "user",
    workspaceIds: ["workspace-a"],
  },
  workspaces: [
    {
      id: "workspace-a",
      name: "Workspace A",
      orgId: "org-a",
      slug: "workspace-a",
    },
    {
      id: "workspace-ungranted",
      name: "Ungrantable",
      orgId: "org-a",
      slug: "workspace-ungranted",
    },
  ],
};

const effectiveCapability: EffectiveCapability = {
  assignmentVersions: [{ layer: "organization", version: 99 }],
  capabilityId: "image_generation",
  dimensions: {
    allowed: "yes",
    available: "yes",
    capable: "yes",
    entitled: "yes",
    installed: "yes",
    selected: "defaulted",
  },
  effective: {
    allowedSizes: ["1024x1024"],
    maxImagesPerRequest: 2,
  },
  reasons: [{ code: "organization_policy", layer: "organization" }],
  registryVersion: "private-policy-version",
  requestedChanges: [],
  resolvedAt: "2026-08-14T00:00:00.000Z",
  status: "enabled",
};

describe("sanitized router runtime data", () => {
  it("hydrates only the safe subject/session projection", async () => {
    const queryClient = createRomeoQueryClient();
    const rawClient = {
      getConfig: () => ({ baseUrl: "https://romeo.example/api/v1" }),
      get: vi.fn(() => Promise.resolve({ data: secretBootstrap })),
    } as unknown as GeneratedQueryClient;
    await queryClient.fetchQuery(bootstrapQueryOptions(rawClient));
    await queryClient.fetchQuery(
      routerSessionSnapshotQueryOptions(
        sanitizeRouterSession(secretBootstrap, "fr"),
      ),
    );

    const dehydrated = dehydrate(queryClient, routeDehydrateOptions);
    const serialized = JSON.stringify(dehydrated);
    expect(serialized).toContain("subject-a");
    expect(serialized).toContain('"locale":"fr"');
    expect(serialized).toContain("workspace-a");
    expect(serialized).not.toContain("workspace-ungranted");
    expect(serialized).not.toContain("session-secret");
    expect(serialized).not.toContain("key-secret");
    expect(serialized).not.toContain("platform:secret");
    expect(serialized).not.toContain("sensitive-group");
    expect(serialized).not.toContain("support-admin");
  });

  it("keeps subject, organization, and support-session caches request-isolated", async () => {
    const first = createRomeoQueryClient();
    const second = createRomeoQueryClient();
    await Promise.all([
      first.fetchQuery(
        routerSessionSnapshotQueryOptions(
          sanitizeRouterSession(secretBootstrap, "es"),
        ),
      ),
      second.fetchQuery(
        routerSessionSnapshotQueryOptions(
          sanitizeRouterSession(
            {
              ...secretBootstrap,
              subject: {
                ...secretBootstrap.subject,
                id: "subject-b",
                orgId: "org-b",
                supportSession: {
                  adminUserId: "support-admin-b",
                  createdAuditLogId: "audit-secret-b",
                },
                workspaceIds: ["workspace-b"],
              },
              workspaces: [
                {
                  id: "workspace-b",
                  name: "Workspace B",
                  orgId: "org-b",
                  slug: "workspace-b",
                },
              ],
            },
            "en",
          ),
        ),
      ),
    ]);
    first.setQueryData(appQueryKeys.jobs(), ["org-a-job"]);
    second.setQueryData(appQueryKeys.jobs(), ["org-b-job"]);

    const firstDocument = JSON.stringify(
      dehydrate(first, routeDehydrateOptions),
    );
    const secondDocument = JSON.stringify(
      dehydrate(second, routeDehydrateOptions),
    );
    expect(firstDocument).toContain("subject-a");
    expect(firstDocument).not.toContain("subject-b");
    expect(firstDocument).toContain("org-a");
    expect(firstDocument).not.toContain("org-b");
    expect(secondDocument).toContain("subject-b");
    expect(secondDocument).not.toContain("subject-a");
    expect(secondDocument).toContain("org-b");
    expect(secondDocument).not.toContain("org-a");
    expect(firstDocument).not.toContain("support-admin");
    expect(secondDocument).not.toContain("support-admin-b");
    expect(first.getQueryData(appQueryKeys.jobs())).toEqual(["org-a-job"]);
    expect(second.getQueryData(appQueryKeys.jobs())).toEqual(["org-b-job"]);
  });

  it("caches sanitized capabilities per workspace across client navigation", async () => {
    const post = vi.fn(() =>
      Promise.resolve({ data: { data: [effectiveCapability] } }),
    );
    const apiClient = { post } as unknown as GeneratedQueryClient;
    const queryClient = createRomeoQueryClient();

    await queryClient.fetchQuery(
      effectiveCapabilitiesQueryOptions("workspace-a", apiClient),
    );
    await queryClient.fetchQuery(
      effectiveCapabilitiesQueryOptions("workspace-a", apiClient),
    );
    await queryClient.fetchQuery(
      effectiveCapabilitiesQueryOptions("workspace-b", apiClient),
    );

    expect(post).toHaveBeenCalledTimes(2);
    const serialized = JSON.stringify(
      dehydrate(queryClient, routeDehydrateOptions),
    );
    expect(serialized).toContain("workspace-a");
    expect(serialized).toContain("workspace-b");
    expect(serialized).toContain('"maxImagesPerRequest":2');
    expect(serialized).not.toContain("organization_policy");
    expect(serialized).not.toContain("private-policy-version");
    expect(serialized).not.toContain("assignmentVersions");
  });
});
