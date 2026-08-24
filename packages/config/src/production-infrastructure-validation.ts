import { z } from "zod";

import {
  decodeUrlCredential,
  isHttpsUrl,
  isInternalServiceHost,
  parseUrl,
  placeholderPattern,
  productionException,
  rejectUnnecessaryException,
  requireNonPlaceholderCredential,
  requireValue,
  validateReviewedException,
  type ProductionEnvironment,
} from "./production-validation-support";

export function validateProductionInfrastructure(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  validatePostgresSecurity(env, context);
  validateValkeySecurity(env, context);
  validateMalwareScanning(env, context);
  validateObjectStore(env, context);
}

function validatePostgresSecurity(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  const database = parseUrl(env.DATABASE_URL, ["postgres:", "postgresql:"]);
  requireValue(
    database !== undefined &&
      database.hostname.length > 0 &&
      database.pathname.length > 1,
    "DATABASE_URL must be a valid Postgres URL with a host and database in production.",
    "DATABASE_URL",
    env,
    context,
  );
  if (database === undefined) return;
  const verifyFull =
    database.searchParams.get("sslmode")?.toLowerCase().replaceAll("_", "-") ===
    "verify-full";
  const internal = isInternalServiceHost(database.hostname);
  const exception = productionException(env, "POSTGRES_TLS_EXCEPTION");
  if (verifyFull) {
    rejectUnnecessaryException(
      exception,
      "POSTGRES_TLS_EXCEPTION",
      env,
      context,
    );
    return;
  }
  const exceptionValid = validateReviewedException(
    exception,
    "POSTGRES_TLS_EXCEPTION",
    env,
    context,
  );
  requireValue(
    internal &&
      env.POSTGRES_TLS_EXCEPTION_SCOPE === "in_cluster" &&
      exceptionValid,
    "DATABASE_URL must use sslmode=verify-full in production; only an approved, unexpired in-cluster exception may omit full verification.",
    "DATABASE_URL",
    env,
    context,
  );
  if (exception.enabled) {
    requireValue(
      internal,
      "POSTGRES_TLS_EXCEPTION may only cover an in-cluster service hostname.",
      "POSTGRES_TLS_EXCEPTION_SCOPE",
      env,
      context,
    );
    requireValue(
      env.POSTGRES_TLS_EXCEPTION_SCOPE === "in_cluster",
      "POSTGRES_TLS_EXCEPTION_SCOPE must be in_cluster.",
      "POSTGRES_TLS_EXCEPTION_SCOPE",
      env,
      context,
    );
  }
}

function validateValkeySecurity(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  const valkey = parseUrl(env.VALKEY_URL, ["redis:", "rediss:"]);
  requireValue(
    valkey !== undefined && valkey.hostname.length > 0,
    "VALKEY_URL must be a valid redis or rediss URL in production.",
    "VALKEY_URL",
    env,
    context,
  );
  if (valkey === undefined) return;
  const username = decodeUrlCredential(valkey.username);
  const password = decodeUrlCredential(valkey.password);
  const hasAclCredentials =
    username !== undefined &&
    password !== undefined &&
    username.trim().length > 0 &&
    username === username.trim() &&
    password.length >= 16 &&
    !placeholderPattern.test(password);
  const secure = valkey.protocol === "rediss:" && hasAclCredentials;
  const exception = productionException(env, "VALKEY_SECURITY_EXCEPTION");
  if (secure) {
    rejectUnnecessaryException(
      exception,
      "VALKEY_SECURITY_EXCEPTION",
      env,
      context,
    );
    return;
  }
  const internal = isInternalServiceHost(valkey.hostname);
  const exceptionValid = validateReviewedException(
    exception,
    "VALKEY_SECURITY_EXCEPTION",
    env,
    context,
  );
  requireValue(
    valkey.protocol === "redis:" &&
      internal &&
      env.VALKEY_SECURITY_EXCEPTION_SCOPE === "in_cluster" &&
      env.VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED &&
      hasAclCredentials &&
      exceptionValid,
    "VALKEY_URL must use rediss with non-placeholder ACL username/password credentials; plaintext is allowed only for an approved in-cluster NetworkPolicy exception.",
    "VALKEY_URL",
    env,
    context,
  );
  if (exception.enabled) {
    requireValue(
      internal,
      "VALKEY_SECURITY_EXCEPTION may only cover an in-cluster service hostname.",
      "VALKEY_SECURITY_EXCEPTION_SCOPE",
      env,
      context,
    );
    requireValue(
      env.VALKEY_SECURITY_EXCEPTION_SCOPE === "in_cluster",
      "VALKEY_SECURITY_EXCEPTION_SCOPE must be in_cluster.",
      "VALKEY_SECURITY_EXCEPTION_SCOPE",
      env,
      context,
    );
    requireValue(
      env.VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED,
      "VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED must be true for a plaintext in-cluster exception.",
      "VALKEY_IN_CLUSTER_NETWORK_POLICY_ENABLED",
      env,
      context,
    );
  }
}

function validateMalwareScanning(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  const exception = productionException(env, "FILE_MALWARE_SCAN_EXCEPTION");
  const scannerConfigured =
    env.FILE_MALWARE_SCAN_ENABLED &&
    env.FILE_MALWARE_SCAN_POLICY === "required" &&
    validClamavAddress(env.CLAMAV_ADDRESS);
  if (scannerConfigured) {
    rejectUnnecessaryException(
      exception,
      "FILE_MALWARE_SCAN_EXCEPTION",
      env,
      context,
    );
    return;
  }
  if (env.FILE_MALWARE_SCAN_ENABLED) {
    requireValue(
      env.FILE_MALWARE_SCAN_POLICY === "required",
      "FILE_MALWARE_SCAN_POLICY must be required when scanning is enabled in production.",
      "FILE_MALWARE_SCAN_POLICY",
      env,
      context,
    );
    requireValue(
      validClamavAddress(env.CLAMAV_ADDRESS),
      "CLAMAV_ADDRESS must identify a reachable ClamAV TCP service when production scanning is enabled.",
      "CLAMAV_ADDRESS",
      env,
      context,
    );
    return;
  }
  requireValue(
    env.FILE_MALWARE_SCAN_POLICY === "off",
    "FILE_MALWARE_SCAN_POLICY must be off when FILE_MALWARE_SCAN_ENABLED is false.",
    "FILE_MALWARE_SCAN_POLICY",
    env,
    context,
  );
  requireValue(
    validateReviewedException(
      exception,
      "FILE_MALWARE_SCAN_EXCEPTION",
      env,
      context,
    ),
    "Production malware scanning may be disabled only by an approved, unexpired exception.",
    "FILE_MALWARE_SCAN_EXCEPTION_ENABLED",
    env,
    context,
  );
}

function validateObjectStore(
  env: ProductionEnvironment,
  context: z.core.$RefinementCtx,
): void {
  requireValue(
    isHttpsUrl(env.S3_ENDPOINT),
    "S3_ENDPOINT must be an HTTPS URL in production.",
    "S3_ENDPOINT",
    env,
    context,
  );
  requireNonPlaceholderCredential(
    env.S3_ACCESS_KEY_ID,
    3,
    "S3_ACCESS_KEY_ID",
    env,
    context,
  );
  requireNonPlaceholderCredential(
    env.S3_SECRET_ACCESS_KEY,
    16,
    "S3_SECRET_ACCESS_KEY",
    env,
    context,
  );
  for (const [field, enabled] of [
    ["S3_READINESS_REQUIRE_ENCRYPTION", env.S3_READINESS_REQUIRE_ENCRYPTION],
    ["S3_READINESS_REQUIRE_VERSIONING", env.S3_READINESS_REQUIRE_VERSIONING],
    ["S3_READINESS_REQUIRE_LIFECYCLE", env.S3_READINESS_REQUIRE_LIFECYCLE],
  ] as const) {
    requireValue(
      enabled,
      `${field} must remain enabled in production.`,
      field,
      env,
      context,
    );
  }
}

function validClamavAddress(value: string): boolean {
  const parsed = parseUrl(value.includes("://") ? value : `tcp://${value}`, [
    "tcp:",
  ]);
  if (parsed === undefined || parsed.hostname.length === 0) return false;
  const port = parsed.port.length === 0 ? 3310 : Number(parsed.port);
  return Number.isInteger(port) && port >= 1 && port <= 65_535;
}
