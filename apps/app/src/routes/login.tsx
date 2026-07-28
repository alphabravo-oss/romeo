import { Input, Button } from "@romeo/ui";
import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import ArrowRight from "lucide-react/dist/esm/icons/arrow-right.mjs";
import BotMessageSquare from "lucide-react/dist/esm/icons/bot-message-square.mjs";
import Check from "lucide-react/dist/esm/icons/check.mjs";
import Eye from "lucide-react/dist/esm/icons/eye.mjs";
import EyeOff from "lucide-react/dist/esm/icons/eye-off.mjs";
import KeyRound from "lucide-react/dist/esm/icons/key-round.mjs";
import LoaderCircle from "lucide-react/dist/esm/icons/loader-circle.mjs";
import LockKeyhole from "lucide-react/dist/esm/icons/lock-keyhole.mjs";
import Moon from "lucide-react/dist/esm/icons/moon.mjs";
import ShieldCheck from "lucide-react/dist/esm/icons/shield-check.mjs";
import Sun from "lucide-react/dist/esm/icons/sun.mjs";
import { useState, useSyncExternalStore, type FormEvent } from "react";

import {
  localLogin,
  startOidcLogin,
  startSamlLogin,
  verifyLocalMfa,
} from "../features/auth";
import { getBootstrap } from "../features/identity";
import { RomeoApiError } from "@romeo/api-client";
import { safeReturnTo } from "../lib/auth-navigation";
import { setTheme } from "../lib/theme";
import loginCss from "../styles/login.css?url";

interface LoginSearch {
  returnTo?: string;
}

function subscribeToTheme(onStoreChange: () => void) {
  window.addEventListener("romeo-theme-change", onStoreChange);
  window.addEventListener("storage", onStoreChange);
  return () => {
    window.removeEventListener("romeo-theme-change", onStoreChange);
    window.removeEventListener("storage", onStoreChange);
  };
}

function isDarkTheme(): boolean {
  return typeof document !== "undefined"
    ? document.documentElement.classList.contains("dark")
    : false;
}

export const Route = createFileRoute("/login")({
  head: () => ({
    links: [{ rel: "stylesheet", href: loginCss }],
  }),
  validateSearch: (search: Record<string, unknown>): LoginSearch => ({
    ...(typeof search.returnTo === "string"
      ? { returnTo: safeReturnTo(search.returnTo) }
      : {}),
  }),
  component: LoginPage,
});

function LoginPage() {
  const { returnTo = "/" } = Route.useSearch();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [organization, setOrganization] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [challengeToken, setChallengeToken] = useState<string>();
  const [mfaCode, setMfaCode] = useState("");
  const [useRecoveryCode, setUseRecoveryCode] = useState(false);
  const [error, setError] = useState<string>();
  const [pending, setPending] = useState<"local" | "oidc" | "saml">();
  const dark = useSyncExternalStore(subscribeToTheme, isDarkTheme, () => false);
  const sessionQuery = useQuery({
    queryKey: ["login-session"],
    queryFn: getBootstrap,
    retry: false,
  });

  async function submitLocal(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(undefined);
    setPending("local");
    try {
      if (challengeToken) {
        await verifyLocalMfa({
          challengeToken,
          ...(useRecoveryCode
            ? { recoveryCode: mfaCode.trim() }
            : { code: mfaCode.trim() }),
        });
        window.location.assign(returnTo);
        return;
      }
      const result = await localLogin({
        email: email.trim(),
        password,
        ...(organization.trim() ? { orgId: organization.trim() } : {}),
      });
      if (result.status === "mfa_required") {
        setChallengeToken(result.challengeToken);
        setMfaCode("");
        return;
      }
      window.location.assign(returnTo);
    } catch (caught) {
      setError(loginError(caught));
    } finally {
      setPending(undefined);
    }
  }

  async function beginEnterpriseLogin(kind: "oidc" | "saml") {
    setError(undefined);
    setPending(kind);
    try {
      const input = {
        returnTo,
        ...(organization.trim() ? { orgId: organization.trim() } : {}),
      };
      const result =
        kind === "oidc"
          ? await startOidcLogin(input)
          : await startSamlLogin(input);
      window.location.assign(result.authorizationUrl);
    } catch (caught) {
      setError(loginError(caught));
      setPending(undefined);
    }
  }

  function toggleTheme() {
    setTheme(dark ? "light" : "dark");
  }

  return (
    <main className="rm-login-shell">
      <section className="rm-login-brand" aria-label="About Romeo">
        <div className="rm-login-grid" aria-hidden="true" />
        <div className="rm-login-glow rm-login-glow-blue" aria-hidden="true" />
        <div
          className="rm-login-glow rm-login-glow-violet"
          aria-hidden="true"
        />

        <div className="rm-login-brandmark">
          <span className="rm-login-logo">
            <BotMessageSquare aria-hidden="true" size={22} />
          </span>
          <span>
            <strong>Romeo</strong>
            <small>by AlphaBravo</small>
          </span>
        </div>

        <div className="rm-login-pitch">
          <p className="rm-login-eyebrow">Enterprise AI, under your control</p>
          <h1>
            One secure workspace for
            <span>every conversation.</span>
          </h1>
          <p>
            Connect the models your organization trusts, preserve useful
            context, and keep access, data, and operations governed.
          </p>
        </div>

        <div className="rm-login-proof">
          <span>
            <Check aria-hidden="true" size={14} /> Governed model access
          </span>
          <span>
            <Check aria-hidden="true" size={14} /> Private workspace context
          </span>
          <span>
            <Check aria-hidden="true" size={14} /> Enterprise identity
          </span>
        </div>
      </section>

      <section className="rm-login-form-pane">
        <Button
          aria-label={dark ? "Use light theme" : "Use dark theme"}
          className="rm-login-theme"
          onClick={toggleTheme}
          type="button"
        >
          {dark ? (
            <Sun aria-hidden="true" size={17} />
          ) : (
            <Moon aria-hidden="true" size={17} />
          )}
        </Button>

        <div className="rm-login-form-wrap">
          <div className="rm-login-mobile-brand">
            <span className="rm-login-logo">
              <BotMessageSquare aria-hidden="true" size={22} />
            </span>
            <strong>Romeo</strong>
          </div>

          <header className="rm-login-heading">
            <p className="rm-login-eyebrow">Welcome back</p>
            <h2>Sign in to Romeo</h2>
            <p>Use your organization credentials to continue.</p>
          </header>

          {sessionQuery.data ? (
            <div className="rm-login-session">
              <span>
                <ShieldCheck aria-hidden="true" size={18} />
              </span>
              <div>
                <strong>You already have an active session</strong>
                <small>
                  {sessionQuery.data.subject?.email ??
                    sessionQuery.data.subject?.id}
                </small>
              </div>
              <a href={returnTo}>Continue</a>
            </div>
          ) : null}

          <div className="rm-login-sso-grid">
            <Button
              disabled={pending !== undefined}
              onClick={() => void beginEnterpriseLogin("oidc")}
              type="button"
            >
              {pending === "oidc" ? (
                <LoaderCircle className="rm-spin" size={16} />
              ) : (
                <KeyRound aria-hidden="true" size={16} />
              )}
              Continue with SSO
            </Button>
            <Button
              disabled={pending !== undefined}
              onClick={() => void beginEnterpriseLogin("saml")}
              type="button"
            >
              {pending === "saml" ? (
                <LoaderCircle className="rm-spin" size={16} />
              ) : (
                <LockKeyhole aria-hidden="true" size={16} />
              )}
              Continue with SAML
            </Button>
          </div>

          <div className="rm-login-divider">
            <span>or continue with password</span>
          </div>

          <form
            className="rm-login-form"
            onSubmit={(event) => void submitLocal(event)}
          >
            {challengeToken ? (
              <>
                <div className="rm-login-mfa-intro">
                  <ShieldCheck aria-hidden="true" size={20} />
                  <div>
                    <strong>Two-factor authentication</strong>
                    <small>Enter the code for this sign-in attempt.</small>
                  </div>
                </div>
                <label>
                  <span>
                    {useRecoveryCode ? "Recovery code" : "Authentication code"}
                  </span>
                  <Input
                    name="mfaCode"
                    autoComplete="one-time-code"
                    autoFocus
                    inputMode={useRecoveryCode ? "text" : "numeric"}
                    onChange={(event) => setMfaCode(event.currentTarget.value)}
                    placeholder={
                      useRecoveryCode ? "Enter a recovery code" : "000000"
                    }
                    required
                    value={mfaCode}
                  />
                </label>
                <Button
                  className="rm-login-link"
                  onClick={() => setUseRecoveryCode((value) => !value)}
                  type="button"
                >
                  {useRecoveryCode
                    ? "Use authenticator code"
                    : "Use a recovery code"}
                </Button>
              </>
            ) : (
              <>
                <label>
                  <span>Email address</span>
                  <Input
                    name="email"
                    autoComplete="email"
                    autoFocus
                    onChange={(event) => setEmail(event.currentTarget.value)}
                    placeholder="you@company.com"
                    required
                    type="email"
                    value={email}
                  />
                </label>
                <label>
                  <span>Password</span>
                  <div className="rm-login-password">
                    <Input
                      name="password"
                      autoComplete="current-password"
                      onChange={(event) =>
                        setPassword(event.currentTarget.value)
                      }
                      placeholder="Enter your password"
                      required
                      type={showPassword ? "text" : "password"}
                      value={password}
                    />
                    <Button
                      aria-label={
                        showPassword ? "Hide password" : "Show password"
                      }
                      onClick={() => setShowPassword((value) => !value)}
                      type="button"
                    >
                      {showPassword ? (
                        <EyeOff aria-hidden="true" size={16} />
                      ) : (
                        <Eye aria-hidden="true" size={16} />
                      )}
                    </Button>
                  </div>
                </label>
                <label>
                  <span>
                    Organization <small>optional</small>
                  </span>
                  <Input
                    name="organization"
                    autoComplete="organization"
                    onChange={(event) =>
                      setOrganization(event.currentTarget.value)
                    }
                    placeholder="Organization ID"
                    value={organization}
                  />
                </label>
              </>
            )}

            {error ? (
              <p className="rm-login-error" role="alert">
                {error}
              </p>
            ) : null}

            <Button
              className="rm-login-submit"
              disabled={pending !== undefined}
              type="submit"
            >
              {pending === "local" ? (
                <LoaderCircle className="rm-spin" size={17} />
              ) : null}
              {challengeToken ? "Verify and continue" : "Sign in"}
              {pending !== "local" ? (
                <ArrowRight aria-hidden="true" size={17} />
              ) : null}
            </Button>

            {challengeToken ? (
              <Button
                className="rm-login-link"
                onClick={() => {
                  setChallengeToken(undefined);
                  setMfaCode("");
                  setError(undefined);
                }}
                type="button"
              >
                Back to password sign in
              </Button>
            ) : null}
          </form>

          <p className="rm-login-terms">
            Access is monitored and subject to your organization&apos;s security
            and retention policies.
          </p>
        </div>
      </section>
    </main>
  );
}

function loginError(error: unknown): string {
  if (error instanceof RomeoApiError) return error.message;
  return "Unable to sign in. Check your connection and try again.";
}
