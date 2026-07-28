# Dependency and Integration Policy

Romeo minimizes product-owned infrastructure by preferring established,
actively maintained packages over handwritten protocol and UI machinery.

## Selection order

1. Use the runtime or web-platform standard when it completely solves the
   problem without a compatibility layer.
2. Use the provider's official SDK for provider-specific APIs.
3. Use the established vendor-neutral package for a standard protocol or file
   format.
4. Maintain a local implementation only when the first three choices cannot
   meet Romeo's security, deployment, or interoperability requirements.

This is a maintenance-budget rule, not a preference. A new integration may not
ship until it either uses a qualified package or has a recorded exception in
the integration register. The exception must name the unsupported capability,
keep the custom code behind one adapter, and include contract tests that make a
future package migration possible.

An external package must have a compatible license, current security support,
typed interfaces, the required Node/browser runtime support, cancellation, and
a credible maintenance history. A package is not added merely to wrap a trivial
platform API.

## Integration boundary

External SDK types stop at the adapter boundary. SDKs own authentication
headers, endpoint construction, request serialization, response parsing,
stream framing, and documented provider errors. Romeo adapters own:

- governed provider and model selection;
- credential resolution and secret redaction;
- timeouts, cancellation, telemetry, and policy enforcement;
- conversion to Romeo chat, tool-call, media, usage, and error contracts;
- compatibility tests using injected SDK transports.

Domain services and UI code never import provider SDK types directly.

Adapter names must identify the adopted SDK or vendor boundary accurately.
Legacy names that imply Romeo owns a protocol client are removed during SDK
migrations so maintainers can distinguish a thin policy adapter from a custom
transport without reading its implementation.

Romeo may inject a governed transport into an SDK when the SDK supports it.
That transport may enforce egress policy, DNS pinning, response-size limits,
timeouts, cancellation, telemetry, and deterministic tests. It must not
reimplement the SDK's endpoint selection, authentication format, request
payloads, response decoding, pagination, stream framing, or error protocol.

Do not add a generic wrapper SDK on top of an official provider SDK merely to
make several providers look alike. Romeo's stable internal provider contracts
already provide that normalization boundary, and an additional abstraction
would increase dependency surface without removing product-owned behavior.

Romeo-owned HTTP surfaces follow the same maintenance principle without adding
an unnecessary third-party protocol wrapper: `@hono/zod-openapi` and Zod define
each authoritative route once, and `@hey-api/openapi-ts` generates the browser
SDK and runtime types. Handwritten feature fetch clients and duplicate UI API
types are not accepted for migrated surfaces.

## Current provider baseline

| Capability                                                | Package             |
| --------------------------------------------------------- | ------------------- |
| OpenAI-compatible chat, Responses, discovery, embeddings  | `openai`            |
| Anthropic Messages, streaming, discovery, vision, tools   | `@anthropic-ai/sdk` |
| Ollama chat, discovery, model metadata, pulls, embeddings | `ollama`            |

## Qualified integration register

The same SDK-first rule applies beyond model providers. Dependencies are added
when their adapter is migrated; Romeo does not carry speculative or unused
SDKs.

| Integration                                          | Qualified package                  | Status  | Romeo-owned boundary                                      |
| ---------------------------------------------------- | ---------------------------------- | ------- | --------------------------------------------------------- |
| Stripe webhooks and billing API                      | `stripe`                           | Adopted | entitlement mapping, tenant policy, audit                 |
| Amazon S3 connectors and object storage              | `@aws-sdk/client-s3`               | Adopted | object limits, tenant prefix policy, redaction            |
| GitHub connectors, identity, diagnostics, revocation | `octokit`                          | Adopted | scope policy, membership mapping, content limits, audit   |
| Slack connectors                                     | `@slack/web-api`                   | Adopted | channel allowlists, retention, content normalization      |
| Slack incoming-webhook notifications                 | `@slack/webhook`                   | Adopted | destination policy, delivery ledger, content redaction    |
| Resend email notifications                           | `resend`                           | Adopted | recipient policy, templates, delivery ledger, redaction   |
| Firebase Cloud Messaging                             | `firebase-admin`                   | Adopted | token refs, message policy, delivery ledger, redaction    |
| Qdrant vector storage                                | `@qdrant/js-client-rest`           | Adopted | tenant filters, namespace policy, hit normalization       |
| AWS Secrets Manager                                  | `@aws-sdk/client-secrets-manager`  | Adopted | secret-ref validation, redaction, stable failure codes    |
| Azure Key Vault                                      | `@azure/keyvault-secrets`          | Adopted | secret-ref validation, redaction, stable failure codes    |
| Google Cloud Secret Manager                          | `@google-cloud/secret-manager`     | Adopted | secret-ref validation, redaction, stable failure codes    |
| HashiCorp Vault KV-v2                                | `@litehex/node-vault`              | Adopted | path policy, redaction, stable failure codes              |
| Notion connectors                                    | `@notionhq/client`                 | Adopted | page scope, block normalization, content limits           |
| Linear connectors                                    | `@linear/sdk`                      | Adopted | team/query scope, issue normalization, content limits     |
| OpenID Connect and OAuth 2.0 grants                  | `openid-client` and `oauth4webapi` | Adopted | tenant/provider policy, tool-worker auth, sessions        |
| SAML                                                 | `@node-saml/node-saml`             | Adopted | tenant policy, identity linking, sessions                 |
| LDAP                                                 | `ldapts`                           | Adopted | directory mapping, sync policy, audit                     |
| Password hashing                                     | `@node-rs/argon2`                  | Adopted | credential lifecycle and breach controls                  |
| TOTP and recovery controls                           | `otplib`                           | Adopted | enrollment policy, encrypted secrets, recovery lifecycle  |
| JWT/JWK verification                                 | `jose`                             | Adopted | allowed algorithms, issuer/audience policy, stable errors |
| SMTP email delivery                                  | `nodemailer`                       | Adopted | templates, delivery policy, audit                         |
| Valkey quota and rate-limit coordination             | `@valkey/valkey-glide`             | Adopted | key policy, Lua quota semantics, fail-closed errors       |
| Route-scoped localization resources                  | `i18next-resources-to-backend`     | Adopted | namespace grouping, locale policy, translation parity     |

HashiCorp does not maintain an official Node client. `@litehex/node-vault` is a
typed, actively maintained community client listed by HashiCorp; Romeo keeps it
behind the same injectable SDK boundary as official cloud clients.

Atlassian Cloud currently has no qualified official general-purpose Node SDK
for Jira and Confluence REST reads. Its adapter remains centralized HTTP behind
the connector egress boundary until a package passes this policy. Arbitrary URL
ingestion and generic outgoing webhooks intentionally stay on the web platform
because the target protocol is deployment-defined rather than vendor-defined.

Raw network code remains appropriate for generic webhooks, pre-signed object
store transfers, SSRF-hardened arbitrary URL ingestion, and protocols without a
qualified SDK. Those implementations must remain centralized and tested.

## Recorded custom-transport exceptions

| Capability                                      | Reason a package does not own the transport                                     | Required boundary                   |
| ----------------------------------------------- | ------------------------------------------------------------------------------- | ----------------------------------- |
| Arbitrary URL ingestion                         | The destination is user/admin supplied and must be DNS-pinned and SSRF governed | Central URL-ingestion executor only |
| Generic outgoing webhooks                       | The destination and payload contract are deployment defined                     | Central signed-webhook sender only  |
| Microsoft Teams and generic enterprise webhooks | No qualified SDK improves the one-operation webhook protocol                    | Central notification sender only    |
| Atlassian Jira/Confluence reads                 | No qualified official general-purpose Node SDK currently meets this policy      | Central Atlassian connector only    |
| Brave, Tavily, and SearXNG web search           | A common qualified SDK does not cover the governed multi-provider contract      | Central web-search adapter only     |
| GitHub OAuth PKCE token exchange                | Octokit does not serialize the required `code_verifier` for this flow           | One token-exchange method only      |

An exception is deleted when a qualified SDK supports the required capability.
Package review includes maintenance activity, security advisories, release
compatibility, license, TypeScript quality, abort/timeout support, transport
injection where governance requires it, and the ability to test without live
credentials.

GitHub's Octokit OAuth helpers do not currently serialize the PKCE
`code_verifier` on web-flow token exchange. Romeo therefore retains one bounded
token-exchange request for that parameter while Octokit owns GitHub identity,
membership, and authorization-revocation endpoints.

## Enforcement

`pnpm check:architecture` rejects direct provider HTTP calls and handwritten
provider endpoint literals outside the centralized SDK factory. Any exception
must be narrow, documented, and recorded in the architecture ratchet baseline.
The ratchet also rejects reintroduction of handwritten Stripe signature
verification and handwritten JWT cryptography; signed webhook routes must
preserve the unmodified request body.

Every adopted integration in the qualified register has a positive
architecture assertion for its package import, and high-risk integrations also
have a negative assertion rejecting handwritten transports or protocol
literals. Dependency updates remain lockfile-pinned, automated, and subject to
the same unit, contract, live-acceptance, and security checks as application
changes.

Romeo's own public clients follow the same rule: `@hey-api/openapi-ts`
generates the TypeScript client from the authoritative OpenAPI document.
Production consumers migrate to that generated runtime; the deprecated
handwritten `RomeoTransport` and resource classes are deletion-only and may not
gain new endpoints or consumers.
