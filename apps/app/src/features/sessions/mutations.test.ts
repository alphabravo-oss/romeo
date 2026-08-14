import { beforeEach, describe, expect, it, vi } from "vitest";

import { approveImpersonationRequest } from "./mutations";

const apiMocks = vi.hoisted(() => ({
  configureBrowserApiClients: vi.fn(),
  impersonationApproveRequest: vi.fn(),
}));

vi.mock("@romeo/api-client/generated/sdk", () => ({
  impersonationApproveRequest: apiMocks.impersonationApproveRequest,
}));
vi.mock("@romeo/api-client/runtime/browser", () => ({
  configureBrowserApiClients: apiMocks.configureBrowserApiClients,
}));

describe("session mutation transport", () => {
  beforeEach(() => vi.clearAllMocks());

  it("drops the one-time impersonation bearer token before returning", async () => {
    const session = {
      createdAt: "2026-01-01T00:00:00.000Z",
      expiresAt: "2026-01-01T01:00:00.000Z",
      id: "session-1",
      isAdmin: false,
      name: "support",
      orgId: "org-1",
      scopes: ["me:read"],
      userId: "user-1",
    };
    apiMocks.impersonationApproveRequest.mockResolvedValueOnce({
      data: { data: { session, token: "BEARER_SECRET" } },
    });

    const result = await approveImpersonationRequest("request-1");

    expect(apiMocks.configureBrowserApiClients).toHaveBeenCalledOnce();
    expect(apiMocks.impersonationApproveRequest).toHaveBeenCalledWith({
      path: { requestId: "request-1" },
      throwOnError: true,
    });
    expect(result).toEqual(session);
    expect(JSON.stringify(result)).not.toContain("BEARER_SECRET");
  });
});
