import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { dirname, extname, join, relative, resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const baselinePath = resolve(
  import.meta.dirname,
  "architecture-ratchet-baseline.json",
);
const outputPath = resolve(root, "dist/ci/architecture-ratchet.json");
const baseline = JSON.parse(readFileSync(baselinePath, "utf8"));

const productionExtensions = new Set([".ts", ".tsx"]);
const productionFiles = [
  ...sourceFiles(resolve(root, "apps"), productionExtensions),
  ...sourceFiles(resolve(root, "packages"), productionExtensions),
];
const appFiles = sourceFiles(
  resolve(root, "apps/app/src"),
  productionExtensions,
);
const appApiFiles = sourceFiles(
  resolve(root, "apps/app/src/api"),
  productionExtensions,
);
const appTsxFiles = appFiles.filter((file) => extname(file) === ".tsx");
const openApiFiles = sourceFiles(
  resolve(root, "packages/core/src/http/openapi"),
  new Set([".ts"]),
);
const coreFiles = sourceFiles(
  resolve(root, "packages/core/src"),
  new Set([".ts"]),
);
const providerAdapterFiles = sourceFiles(
  resolve(root, "packages/providers/src/adapters"),
  new Set([".ts"]),
).filter((file) => !file.endsWith("provider-sdk.ts"));
const providerIntegrationFiles = [
  ...providerAdapterFiles,
  resolve(root, "packages/voices/src/openai-compatible-provider.ts"),
  resolve(root, "packages/core/src/services/image-generation-service.ts"),
];
const apiClientFiles = sourceFiles(
  resolve(root, "packages/api-client/src"),
  new Set([".ts"]),
);
const legacyApiClientFiles = apiClientFiles.filter(
  (file) =>
    file.includes(`${join("src", "contracts")}/`) ||
    file.includes(`${join("src", "resources")}/`) ||
    ["client.ts", "path.ts", "sse.ts", "transport.ts", "types.ts"].some(
      (name) => file.endsWith(`${join("src", name)}`),
    ),
);
const styleFiles = sourceFiles(
  resolve(root, "apps/app/src/styles"),
  new Set([".css"]),
);
const localizationNamespaceFiles = sourceFiles(
  resolve(root, "apps/app/src/locales"),
  new Set([".json"]),
);
const cloudSecretIntegrationFiles = [
  resolve(root, "packages/secrets/src/aws-secrets-manager.ts"),
  resolve(root, "packages/secrets/src/azure-key-vault.ts"),
  resolve(root, "packages/secrets/src/gcp-secret-manager.ts"),
  resolve(root, "packages/core/src/services/cloud-secret-resolver.ts"),
  resolve(root, "packages/cli/src/cloud-secret-resolver.ts"),
];
const vaultSecretIntegrationFiles = [
  resolve(root, "packages/secrets/src/vault.ts"),
  resolve(root, "packages/core/src/services/secret-resolver.ts"),
  resolve(root, "packages/core/src/services/secret-writer.ts"),
  resolve(root, "packages/cli/src/vault-secret-resolver.ts"),
];

const appText = joined(appFiles);
const tsxText = joined(appTsxFiles);
const metrics = {
  legacyAppApiFiles: appApiFiles.length,
  legacyAppApiLines: lineCount(appApiFiles),
  legacyApiClientFiles: legacyApiClientFiles.length,
  legacyApiClientLines: lineCount(legacyApiClientFiles),
  manualOpenApiFiles: openApiFiles.length,
  manualOpenApiLines: lineCount(openApiFiles),
  rawButtons: matches(tsxText, /<button\b/gu),
  rawInputs: matches(tsxText, /<input\b/gu),
  rawSelects: matches(tsxText, /<select\b/gu),
  rawTextareas: matches(tsxText, /<textarea\b/gu),
  rmButtonReferences: matches(
    `${appText}\n${joined(styleFiles)}`,
    /rm-button/gu,
  ),
  customFocusTrapImports: matches(appText, /useFocusTrap/gu),
  maxCssFileLines: Math.max(0, ...styleFiles.map(fileLineCount)),
  maxLocalizationNamespaceLines: Math.max(
    0,
    ...localizationNamespaceFiles.map(fileLineCount),
  ),
  oversizedProductionFiles: productionFiles.filter(
    (file) => fileLineCount(file) > 500,
  ).length,
};

const ratchetFailures = Object.entries(baseline.limits).flatMap(
  ([metric, limit]) => {
    const actual = metrics[metric];
    return typeof actual === "number" && actual > limit
      ? [{ metric, limit, actual }]
      : [];
  },
);

const forbiddenPatterns = [
  {
    id: "lucide_barrel_import",
    files: appFiles,
    pattern: /from\s+["']lucide-react["']/u,
  },
  {
    id: "transition_all",
    files: styleFiles,
    pattern: /transition\s*:\s*all(?:\s|;)/u,
  },
  {
    id: "ui_imports_server_packages",
    files: appFiles.filter(
      (file) => !file.includes(`${join("src", "server")}/`),
    ),
    pattern: /from\s+["']@romeo\/(?:core|db)["']/u,
  },
  {
    id: "feature_api_path_literal",
    files: appFiles.filter(
      (file) =>
        !file.includes(`${join("src", "api")}/`) &&
        !file.includes(`${join("src", "server")}/`),
    ),
    pattern: /["'`]\/api\/v1\//u,
  },
  {
    id: "raw_provider_transport",
    files: providerIntegrationFiles,
    pattern: /\b(?:fetch|fetchImpl)\s*\(/u,
  },
  {
    id: "handwritten_provider_endpoint",
    files: providerIntegrationFiles,
    pattern:
      /["'`](?:\/v1\/(?:messages|models|embeddings|chat\/completions|responses)|\/api\/(?:chat|embed|tags|show|pull))["'`]/u,
  },
  {
    id: "handwritten_stripe_signature_verification",
    files: [
      resolve(root, "packages/core/src/services/billing-provider-webhooks.ts"),
    ],
    pattern: /(?:parseStripeSignature|verifyStripeSignature)\s*\(/u,
  },
  {
    id: "handwritten_fcm_transport",
    files: [
      resolve(
        root,
        "packages/core/src/services/notification-delivery-mobile.ts",
      ),
    ],
    pattern:
      /(?:oauth2\.googleapis\.com|messages:send|createSign\s*\(|\bfetch(?:Impl)?\s*\()/u,
  },
  {
    id: "handwritten_qdrant_transport",
    files: [
      resolve(
        root,
        "packages/core/src/services/qdrant-knowledge-vector-store.ts",
      ),
    ],
    pattern:
      /(?:\/points\/query|\/points\?wait=true|\/points\/delete|\bfetch(?:Impl)?\s*\()/u,
  },
  {
    id: "handwritten_cloud_secret_transport",
    files: cloudSecretIntegrationFiles,
    pattern:
      /(?:createHmac|AWS4-HMAC-SHA256|secretsmanager\.[A-Za-z0-9-]+\.amazonaws\.com|secretmanager\.googleapis\.com|\bfetch(?:Impl)?\s*\()/u,
  },
  {
    id: "handwritten_vault_secret_transport",
    files: vaultSecretIntegrationFiles,
    pattern:
      /(?:vaultDataUrl|vaultMetadataUrl|X-Vault-Token|\/v1\/.+\/(?:data|metadata)\/|\bfetch(?:Impl)?\s*\()/u,
  },
  {
    id: "handwritten_oidc_jwt_verification",
    files: [resolve(root, "packages/auth/src/oidc-jwt.ts")],
    pattern: /(?:crypto\.subtle|parseCompactJwt|base64UrlDecode)\b/u,
  },
  {
    id: "handwritten_github_identity_transport",
    files: [
      resolve(
        root,
        "packages/core/src/services/github-oauth2-auth-provider.ts",
      ),
      resolve(
        root,
        "packages/core/src/services/delegated-oauth-github-provider.ts",
      ),
    ],
    pattern:
      /api\.github\.com\/(?:user|applications)|\/user\/(?:emails|orgs|teams)/u,
  },
  {
    id: "handwritten_github_auth_provider_diagnostic",
    files: [
      resolve(
        root,
        "packages/core/src/services/auth-provider-connection-probes.ts",
      ),
    ],
    pattern: /api\.github\.com\/meta/u,
  },
  {
    id: "handwritten_native_channel_client_endpoint",
    files: [
      resolve(root, "packages/api-client/src/resources/channels.ts"),
      resolve(root, "packages/api-client/src/contracts/channels.ts"),
    ],
    pattern: /["'`]\/collaboration\/channels/u,
  },
  {
    id: "handwritten_openai_compatibility_client_endpoint",
    files: [
      resolve(root, "packages/api-client/src/resources/compatibility.ts"),
    ],
    pattern: /["'`]\/api\/v1\/(?:openai\/models|chat\/completions|embeddings)/u,
  },
  {
    id: "handwritten_openwebui_system_client_endpoint",
    files: [
      resolve(root, "packages/api-client/src/resources/compatibility.ts"),
    ],
    pattern: /["'`]\/api\/v1\/(?:auths\/|openwebui\/(?:config|version))/u,
  },
  {
    id: "handwritten_openwebui_chat_folder_client_endpoint",
    files: [
      resolve(root, "packages/api-client/src/resources/compatibility.ts"),
      resolve(root, "packages/api-client/src/resources/openwebui-chats.ts"),
      resolve(root, "packages/api-client/src/contracts/compatibility.ts"),
    ],
    pattern: /["'`]\/api\/v1\/(?:chats|folders)(?:\/|["'`])/u,
  },
  {
    id: "duplicate_openwebui_chat_folder_core_contract",
    files: [resolve(root, "packages/core/src/http/openapi/components.ts")],
    pattern:
      /(?:OpenWebUi(?:Chat|Folder|Tag)|["'`]\/(?:chats|folders)(?:\/|["'`]))/u,
  },
  {
    id: "handwritten_openwebui_channel_client_endpoint",
    files: [
      resolve(root, "packages/api-client/src/resources/compatibility.ts"),
      resolve(root, "packages/api-client/src/resources/openwebui-channels.ts"),
      resolve(root, "packages/api-client/src/contracts/compatibility.ts"),
    ],
    pattern: /["'`]\/api\/v1\/channels(?:\/|["'`])/u,
  },
  {
    id: "duplicate_openwebui_channel_core_contract",
    files: [resolve(root, "packages/core/src/http/openapi/components.ts")],
    pattern: /OpenWebUiChannel/u,
  },
  {
    id: "handwritten_openapi_document_route",
    files: [resolve(root, "packages/core/src/api.ts")],
    pattern: /app\.get\s*\(\s*["'`]\/api\/v1\/(?:docs|openapi\.json)/u,
  },
];

const forbiddenFailures = forbiddenPatterns.flatMap(({ id, files, pattern }) =>
  files.flatMap((file) => {
    if (!existsSync(file)) return [];
    const relativeFile = relative(root, file);
    const exceptions = baseline.exceptions?.[id] ?? [];
    return pattern.test(readFileSync(file, "utf8")) &&
      !exceptions.includes(relativeFile)
      ? [{ id, file: relativeFile }]
      : [];
  }),
);

const requiredPatterns = [
  {
    id: "localization_uses_i18next",
    files: [resolve(root, "apps/app/src/lib/i18n.tsx")],
    pattern: /from\s+["']i18next["']/u,
  },
  {
    id: "react_localization_uses_react_i18next",
    files: [resolve(root, "apps/app/src/lib/i18n.tsx")],
    pattern: /from\s+["']react-i18next["']/u,
  },
  {
    id: "localization_uses_lazy_namespace_backend",
    files: [resolve(root, "apps/app/src/lib/i18n.tsx")],
    pattern: /from\s+["']i18next-resources-to-backend["']/u,
  },
  {
    id: "routes_load_localization_namespaces",
    files: [
      resolve(root, "apps/app/src/routes/index.tsx"),
      resolve(root, "apps/app/src/routes/admin.tsx"),
      resolve(root, "apps/app/src/routes/settings.tsx"),
      resolve(root, "apps/app/src/routes/workspace.tsx"),
    ],
    pattern: /useLocaleNamespaces\s*\(/u,
  },
  {
    id: "openapi_document_route_uses_authoritative_contract",
    files: [resolve(root, "packages/core/src/http/routes/openapi-docs.ts")],
    pattern: /getOpenApiDocumentRoute/u,
  },
  {
    id: "openai_providers_use_official_sdk",
    files: [resolve(root, "packages/providers/src/adapters/provider-sdk.ts")],
    pattern: /from\s+["']openai["']/u,
  },
  {
    id: "anthropic_provider_uses_official_sdk",
    files: [resolve(root, "packages/providers/src/adapters/anthropic.ts")],
    pattern: /from\s+["']@anthropic-ai\/sdk["']/u,
  },
  {
    id: "ollama_provider_uses_official_sdk",
    files: [resolve(root, "packages/providers/src/adapters/provider-sdk.ts")],
    pattern: /from\s+["']ollama["']/u,
  },
  {
    id: "openai_voice_uses_official_sdk",
    files: [resolve(root, "packages/voices/src/openai-compatible-provider.ts")],
    pattern: /from\s+["']openai["']/u,
  },
  {
    id: "oidc_jwt_uses_jose",
    files: [resolve(root, "packages/auth/src/oidc-jwt.ts")],
    pattern: /from\s+["']jose["']/u,
  },
  {
    id: "oidc_flows_use_openid_client",
    files: [
      resolve(root, "packages/core/src/services/oidc-discovery.ts"),
      resolve(root, "packages/core/src/services/oidc-pkce-service.ts"),
    ],
    pattern: /from\s+["']openid-client["']/u,
  },
  {
    id: "oauth_flows_use_oauth4webapi",
    files: [resolve(root, "packages/core/src/services/oauth2-pkce-service.ts")],
    pattern: /from\s+["']oauth4webapi["']/u,
  },
  {
    id: "saml_uses_node_saml",
    files: [resolve(root, "packages/core/src/services/saml-client.ts")],
    pattern: /from\s+["']@node-saml\/node-saml["']/u,
  },
  {
    id: "ldap_uses_ldapts",
    files: [
      resolve(root, "packages/core/src/services/ldap-directory-client.ts"),
    ],
    pattern: /from\s+["']ldapts["']/u,
  },
  {
    id: "password_hashing_uses_argon2",
    files: [resolve(root, "packages/core/src/services/local-password.ts")],
    pattern: /from\s+["']@node-rs\/argon2["']/u,
  },
  {
    id: "totp_uses_otplib",
    files: [resolve(root, "packages/core/src/services/local-mfa.ts")],
    pattern: /from\s+["']otplib["']/u,
  },
  {
    id: "smtp_uses_nodemailer",
    files: [
      resolve(root, "packages/core/src/services/notification-delivery-smtp.ts"),
    ],
    pattern: /from\s+["']nodemailer["']/u,
  },
  {
    id: "stripe_webhooks_use_official_sdk",
    files: [
      resolve(root, "packages/core/src/services/billing-provider-webhooks.ts"),
    ],
    pattern: /from\s+["']stripe["']/u,
  },
  {
    id: "github_connectors_use_official_sdk",
    files: [
      resolve(
        root,
        "packages/core/src/services/github-data-connector-executor.ts",
      ),
    ],
    pattern: /from\s+["']octokit["']/u,
  },
  {
    id: "github_identity_uses_official_sdk",
    files: [
      resolve(
        root,
        "packages/core/src/services/github-oauth2-auth-provider.ts",
      ),
      resolve(
        root,
        "packages/core/src/services/delegated-oauth-github-provider.ts",
      ),
    ],
    pattern: /from\s+["']octokit["']/u,
  },
  {
    id: "github_auth_provider_diagnostic_uses_official_sdk",
    files: [
      resolve(
        root,
        "packages/core/src/services/auth-provider-connection-probes.ts",
      ),
    ],
    pattern: /from\s+["']octokit["']/u,
  },
  {
    id: "s3_connectors_use_official_sdk",
    files: [
      resolve(root, "packages/core/src/services/s3-data-connector-reader.ts"),
    ],
    pattern: /from\s+["']@aws-sdk\/client-s3["']/u,
  },
  {
    id: "s3_presigning_uses_official_sdk",
    files: [resolve(root, "packages/storage/src/s3-signer.ts")],
    pattern: /from\s+["']@aws-sdk\/s3-request-presigner["']/u,
  },
  {
    id: "slack_connectors_use_official_sdk",
    files: [
      resolve(
        root,
        "packages/core/src/services/slack-data-connector-executor.ts",
      ),
    ],
    pattern: /from\s+["']@slack\/web-api["']/u,
  },
  {
    id: "notion_connectors_use_official_sdk",
    files: [
      resolve(
        root,
        "packages/core/src/services/notion-data-connector-executor.ts",
      ),
    ],
    pattern: /from\s+["']@notionhq\/client["']/u,
  },
  {
    id: "linear_connectors_use_official_sdk",
    files: [
      resolve(
        root,
        "packages/core/src/services/linear-data-connector-executor.ts",
      ),
    ],
    pattern: /from\s+["']@linear\/sdk["']/u,
  },
  {
    id: "slack_webhooks_use_official_sdk",
    files: [
      resolve(root, "packages/core/src/services/notification-delivery.ts"),
    ],
    pattern: /from\s+["']@slack\/webhook["']/u,
  },
  {
    id: "resend_email_uses_official_sdk",
    files: [
      resolve(root, "packages/core/src/services/notification-delivery.ts"),
    ],
    pattern: /from\s+["']resend["']/u,
  },
  {
    id: "fcm_uses_official_sdk",
    files: [
      resolve(
        root,
        "packages/core/src/services/notification-delivery-mobile.ts",
      ),
    ],
    pattern: /from\s+["']firebase-admin\/messaging["']/u,
  },
  {
    id: "qdrant_uses_official_sdk",
    files: [
      resolve(
        root,
        "packages/core/src/services/qdrant-knowledge-vector-store.ts",
      ),
    ],
    pattern: /from\s+["']@qdrant\/js-client-rest["']/u,
  },
  {
    id: "aws_secrets_use_official_sdk",
    files: [resolve(root, "packages/secrets/src/aws-secrets-manager.ts")],
    pattern: /from\s+["']@aws-sdk\/client-secrets-manager["']/u,
  },
  {
    id: "azure_secrets_use_official_sdk",
    files: [resolve(root, "packages/secrets/src/azure-key-vault.ts")],
    pattern: /from\s+["']@azure\/keyvault-secrets["']/u,
  },
  {
    id: "gcp_secrets_use_official_sdk",
    files: [resolve(root, "packages/secrets/src/gcp-secret-manager.ts")],
    pattern: /from\s+["']@google-cloud\/secret-manager["']/u,
  },
  {
    id: "vault_secrets_use_qualified_sdk",
    files: [resolve(root, "packages/secrets/src/vault.ts")],
    pattern: /from\s+["']@litehex\/node-vault["']/u,
  },
  {
    id: "workflow_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/workflows.ts")],
    pattern: /from\s+["']@romeo\/contracts["']/u,
  },
  {
    id: "workflow_browser_client_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/workflows/mutations.ts"),
      resolve(root, "apps/app/src/features/workflows/queries.ts"),
    ],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "session_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/sessions.ts")],
    pattern: /from\s+["']@romeo\/contracts["']/u,
  },
  {
    id: "session_browser_client_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/sessions/mutations.ts"),
      resolve(root, "apps/app/src/features/sessions/queries.ts"),
    ],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "delegated_oauth_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/delegated-oauth.ts")],
    pattern: /from\s+["']@romeo\/contracts["']/u,
  },
  {
    id: "delegated_oauth_browser_client_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/delegated-oauth/mutations.ts"),
      resolve(root, "apps/app/src/features/delegated-oauth/queries.ts"),
    ],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "device_authorization_routes_use_authoritative_contracts",
    files: [
      resolve(root, "packages/core/src/http/routes/device-authorizations.ts"),
    ],
    pattern: /from\s+["']@romeo\/contracts["']/u,
  },
  {
    id: "device_authorization_browser_client_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/device-authorizations/mutations.ts"),
      resolve(root, "apps/app/src/features/device-authorizations/queries.ts"),
    ],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "edge_security_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/edge-security.ts")],
    pattern: /from\s+["']@romeo\/contracts["']/u,
  },
  {
    id: "edge_security_browser_client_uses_generated_sdk",
    files: [resolve(root, "apps/app/src/features/edge-security/queries.ts")],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "job_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/jobs.ts")],
    pattern: /from\s+["']@romeo\/contracts["']/u,
  },
  {
    id: "job_browser_client_uses_generated_sdk",
    files: [resolve(root, "apps/app/src/features/jobs/queries.ts")],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "readiness_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/readiness.ts")],
    pattern: /from\s+["']@romeo\/contracts["']/u,
  },
  {
    id: "readiness_browser_client_uses_generated_sdk",
    files: [resolve(root, "apps/app/src/features/readiness/queries.ts")],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "rag_governance_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/readiness.ts")],
    pattern: /getRagPostureRoute/u,
  },
  {
    id: "rag_governance_browser_client_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/rag-governance/mutations.ts"),
      resolve(root, "apps/app/src/features/rag-governance/queries.ts"),
    ],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "auth_provider_administration_uses_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/readiness.ts")],
    pattern: /listAuthProviderCatalogRoute/u,
  },
  {
    id: "auth_provider_administration_browser_uses_generated_sdk",
    files: [
      resolve(
        root,
        "apps/app/src/features/auth-provider-administration/mutations.ts",
      ),
      resolve(
        root,
        "apps/app/src/features/auth-provider-administration/queries.ts",
      ),
    ],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "sso_administration_uses_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/readiness.ts")],
    pattern: /getSsoSettingsRoute/u,
  },
  {
    id: "sso_administration_browser_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/sso-administration/mutations.ts"),
      resolve(root, "apps/app/src/features/sso-administration/queries.ts"),
    ],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "governance_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/governance.ts")],
    pattern: /from\s+["']@romeo\/contracts["']/u,
  },
  {
    id: "governance_browser_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/governance/downloads.ts"),
      resolve(root, "apps/app/src/features/governance/mutations.ts"),
      resolve(root, "apps/app/src/features/governance/queries.ts"),
    ],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "scim_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/scim.ts")],
    pattern: /from\s+["']@romeo\/contracts["']/u,
  },
  {
    id: "local_auth_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/auth.ts")],
    pattern: /from\s+["']@romeo\/contracts["']/u,
  },
  {
    id: "local_auth_browser_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/auth/mutations.ts"),
      resolve(root, "apps/app/src/features/auth/queries.ts"),
    ],
    pattern: /localAuthGetStatus/u,
  },
  {
    id: "federated_auth_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/auth.ts")],
    pattern: /completeOidcLoginRoute/u,
  },
  {
    id: "federated_auth_browser_uses_generated_sdk",
    files: [resolve(root, "apps/app/src/features/auth/mutations.ts")],
    pattern: /federatedAuthStartOidcLogin/u,
  },
  {
    id: "tool_approval_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/tools.ts")],
    pattern: /listToolApprovalsRoute/u,
  },
  {
    id: "tool_approval_browser_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/tool-approvals/mutations.ts"),
      resolve(root, "apps/app/src/features/tool-approvals/queries.ts"),
    ],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "tool_catalog_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/tools.ts")],
    pattern: /listAgentToolsRoute/u,
  },
  {
    id: "tool_catalog_browser_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/tools/mutations.ts"),
      resolve(root, "apps/app/src/features/tools/queries.ts"),
    ],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "tool_connector_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/tools.ts")],
    pattern: /listToolConnectorsRoute/u,
  },
  {
    id: "tool_connector_browser_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/tool-connectors/mutations.ts"),
      resolve(root, "apps/app/src/features/tool-connectors/queries.ts"),
    ],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "tool_operation_browser_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/tool-connectors/mutations.ts"),
    ],
    pattern: /toolConnectorsDispatchOperation/u,
  },
  {
    id: "tool_execution_browser_uses_generated_sdk",
    files: [resolve(root, "apps/app/src/features/tools/mutations.ts")],
    pattern: /toolsExecute/u,
  },
  {
    id: "tool_dispatch_worker_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/tool-dispatch.ts")],
    pattern: /enqueueToolDispatchRequestRoute/u,
  },
  {
    id: "run_tool_execution_uses_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/tools.ts")],
    pattern: /executeRunToolRoute/u,
  },
  {
    id: "valkey_coordination_uses_official_glide_sdk",
    files: [resolve(root, "packages/core/src/services/valkey-glide-client.ts")],
    pattern:
      /import\s+\{[\s\S]*GlideClient[\s\S]*\}\s+from\s+["']@valkey\/valkey-glide["']/u,
  },
  {
    id: "romeo_client_runtime_uses_generated_sdk",
    files: [
      resolve(root, "packages/api-client/src/runtime/generated-client.ts"),
    ],
    pattern: /from\s+["']\.\.\/generated\/sdk\/client["']/u,
  },
  {
    id: "knowledge_cli_uses_generated_sdk",
    files: [resolve(root, "packages/cli/src/knowledge-commands.ts")],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "provider_cli_uses_generated_sdk",
    files: [resolve(root, "packages/cli/src/provider-commands.ts")],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "managed_model_cli_uses_generated_sdk",
    files: [resolve(root, "packages/cli/src/managed-model-commands.ts")],
    pattern: /from\s+["']@romeo\/api-client\/generated\/sdk["']/u,
  },
  {
    id: "tool_oauth_client_credentials_uses_oauth4webapi",
    files: [
      resolve(
        root,
        "packages/core/src/services/tool-oauth-client-credentials.ts",
      ),
    ],
    pattern: /clientCredentialsGrantRequest/u,
  },
  {
    id: "tool_worker_oauth_client_credentials_uses_oauth4webapi",
    files: [resolve(root, "packages/cli/src/tool-dispatch-auth.ts")],
    pattern: /clientCredentialsGrantRequest/u,
  },
  {
    id: "operational_posture_routes_use_authoritative_contracts",
    files: [
      resolve(root, "packages/core/src/http/routes/ga-evidence-posture.ts"),
      resolve(
        root,
        "packages/core/src/http/routes/postgres-operational-posture.ts",
      ),
    ],
    pattern: /from\s+["']@romeo\/contracts["']/u,
  },
  {
    id: "operational_posture_browser_uses_generated_sdk",
    files: [
      resolve(root, "apps/app/src/features/operational-posture/queries.ts"),
    ],
    pattern: /operationalPostureGetGaEvidence/u,
  },
  {
    id: "native_channel_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/channels.ts")],
    pattern: /listChannelsRoute/u,
  },
  {
    id: "native_channel_generated_sdk_exports_operation",
    files: [resolve(root, "packages/api-client/src/generated/sdk/sdk.gen.ts")],
    pattern: /channelsList/u,
  },
  {
    id: "browser_automation_routes_use_authoritative_contracts",
    files: [
      resolve(root, "packages/core/src/http/routes/browser-automation.ts"),
    ],
    pattern: /getBrowserAutomationPostureRoute/u,
  },
  {
    id: "openai_compatibility_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/compatibility.ts")],
    pattern: /createOpenAiChatCompletionRoute/u,
  },
  {
    id: "openai_compatibility_generated_sdk_exports_operation",
    files: [resolve(root, "packages/api-client/src/generated/sdk/sdk.gen.ts")],
    pattern: /openAiCompatibilityCreateChatCompletion/u,
  },
  {
    id: "openwebui_system_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/openwebui.ts")],
    pattern: /getOpenWebUiConfigRoute/u,
  },
  {
    id: "openwebui_system_generated_sdk_exports_operation",
    files: [resolve(root, "packages/api-client/src/generated/sdk/sdk.gen.ts")],
    pattern: /openWebUiGetConfig/u,
  },
  {
    id: "openwebui_chat_folder_routes_use_authoritative_contracts",
    files: [resolve(root, "packages/core/src/http/routes/openwebui-chats.ts")],
    pattern: /listOpenWebUiChatsRoute/u,
  },
  {
    id: "openwebui_chat_folder_generated_sdk_exports_operation",
    files: [resolve(root, "packages/api-client/src/generated/sdk/sdk.gen.ts")],
    pattern: /openWebUiListChats/u,
  },
  {
    id: "openwebui_channel_routes_use_authoritative_contracts",
    files: [
      resolve(root, "packages/core/src/http/routes/openwebui-channels.ts"),
    ],
    pattern: /listOpenWebUiChannelsRoute/u,
  },
  {
    id: "openwebui_channel_generated_sdk_exports_operation",
    files: [resolve(root, "packages/api-client/src/generated/sdk/sdk.gen.ts")],
    pattern: /openWebUiListChannels/u,
  },
];
const requiredFailures = requiredPatterns.flatMap(({ id, files, pattern }) =>
  files
    .filter((file) => existsSync(file))
    .some((file) => pattern.test(readFileSync(file, "utf8")))
    ? []
    : [{ id }],
);

const status =
  ratchetFailures.length === 0 &&
  forbiddenFailures.length === 0 &&
  requiredFailures.length === 0
    ? "passed"
    : "failed";
const oversizedProductionFileInventory = productionFiles
  .map((file) => ({ file: relative(root, file), lines: fileLineCount(file) }))
  .filter(({ lines }) => lines > 500)
  .sort(
    (left, right) =>
      right.lines - left.lines || left.file.localeCompare(right.file),
  );
const evidence = {
  schemaVersion: baseline.schemaVersion,
  generatedAt: new Date().toISOString(),
  status,
  metrics,
  limits: baseline.limits,
  inventories: {
    legacyApiClientFiles: legacyApiClientFiles
      .map((file) => relative(root, file))
      .sort(),
    oversizedProductionFiles: oversizedProductionFileInventory,
  },
  ratchetFailures,
  forbiddenFailures,
  requiredFailures,
};

mkdirSync(dirname(outputPath), { recursive: true });
writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, "utf8");
console.log(`Wrote architecture ratchet evidence to ${outputPath}`);
if (status !== "passed") {
  for (const failure of ratchetFailures) {
    console.error(
      `${failure.metric} increased from ${failure.limit} to ${failure.actual}.`,
    );
  }
  for (const failure of forbiddenFailures) {
    console.error(`${failure.id}: ${failure.file}`);
  }
  for (const failure of requiredFailures) {
    console.error(`${failure.id}: required SDK integration is missing.`);
  }
  process.exitCode = 1;
}

function sourceFiles(directory, extensions) {
  if (!existsSync(directory)) return [];
  const files = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...sourceFiles(path, extensions));
      continue;
    }
    if (
      entry.isFile() &&
      extensions.has(extname(path)) &&
      !path.includes(".test.") &&
      !path.includes(`${join("src", "generated")}/`) &&
      !path.endsWith("routeTree.gen.ts")
    ) {
      files.push(path);
    }
  }
  return files.sort();
}

function fileLineCount(file) {
  return readFileSync(file, "utf8").split(/\r?\n/u).length;
}

function lineCount(files) {
  return files.reduce((total, file) => total + fileLineCount(file), 0);
}

function joined(files) {
  return files.map((file) => readFileSync(file, "utf8")).join("\n");
}

function matches(value, pattern) {
  return Array.from(value.matchAll(pattern)).length;
}
