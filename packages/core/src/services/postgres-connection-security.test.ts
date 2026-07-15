import { describe, expect, it } from "vitest";

import { analyzePostgresConnectionSecurity } from "./postgres-connection-security";

describe("Postgres connection security posture", () => {
  it("treats local and Kubernetes service DNS as internal connection paths", () => {
    for (const databaseUrl of [
      "postgres://romeo:secret@localhost:5432/romeo",
      "postgres://romeo:secret@host.docker.internal:5432/romeo",
      "postgres://romeo:secret@postgres:5432/romeo",
      "postgres://romeo:secret@romeo-pg-rw.romeo.svc.cluster.local:5432/romeo",
    ]) {
      const posture = analyzePostgresConnectionSecurity(databaseUrl);

      expect(posture.hostedPostgresTlsRecommended).toBe(false);
      expect(posture.warningCodes).toEqual([]);
    }
  });

  it("warns for remote hosted-style Postgres URLs without TLS verification", () => {
    expect(
      analyzePostgresConnectionSecurity(
        "postgres://romeo:secret@db.internal:5432/romeo",
      ).warningCodes,
    ).toEqual(["postgres_hosted_tls_not_configured"]);
    expect(
      analyzePostgresConnectionSecurity(
        "postgres://romeo:secret@db.internal:5432/romeo?sslmode=require",
      ).warningCodes,
    ).toEqual(["postgres_hosted_tls_verification_recommended"]);
    expect(
      analyzePostgresConnectionSecurity(
        "postgres://romeo:secret@db.internal:5432/romeo?sslmode=verify-full",
      ).warningCodes,
    ).toEqual([]);
  });
});
