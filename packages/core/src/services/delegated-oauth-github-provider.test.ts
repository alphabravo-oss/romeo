import { describe, expect, it, vi } from "vitest";

import {
  exchangeGitHubDelegatedOAuth,
  refreshGitHubDelegatedOAuth,
} from "./delegated-oauth-github-provider";

const tokenUrl = "https://github.com/login/oauth/access_token";

describe("delegated GitHub OAuth egress", () => {
  it("uses separately constrained token and resource destinations", async () => {
    const calls: string[] = [];
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = String(input);
      calls.push(url);
      if (url === tokenUrl)
        return Response.json({
          access_token: "provider-access-token",
          scope: "repo read:user",
          token_type: "bearer",
        });
      if (url === "https://api.github.com/user")
        return Response.json({ id: 42, login: "octocat" });
      throw new Error("unreviewed destination");
    });

    await expect(
      exchangeGitHubDelegatedOAuth(
        {
          clientId: "client-id",
          clientSecret: "client-secret",
          code: "authorization-code",
          codeVerifier: "code-verifier",
          redirectUri: "https://romeo.example/api/v1/delegated-oauth/callback",
          requestedScopes: ["repo", "read:user"],
          tokenUrl,
        },
        fetchImpl,
      ),
    ).resolves.toMatchObject({
      providerAccountId: "42",
      providerAccountLogin: "octocat",
      scopes: ["repo", "read:user"],
    });
    expect(calls).toEqual([tokenUrl, "https://api.github.com/user"]);
  });

  it.each([
    "https://github.com.evil.test/login/oauth/access_token",
    "https://github.com/login/oauth/access_token?forward=1",
    "https://api.github.com/login/oauth/access_token",
    "http://github.com/login/oauth/access_token",
  ])(
    "blocks an unreviewed token endpoint before sending secrets: %s",
    async (url) => {
      const fetchImpl = vi.fn<typeof fetch>();
      const caught = await refreshGitHubDelegatedOAuth(
        {
          clientId: "client-id",
          clientSecret: "do-not-leak-client-secret",
          refreshToken: "do-not-leak-refresh-token",
          requestedScopes: ["repo"],
          tokenUrl: url,
        },
        fetchImpl,
      ).catch((error: unknown) => error);

      expect(fetchImpl).not.toHaveBeenCalled();
      expect(String(caught)).not.toContain("do-not-leak");
      expect(JSON.stringify(caught)).not.toContain("do-not-leak");
    },
  );

  it("does not forward a refresh token across a provider redirect", async () => {
    const fetchImpl = vi.fn<typeof fetch>(
      async () =>
        new Response(null, {
          status: 307,
          headers: { location: "https://api.github.com/capture" },
        }),
    );

    await expect(
      refreshGitHubDelegatedOAuth(
        {
          clientId: "client-id",
          clientSecret: "client-secret",
          refreshToken: "refresh-token",
          requestedScopes: ["repo"],
          tokenUrl,
        },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "delegated_oauth_provider_unreachable" });
    expect(fetchImpl).toHaveBeenCalledOnce();
  });

  it("does not forward an access token across a GitHub API redirect", async () => {
    const fetchImpl = vi.fn<typeof fetch>(async (input) =>
      String(input) === tokenUrl
        ? Response.json({
            access_token: "access-token",
            scope: "repo",
            token_type: "bearer",
          })
        : new Response(null, {
            status: 307,
            headers: { location: "https://github.com/capture" },
          }),
    );

    await expect(
      exchangeGitHubDelegatedOAuth(
        {
          clientId: "client-id",
          clientSecret: "client-secret",
          code: "authorization-code",
          codeVerifier: "code-verifier",
          redirectUri: "https://romeo.example/api/v1/delegated-oauth/callback",
          requestedScopes: ["repo"],
          tokenUrl,
        },
        fetchImpl,
      ),
    ).rejects.toMatchObject({ code: "delegated_oauth_account_lookup_failed" });
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });
});
