import { afterEach, describe, expect, it, vi } from "vitest";

import {
  confirmTotpEnrollment,
  disableTotpFactor,
  localLogin,
  setLocalPassword,
  startOidcLogin,
  startSamlLogin,
  startTotpEnrollment,
  verifyLocalMfa,
} from "../features/auth";
import {
  createManagedSecret,
  getAuthProviderCatalog,
  getAuthProviderSettings,
  testAuthProviderConnection,
  updateAuthProviderSettings,
} from "../features/auth-provider-administration";
import { updateMyProfile } from "../features/identity";
import { forkChat, updateMessageFeedback } from "../features/chats";
import { getRun } from "../features/runs";
import { createChatFile } from "../features/files";
import {
  updateProvider,
  verifyProvider,
} from "../features/providers/mutations";
import {
  disableUser,
  setUserPassword,
  updateUserRole,
} from "../features/administration";

function mockFetch(returnBody: unknown = { data: {} }) {
  const fn = vi.fn(
    async (_url: string, _init?: RequestInit) =>
      new Response(JSON.stringify(returnBody), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
  );
  vi.stubGlobal("fetch", fn);
  return fn;
}

function lastCall(fn: ReturnType<typeof mockFetch>) {
  const call = fn.mock.calls.at(-1);
  const url = call?.[0] ?? "";
  const init = call?.[1] ?? {};
  return {
    url,
    method: init.method,
    body: init.body
      ? (JSON.parse(init.body as string) as Record<string, unknown>)
      : undefined,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("users-client — admin user modification", () => {
  it("updateUserRole PATCHes the role route and sets the confirmUserId guard", async () => {
    const fn = mockFetch({ data: { id: "u1", role: "org_admin" } });
    await updateUserRole({ userId: "u1", role: "org_admin" });
    const call = lastCall(fn);
    expect(call.url).toBe("/api/v1/users/u1/role");
    expect(call.method).toBe("PATCH");
    expect(call.body).toEqual({ confirmUserId: "u1", role: "org_admin" });
  });

  it("setUserPassword POSTs local-password with the confirmUserId guard", async () => {
    const fn = mockFetch({ data: {} });
    await setUserPassword({ userId: "u2", newPassword: "correcthorsebattery" });
    const call = lastCall(fn);
    expect(call.url).toBe("/api/v1/users/u2/local-password");
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({
      confirmUserId: "u2",
      newPassword: "correcthorsebattery",
    });
  });

  it("disableUser POSTs the disable route", async () => {
    const fn = mockFetch({ data: { id: "u3" } });
    await disableUser("u3");
    expect(lastCall(fn).url).toBe("/api/v1/users/u3/disable");
    expect(lastCall(fn).method).toBe("POST");
  });
});

describe("auth-client — local password + MFA", () => {
  it("logs in locally and returns an MFA challenge without storing the token", async () => {
    const fn = mockFetch({
      data: {
        status: "mfa_required",
        challengeToken: "challenge",
        expiresAt: "2030-01-01T00:00:00.000Z",
        methods: ["totp"],
      },
    });
    const result = await localLogin({
      email: "admin@example.com",
      password: "secret",
      orgId: "org_1",
    });
    expect(result.status).toBe("mfa_required");
    expect(lastCall(fn)).toMatchObject({
      url: "/api/v1/auth/local/login",
      method: "POST",
      body: {
        email: "admin@example.com",
        password: "secret",
        orgId: "org_1",
      },
    });
  });

  it("verifies local MFA through the public challenge endpoint", async () => {
    const fn = mockFetch({ data: { status: "authenticated" } });
    await verifyLocalMfa({ challengeToken: "challenge", code: "123456" });
    expect(lastCall(fn)).toMatchObject({
      url: "/api/v1/auth/local/mfa/verify",
      method: "POST",
      body: { challengeToken: "challenge", code: "123456" },
    });
  });

  it("starts OIDC and SAML with encoded local return paths", async () => {
    const fn = mockFetch({ data: { authorizationUrl: "https://idp.example" } });
    await startOidcLogin({ orgId: "org one", returnTo: "/workspace?a=1" });
    expect(lastCall(fn).url).toBe(
      "/api/v1/auth/oidc/start?orgId=org%20one&returnTo=%2Fworkspace%3Fa%3D1",
    );
    await startSamlLogin({ returnTo: "/admin" });
    expect(lastCall(fn).url).toBe("/api/v1/auth/saml/start?returnTo=%2Fadmin");
  });

  it("setLocalPassword posts to /auth/local/password", async () => {
    const fn = mockFetch({ data: {} });
    await setLocalPassword({ newPassword: "correcthorsebattery" });
    expect(lastCall(fn).url).toBe("/api/v1/auth/local/password");
    expect(lastCall(fn).body).toEqual({ newPassword: "correcthorsebattery" });
  });

  it("startTotpEnrollment posts to the enroll route", async () => {
    const fn = mockFetch({
      data: { factor: {}, otpauthUri: "otpauth://x", secret: "ABC" },
    });
    await startTotpEnrollment({});
    expect(lastCall(fn).url).toBe("/api/v1/auth/local/mfa/totp/enroll");
    expect(lastCall(fn).method).toBe("POST");
  });

  it("confirmTotpEnrollment posts factorId + code", async () => {
    const fn = mockFetch({ data: {} });
    await confirmTotpEnrollment({ factorId: "f1", code: "123456" });
    expect(lastCall(fn).url).toBe("/api/v1/auth/local/mfa/totp/confirm");
    expect(lastCall(fn).body).toEqual({ factorId: "f1", code: "123456" });
  });

  it("disableTotpFactor posts to the factor disable route (id url-encoded)", async () => {
    const fn = mockFetch({ data: {} });
    await disableTotpFactor({ factorId: "f 2" });
    expect(lastCall(fn).url).toBe(
      "/api/v1/auth/local/mfa/factors/f%202/disable",
    );
  });
});

describe("bootstrap-client — self profile", () => {
  it("updateMyProfile PATCHes /me with the provided fields", async () => {
    const fn = mockFetch({ data: {} });
    await updateMyProfile({ name: "New Name", email: "a@b.com" });
    const call = lastCall(fn);
    expect(call.url).toBe("/api/v1/me");
    expect(call.method).toBe("PATCH");
    expect(call.body).toEqual({ name: "New Name", email: "a@b.com" });
  });
});

describe("provider-client — connection administration", () => {
  it("updates connection configuration and enabled state", async () => {
    const fn = mockFetch({ data: { id: "provider_1" } });
    await updateProvider({
      providerId: "provider 1",
      name: "Local models",
      modelIds: ["llama3.2"],
      enabled: false,
    });
    const call = lastCall(fn);
    expect(call.url).toBe("/api/v1/providers/provider%201");
    expect(call.method).toBe("PATCH");
    expect(call.body).toEqual({
      name: "Local models",
      modelIds: ["llama3.2"],
      enabled: false,
    });
  });

  it("verifies a connection without modifying it", async () => {
    const fn = mockFetch({ data: { ok: true, message: "Connected." } });
    await verifyProvider("provider 1");
    const call = lastCall(fn);
    expect(call.url).toBe("/api/v1/providers/provider%201/verify");
    expect(call.method).toBe("POST");
    expect(call.body).toBeUndefined();
  });
});

describe("chat-client — rich chat actions", () => {
  it("reads an authoritative run record for stream recovery", async () => {
    const fn = mockFetch({ data: { id: "run_1", status: "completed" } });
    await getRun("run /1");
    expect(lastCall(fn).url).toBe("/api/v1/runs/run%20%2F1");
  });

  it("records response feedback", async () => {
    const fn = mockFetch({ data: { configured: true, rating: "positive" } });
    await updateMessageFeedback({
      chatId: "chat 1",
      messageId: "message 1",
      rating: "positive",
    });
    const call = lastCall(fn);
    expect(call.url).toBe(
      "/api/v1/chats/chat%201/messages/message%201/feedback",
    );
    expect(call.method).toBe("POST");
    expect(call.body).toEqual({ rating: "positive" });
  });

  it("forks a chat through a selected message", async () => {
    const fn = mockFetch({ data: { id: "fork" } });
    await forkChat({
      chatId: "chat 1",
      throughMessageId: "message 1",
      includeAttachments: true,
    });
    const call = lastCall(fn);
    expect(call.url).toBe("/api/v1/chats/chat%201/fork");
    expect(call.body).toEqual({
      throughMessageId: "message 1",
      includeAttachments: true,
    });
  });

  it("uploads governed chat files", async () => {
    const fn = mockFetch({ data: { id: "file_1" } });
    await createChatFile({
      workspaceId: "workspace_1",
      fileName: "policy.md",
      mimeType: "text/markdown",
      sizeBytes: 4,
      dataBase64: "dGVzdA==",
    });
    const call = lastCall(fn);
    expect(call.url).toBe("/api/v1/files");
    expect(call.body).toMatchObject({ purpose: "chat_attachment" });
  });

  it("retries file extraction", async () => {
    const { retryFileExtraction } = await import("../features/files");
    const fn = mockFetch({ data: { id: "file_1" } });
    await retryFileExtraction("file /1");
    const call = lastCall(fn);
    expect(call.url).toBe("/api/v1/files/file%20%2F1/extraction/retry");
    expect(call.method).toBe("POST");
  });
});

describe("auth-provider-client — SSO app store", () => {
  it("getAuthProviderCatalog GETs the catalog", async () => {
    const fn = mockFetch({ data: [] });
    await getAuthProviderCatalog();
    expect(lastCall(fn).url).toBe("/api/v1/admin/auth-providers/catalog");
  });

  it("getAuthProviderSettings GETs the settings", async () => {
    const fn = mockFetch({
      data: {
        global: { providers: [] },
        orgOverride: { orgId: "o", providers: [] },
        effective: { orgId: "o", providers: [] },
        notes: [],
      },
    });
    await getAuthProviderSettings();
    expect(lastCall(fn).url).toBe("/api/v1/admin/auth-providers/settings");
  });

  it("updateAuthProviderSettings PATCHes settings with the scope envelope", async () => {
    const fn = mockFetch({ data: {} });
    await updateAuthProviderSettings({
      global: { providers: [{ providerId: "okta", enabled: true }] },
    });
    const call = lastCall(fn);
    expect(call.url).toBe("/api/v1/admin/auth-providers/settings");
    expect(call.method).toBe("PATCH");
    expect(call.body).toEqual({
      global: { providers: [{ providerId: "okta", enabled: true }] },
    });
  });

  it("testAuthProviderConnection POSTs to the test route", async () => {
    const fn = mockFetch({ data: { status: "passed", checks: [] } });
    await testAuthProviderConnection({ providerId: "okta" });
    expect(lastCall(fn).url).toBe("/api/v1/admin/auth-providers/settings/test");
    expect(lastCall(fn).method).toBe("POST");
  });

  it("createManagedSecret POSTs to /admin/secrets and returns the ref", async () => {
    const fn = mockFetch({ data: { secretRef: "romeo-secret://abc" } });
    const ref = await createManagedSecret({
      purpose: "auth_provider_client_secret",
      value: "shh",
      scope: "global",
    });
    expect(lastCall(fn).url).toBe("/api/v1/admin/secrets");
    expect(lastCall(fn).method).toBe("POST");
    expect(ref.secretRef).toBe("romeo-secret://abc");
  });
});
