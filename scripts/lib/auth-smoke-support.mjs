import { baseUrl } from "./compose-smoke-support.mjs";
import { generateTotpCode } from "./totp.mjs";

export const localAuthFallbackChecks = [
  "local_fallback_enabled",
  "oidc_unconfigured_fails_closed",
  "local_password_login_sets_session_cookie",
  "session_bootstrap_subject_readback",
  "totp_enrollment_confirmed",
  "local_login_requires_mfa_after_totp_activation",
  "invalid_mfa_code_rejected",
  "valid_mfa_code_sets_session_cookie",
  "recovery_codes_generated",
  "local_login_advertises_recovery_code_mfa",
  "recovery_code_sets_session_cookie",
  "reused_recovery_code_rejected",
  "local_auth_status_reports_recovery_code_count",
  "local_auth_status_reports_active_mfa",
  "local_auth_audit_redacted",
];

const badTotpCode = "000000";

export async function setAdminLocalPassword(harness, token, localPassword) {
  await requestJson(harness, "/api/v1/users/user_dev_admin/local-password", {
    method: "POST",
    token,
    body: {
      confirmUserId: "user_dev_admin",
      newPassword: localPassword,
    },
  });
}

export async function assertLocalAuthFallbackFlow(
  harness,
  adminToken,
  options,
) {
  await assertLocalFallbackEnabled(harness, adminToken);
  await assertOidcFailsClosed(harness);

  const passwordLogin = await loginWithLocalPassword(
    harness,
    options.localPassword,
  );
  const adminCookie = extractSessionCookie(passwordLogin.response);
  await assertMe(harness, adminCookie, {
    adminRole: "global_admin",
    tenancyMode: options.expectedTenancyMode ?? "single",
    userId: "user_dev_admin",
  });

  const enrollment = await requestJson(
    harness,
    "/api/v1/auth/local/mfa/totp/enroll",
    {
      method: "POST",
      cookie: adminCookie,
      body: {
        name: `${options.label ?? "Auth smoke"} ${options.rawAuthSentinel}`,
      },
      expectedStatus: 201,
    },
  );
  const factorId = enrollment.body.data?.factor?.id;
  const enrollmentSecret = enrollment.body.data?.secret;
  if (typeof factorId !== "string" || factorId.length === 0) {
    throw new Error("TOTP enrollment did not return a factor id.");
  }
  if (
    typeof enrollmentSecret !== "string" ||
    !/^[A-Z2-7]+$/u.test(enrollmentSecret)
  ) {
    throw new Error("TOTP enrollment did not return a base32 secret.");
  }

  const confirmedTotpCode = generateTotpCode(enrollmentSecret);
  await requestJson(harness, "/api/v1/auth/local/mfa/totp/confirm", {
    method: "POST",
    cookie: adminCookie,
    body: {
      factorId,
      code: confirmedTotpCode,
    },
  });

  const mfaLogin = await requestJson(harness, "/api/v1/auth/local/login", {
    method: "POST",
    body: {
      email: "admin@romeo.local",
      password: options.localPassword,
    },
  });
  if (mfaLogin.body.data?.status !== "mfa_required") {
    throw new Error("Local login did not require MFA after TOTP activation.");
  }
  if (mfaLogin.response.headers.get("set-cookie")?.includes("romeo_session")) {
    throw new Error(
      "MFA challenge response unexpectedly set a session cookie.",
    );
  }
  const challengeToken = mfaLogin.body.data?.challengeToken;
  if (typeof challengeToken !== "string" || challengeToken.length === 0) {
    throw new Error("MFA-required login did not return a challenge token.");
  }

  const failedMfa = await requestJson(
    harness,
    "/api/v1/auth/local/mfa/verify",
    {
      method: "POST",
      body: {
        challengeToken,
        code: badTotpCode,
      },
      expectedStatus: 401,
    },
  );
  if (failedMfa.body.error?.code !== "local_mfa_code_invalid") {
    throw new Error("Bad MFA code did not return local_mfa_code_invalid.");
  }

  const verifiedCode =
    badTotpCode === confirmedTotpCode
      ? generateTotpCode(enrollmentSecret, { timestamp: Date.now() + 30_000 })
      : confirmedTotpCode;
  const verifiedMfa = await requestJson(
    harness,
    "/api/v1/auth/local/mfa/verify",
    {
      method: "POST",
      body: {
        challengeToken,
        code: verifiedCode,
      },
    },
  );
  if (verifiedMfa.body.data?.status !== "authenticated") {
    throw new Error("Valid MFA verification did not authenticate.");
  }
  const mfaCookie = extractSessionCookie(verifiedMfa.response);
  await assertMe(harness, mfaCookie, {
    adminRole: "global_admin",
    tenancyMode: options.expectedTenancyMode ?? "single",
    userId: "user_dev_admin",
  });

  const recoveryCodes = await requestJson(
    harness,
    "/api/v1/auth/local/mfa/recovery-codes/generate",
    {
      method: "POST",
      cookie: mfaCookie,
      body: {
        totpCode: generateTotpCode(enrollmentSecret),
      },
      expectedStatus: 201,
    },
  );
  const recoveryCode = recoveryCodes.body.data?.codes?.[0];
  if (
    !Array.isArray(recoveryCodes.body.data?.codes) ||
    recoveryCodes.body.data.codes.length !== 10 ||
    typeof recoveryCode !== "string" ||
    !/^rmfa-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}$/u.test(
      recoveryCode,
    )
  ) {
    throw new Error("Recovery-code generation did not return 10 codes.");
  }
  if (
    recoveryCodes.body.data?.factor?.type !== "recovery_codes" ||
    recoveryCodes.body.data?.factor?.recoveryCodeRemainingCount !== 10
  ) {
    throw new Error(
      "Recovery-code generation did not return an active recovery factor.",
    );
  }

  const recoveryLogin = await requestJson(harness, "/api/v1/auth/local/login", {
    method: "POST",
    body: {
      email: "admin@romeo.local",
      password: options.localPassword,
    },
  });
  if (recoveryLogin.body.data?.status !== "mfa_required") {
    throw new Error("Recovery-code login did not require MFA.");
  }
  const methods = recoveryLogin.body.data?.methods;
  if (!Array.isArray(methods) || !methods.includes("recovery_code")) {
    throw new Error("MFA challenge did not advertise recovery-code support.");
  }
  const recoveryChallengeToken = recoveryLogin.body.data?.challengeToken;
  if (
    typeof recoveryChallengeToken !== "string" ||
    recoveryChallengeToken.length === 0
  ) {
    throw new Error("Recovery-code login did not return a challenge token.");
  }

  const recoveryVerify = await requestJson(
    harness,
    "/api/v1/auth/local/mfa/verify",
    {
      method: "POST",
      body: {
        challengeToken: recoveryChallengeToken,
        recoveryCode,
      },
    },
  );
  if (recoveryVerify.body.data?.status !== "authenticated") {
    throw new Error("Recovery-code MFA verification did not authenticate.");
  }
  const recoveryCookie = extractSessionCookie(recoveryVerify.response);
  await assertMe(harness, recoveryCookie, {
    adminRole: "global_admin",
    tenancyMode: options.expectedTenancyMode ?? "single",
    userId: "user_dev_admin",
  });

  const reusedRecoveryCode = await requestJson(
    harness,
    "/api/v1/auth/local/login",
    {
      method: "POST",
      body: {
        email: "admin@romeo.local",
        password: options.localPassword,
        recoveryCode,
      },
      expectedStatus: 401,
    },
  );
  if (
    reusedRecoveryCode.body.error?.code !== "local_mfa_recovery_code_invalid"
  ) {
    throw new Error(
      "Reused recovery code did not return local_mfa_recovery_code_invalid.",
    );
  }

  await assertLocalStatus(harness, mfaCookie, {
    enrollmentSecret,
    recoveryCode,
    recoveryCodeRemainingCount: 9,
  });
  await assertAuditRedaction(harness, adminToken, {
    badTotpCode,
    confirmedTotpCode,
    enrollmentSecret,
    localPassword: options.localPassword,
    rawAuthSentinel: options.rawAuthSentinel,
    recoveryCode,
  });

  return {
    badTotpCode,
    confirmedTotpCode,
    enrollmentSecret,
    factorId,
    mfaCookie,
    recoveryCode,
    recoveryCookie,
  };
}

async function loginWithLocalPassword(harness, localPassword) {
  const login = await requestJson(harness, "/api/v1/auth/local/login", {
    method: "POST",
    body: {
      email: "admin@romeo.local",
      password: localPassword,
    },
  });
  if (login.body.data?.status !== "authenticated") {
    throw new Error("Local password login did not authenticate.");
  }
  if (typeof login.body.data?.token !== "string") {
    throw new Error("Local password login did not return a session token.");
  }
  return login;
}

async function assertLocalFallbackEnabled(harness, adminToken) {
  const settings = await requestJson(
    harness,
    "/api/v1/admin/auth-providers/settings",
    { token: adminToken },
  );
  const localProvider = settings.body.data?.effective?.providers?.find(
    (provider) => provider.providerId === "local",
  );
  if (localProvider?.enabled !== true) {
    throw new Error("Local authentication fallback is not enabled.");
  }
}

async function assertOidcFailsClosed(harness) {
  const oidcStart = await requestJson(
    harness,
    "/api/v1/auth/oidc/start?returnTo=/app&providerId=keycloak",
    { allowedStatuses: [409] },
  );
  if (oidcStart.body.error?.code !== "oidc_login_not_configured") {
    throw new Error(
      `Unconfigured OIDC start returned an unexpected error: ${JSON.stringify(oidcStart.body)}`,
    );
  }
}

async function assertMe(harness, cookie, expected) {
  const me = await requestJson(harness, "/api/v1/me", { cookie });
  if (me.body.subject?.id !== expected.userId) {
    throw new Error("Session /me readback returned the wrong subject.");
  }
  if (me.body.subject?.adminRole !== expected.adminRole) {
    throw new Error("Session /me readback returned the wrong admin role.");
  }
  if (me.body.deployment?.tenancyMode !== expected.tenancyMode) {
    throw new Error(
      `/me did not expose the ${expected.tenancyMode} tenancy deployment mode.`,
    );
  }
}

async function assertLocalStatus(harness, cookie, expected) {
  const status = await requestJson(harness, "/api/v1/auth/local/status", {
    cookie,
  });
  if (status.body.data?.hasPassword !== true) {
    throw new Error("Local auth status did not report a configured password.");
  }
  if (status.body.data?.mfaEnabled !== true) {
    throw new Error("Local auth status did not report MFA enabled.");
  }
  const activeTotp = status.body.data?.factors?.some(
    (factor) => factor.type === "totp" && factor.status === "active",
  );
  if (activeTotp !== true) {
    throw new Error("Local auth status did not return an active TOTP factor.");
  }
  const recoveryFactor = status.body.data?.factors?.find(
    (factor) => factor.type === "recovery_codes" && factor.status === "active",
  );
  if (
    recoveryFactor?.recoveryCodeRemainingCount !==
    expected.recoveryCodeRemainingCount
  ) {
    throw new Error(
      "Local auth status did not return the expected recovery-code count.",
    );
  }
  const serialized = JSON.stringify(status.body);
  if (serialized.includes(expected.enrollmentSecret)) {
    throw new Error("Local auth status leaked a TOTP secret.");
  }
  if (serialized.includes(expected.recoveryCode)) {
    throw new Error("Local auth status leaked a recovery code.");
  }
}

async function assertAuditRedaction(harness, adminToken, values) {
  const audit = await requestJson(harness, "/api/v1/audit-logs", {
    token: adminToken,
  });
  const serialized = JSON.stringify(audit.body);
  const forbiddenValues = [
    values.localPassword,
    values.enrollmentSecret,
    values.confirmedTotpCode,
    values.badTotpCode,
    values.recoveryCode,
    values.rawAuthSentinel,
  ];
  for (const forbiddenValue of forbiddenValues) {
    if (
      typeof forbiddenValue === "string" &&
      forbiddenValue.length > 0 &&
      serialized.includes(forbiddenValue)
    ) {
      throw new Error("Local auth audit readback leaked a generated secret.");
    }
  }
  for (const action of [
    "local_auth.mfa.enroll",
    "local_auth.mfa.confirm",
    "local_auth.mfa.recovery_codes.generate",
    "local_auth.mfa.recovery_code.consume",
    "local_auth.login.failure",
  ]) {
    if (!audit.body.data?.some((event) => event.action === action)) {
      throw new Error(`Local auth audit readback is missing ${action}.`);
    }
  }
}

async function requestJson(harness, path, options = {}) {
  const headers = {
    accept: "application/json",
    origin: `http://127.0.0.1:${harness.appPort}`,
  };
  if (options.body !== undefined) headers["content-type"] = "application/json";
  if (options.token !== undefined) {
    headers.authorization = `Bearer ${options.token}`;
  }
  if (options.cookie !== undefined) {
    headers.cookie = options.cookie;
  }

  const response = await fetch(baseUrl(harness, path), {
    method: options.method ?? "GET",
    headers,
    body: options.body === undefined ? undefined : JSON.stringify(options.body),
  });
  const text = await response.text();
  const body = text.length === 0 ? undefined : JSON.parse(text);
  const allowedStatuses = options.allowedStatuses ?? [
    options.expectedStatus ?? 200,
  ];
  if (!allowedStatuses.includes(response.status)) {
    throw new Error(
      `${options.method ?? "GET"} ${path} returned ${response.status}, expected ${allowedStatuses.join(" or ")}: ${text}`,
    );
  }
  return { body, response };
}

function extractSessionCookie(response) {
  const setCookie = response.headers.get("set-cookie") ?? "";
  if (!setCookie.includes("HttpOnly")) {
    throw new Error("Session cookie is not HttpOnly.");
  }
  if (!setCookie.includes("SameSite=Lax")) {
    throw new Error("Session cookie does not use SameSite=Lax.");
  }
  const match = /(?:^|,\s*)(romeo_session=rms_[^;,]+)/u.exec(setCookie);
  if (match === null) {
    throw new Error("Response did not set a Romeo session cookie.");
  }
  return match[1];
}
