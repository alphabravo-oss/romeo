# Provider and model capability reports

Romeo exposes two authorized, read-only capability reports:

- `GET /api/v1/providers/{providerId}/capability-report`
- `GET /api/v1/models/{modelId}/capability-report`

These reports make capability truth inspectable without treating provider claims
as authorization. They deliberately keep four concerns separate:

1. registry-advertised defaults for the provider dialect;
2. the administrator-configured provider or model capability posture;
3. detected-versus-overridden model capability provenance; and
4. current provider/model operational availability.

The effective capability resolver remains authoritative for whether a subject
may perform a particular action in an organization, workspace, resource, chat,
or turn. A model reported as operationally usable can still be denied by a
platform kill switch, entitlement, organization/workspace policy, missing
grant, quota, data classification, or action-time dependency check.

## Authorization and privacy

Both routes use normal tenant and resource visibility checks. A caller without
access receives `404`, preventing identifier enumeration across grants or
tenants. Reports return dialect operation booleans, safe catalog status,
authorized aggregate model counts, capability values, bounded limits, and
sanitized reason enums only. They never return provider endpoints, credential
references, secrets, raw probe/provider responses, prompts, or tenant content.

## UI behavior

Provider and model detail views consume the generated query operations. They
show loading, unavailable, and retry states; label registry defaults,
configured values, provenance, and operational state independently; and never
describe an operationally healthy model as policy-authorized. Administrative
capability policy remains in the layered capability administration surface.

## Validation contract

- strict public schemas reject unknown fields;
- service tests cover default/configured/source/operational separation;
- resource-hidden and cross-tenant IDs fail as not found;
- privacy sentinels reject endpoint and credential material;
- OpenAPI route coverage and TypeScript/Python SDK drift gates include both
  operations;
- UI tests cover loading, failure, provenance, and disabled-provider states.
