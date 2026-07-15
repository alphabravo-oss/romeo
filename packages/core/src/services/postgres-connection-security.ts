export type PostgresConnectionHostCategory =
  | "invalid"
  | "internal"
  | "local"
  | "missing"
  | "remote";

export type PostgresConnectionTlsMode =
  | "allow"
  | "disable"
  | "prefer"
  | "require"
  | "unknown"
  | "verify_ca"
  | "verify_full";

export type PostgresConnectionTlsVerification =
  | "certificate_authority"
  | "full"
  | "none"
  | "opportunistic"
  | "unknown";

export interface PostgresConnectionSecurityPosture {
  databaseUrlValid: boolean;
  hostCategory: PostgresConnectionHostCategory;
  hostedPostgresTlsRecommended: boolean;
  sslmodeSource: "none" | "ssl" | "sslmode";
  tlsConfigured: boolean;
  tlsMode: PostgresConnectionTlsMode;
  tlsVerification: PostgresConnectionTlsVerification;
  warningCodes: PostgresConnectionSecurityWarning[];
  redaction: {
    databaseUrlReturned: false;
    hostReturned: false;
    passwordReturned: false;
    usernameReturned: false;
  };
}

export type PostgresConnectionSecurityWarning =
  | "postgres_database_url_invalid"
  | "postgres_hosted_tls_not_configured"
  | "postgres_hosted_tls_verification_recommended";

export function analyzePostgresConnectionSecurity(
  databaseUrl: string,
): PostgresConnectionSecurityPosture {
  const value = databaseUrl.trim();
  if (value.length === 0) {
    return posture({
      databaseUrlValid: false,
      hostCategory: "missing",
      sslmodeSource: "none",
      tlsMode: "unknown",
      tlsVerification: "unknown",
      warningCodes: [],
    });
  }

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return posture({
      databaseUrlValid: false,
      hostCategory: "invalid",
      sslmodeSource: "none",
      tlsMode: "unknown",
      tlsVerification: "unknown",
      warningCodes: ["postgres_database_url_invalid"],
    });
  }

  if (parsed.protocol !== "postgres:" && parsed.protocol !== "postgresql:") {
    return posture({
      databaseUrlValid: false,
      hostCategory: "invalid",
      sslmodeSource: "none",
      tlsMode: "unknown",
      tlsVerification: "unknown",
      warningCodes: ["postgres_database_url_invalid"],
    });
  }

  const hostCategory = postgresHostCategory(parsed.hostname);
  const sslmode = normalizeSslMode(parsed.searchParams.get("sslmode"));
  const ssl = normalizeSslBoolean(parsed.searchParams.get("ssl"));
  const sslmodeSource =
    sslmode !== undefined ? "sslmode" : ssl !== undefined ? "ssl" : "none";
  const tlsMode =
    sslmode ??
    (ssl === true ? "require" : ssl === false ? "disable" : "unknown");
  const tlsVerification = postgresTlsVerification(tlsMode);
  const hostedPostgresTlsRecommended = hostCategory === "remote";
  const warningCodes: PostgresConnectionSecurityWarning[] = [];
  if (hostedPostgresTlsRecommended && !postgresTlsRequired(tlsMode)) {
    warningCodes.push("postgres_hosted_tls_not_configured");
  } else if (
    hostedPostgresTlsRecommended &&
    tlsVerification !== "full" &&
    tlsVerification !== "certificate_authority"
  ) {
    warningCodes.push("postgres_hosted_tls_verification_recommended");
  }

  return posture({
    databaseUrlValid: true,
    hostCategory,
    sslmodeSource,
    tlsMode,
    tlsVerification,
    warningCodes,
  });
}

function posture(input: {
  databaseUrlValid: boolean;
  hostCategory: PostgresConnectionHostCategory;
  sslmodeSource: "none" | "ssl" | "sslmode";
  tlsMode: PostgresConnectionTlsMode;
  tlsVerification: PostgresConnectionTlsVerification;
  warningCodes: PostgresConnectionSecurityWarning[];
}): PostgresConnectionSecurityPosture {
  return {
    databaseUrlValid: input.databaseUrlValid,
    hostCategory: input.hostCategory,
    hostedPostgresTlsRecommended: input.hostCategory === "remote",
    sslmodeSource: input.sslmodeSource,
    tlsConfigured: postgresTlsRequired(input.tlsMode),
    tlsMode: input.tlsMode,
    tlsVerification: input.tlsVerification,
    warningCodes: input.warningCodes,
    redaction: {
      databaseUrlReturned: false,
      hostReturned: false,
      passwordReturned: false,
      usernameReturned: false,
    },
  };
}

function localPostgresHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "::1" ||
    normalized === "[::1]" ||
    normalized === "0.0.0.0" ||
    normalized === "host.docker.internal" ||
    normalized === "docker.for.mac.localhost" ||
    normalized === "127.0.0.1" ||
    normalized.startsWith("127.")
  );
}

function postgresHostCategory(
  hostname: string,
): Exclude<PostgresConnectionHostCategory, "invalid" | "missing"> {
  const normalized = hostname.toLowerCase();
  if (localPostgresHost(normalized)) return "local";
  if (
    !normalized.includes(".") ||
    normalized.endsWith(".svc") ||
    normalized.endsWith(".svc.cluster.local") ||
    normalized.endsWith(".cluster.local")
  ) {
    return "internal";
  }
  return "remote";
}

function normalizeSslMode(
  value: string | null,
): PostgresConnectionTlsMode | undefined {
  if (value === null) return undefined;
  switch (value.trim().toLowerCase()) {
    case "allow":
      return "allow";
    case "disable":
      return "disable";
    case "prefer":
      return "prefer";
    case "require":
      return "require";
    case "verify-ca":
    case "verify_ca":
      return "verify_ca";
    case "verify-full":
    case "verify_full":
      return "verify_full";
    default:
      return "unknown";
  }
}

function normalizeSslBoolean(value: string | null): boolean | undefined {
  if (value === null) return undefined;
  switch (value.trim().toLowerCase()) {
    case "1":
    case "true":
    case "yes":
      return true;
    case "0":
    case "false":
    case "no":
      return false;
    default:
      return undefined;
  }
}

function postgresTlsRequired(mode: PostgresConnectionTlsMode): boolean {
  return mode === "require" || mode === "verify_ca" || mode === "verify_full";
}

function postgresTlsVerification(
  mode: PostgresConnectionTlsMode,
): PostgresConnectionTlsVerification {
  switch (mode) {
    case "verify_full":
      return "full";
    case "verify_ca":
      return "certificate_authority";
    case "require":
      return "none";
    case "allow":
    case "prefer":
      return "opportunistic";
    case "disable":
      return "none";
    case "unknown":
      return "unknown";
  }
}
