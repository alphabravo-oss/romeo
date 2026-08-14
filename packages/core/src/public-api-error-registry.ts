import { publicErrorClientCodesByHttpStatus } from "./public-api-error-client-codes";
import { publicErrorRuntimeCodesByHttpStatus } from "./public-api-error-runtime-codes";

export type PublicErrorLocalizationIntent =
  | "authenticate"
  | "contact_support"
  | "correct_content"
  | "correct_request"
  | "reduce_payload"
  | "request_access"
  | "resolve_conflict"
  | "resource_missing"
  | "retry_later"
  | "temporarily_unavailable"
  | "upstream_failure"
  | "upstream_timeout"
  | "use_supported_media";

export type PublicErrorOperatorRemediation =
  | "inspect_content"
  | "inspect_service_health"
  | "inspect_service_logs"
  | "inspect_upstream_dependency"
  | "inspect_upstream_latency"
  | "reduce_request_size"
  | "refresh_and_retry"
  | "retry_with_backoff"
  | "review_access_policy"
  | "use_supported_format"
  | "validate_request"
  | "verify_authentication"
  | "verify_resource_identifier";

export type PublicErrorLocalizationCopyKey =
  `api-errors:intents.${PublicErrorLocalizationIntent}`;

export const publicErrorCodesByHttpStatus = {
  ...publicErrorClientCodesByHttpStatus,
  ...publicErrorRuntimeCodesByHttpStatus,
} as const;

type PublicErrorStatusKey = keyof typeof publicErrorCodesByHttpStatus;
export type PublicErrorHttpStatus = PublicErrorStatusKey;
export type PublicApiErrorCode = {
  [Status in PublicErrorStatusKey]: (typeof publicErrorCodesByHttpStatus)[Status][number];
}[PublicErrorStatusKey];

export interface PublicApiErrorDefinition {
  acceptedHttpStatuses: readonly PublicErrorHttpStatus[];
  code: PublicApiErrorCode;
  copyKey: PublicErrorLocalizationCopyKey;
  httpStatus: PublicErrorHttpStatus;
  localizationIntent: PublicErrorLocalizationIntent;
  operatorRemediation: PublicErrorOperatorRemediation;
  retryable: boolean;
}

const statusPolicy = {
  400: {
    copyKey: "api-errors:intents.correct_request",
    localizationIntent: "correct_request",
    operatorRemediation: "validate_request",
    retryable: false,
  },
  401: {
    copyKey: "api-errors:intents.authenticate",
    localizationIntent: "authenticate",
    operatorRemediation: "verify_authentication",
    retryable: false,
  },
  403: {
    copyKey: "api-errors:intents.request_access",
    localizationIntent: "request_access",
    operatorRemediation: "review_access_policy",
    retryable: false,
  },
  404: {
    copyKey: "api-errors:intents.resource_missing",
    localizationIntent: "resource_missing",
    operatorRemediation: "verify_resource_identifier",
    retryable: false,
  },
  409: {
    copyKey: "api-errors:intents.resolve_conflict",
    localizationIntent: "resolve_conflict",
    operatorRemediation: "refresh_and_retry",
    retryable: false,
  },
  413: {
    copyKey: "api-errors:intents.reduce_payload",
    localizationIntent: "reduce_payload",
    operatorRemediation: "reduce_request_size",
    retryable: false,
  },
  415: {
    copyKey: "api-errors:intents.use_supported_media",
    localizationIntent: "use_supported_media",
    operatorRemediation: "use_supported_format",
    retryable: false,
  },
  422: {
    copyKey: "api-errors:intents.correct_content",
    localizationIntent: "correct_content",
    operatorRemediation: "inspect_content",
    retryable: false,
  },
  429: {
    copyKey: "api-errors:intents.retry_later",
    localizationIntent: "retry_later",
    operatorRemediation: "retry_with_backoff",
    retryable: true,
  },
  500: {
    copyKey: "api-errors:intents.contact_support",
    localizationIntent: "contact_support",
    operatorRemediation: "inspect_service_logs",
    retryable: false,
  },
  502: {
    copyKey: "api-errors:intents.upstream_failure",
    localizationIntent: "upstream_failure",
    operatorRemediation: "inspect_upstream_dependency",
    retryable: true,
  },
  503: {
    copyKey: "api-errors:intents.temporarily_unavailable",
    localizationIntent: "temporarily_unavailable",
    operatorRemediation: "inspect_service_health",
    retryable: true,
  },
  504: {
    copyKey: "api-errors:intents.upstream_timeout",
    localizationIntent: "upstream_timeout",
    operatorRemediation: "inspect_upstream_latency",
    retryable: true,
  },
} as const satisfies Record<
  PublicErrorHttpStatus,
  Pick<
    PublicApiErrorDefinition,
    "copyKey" | "localizationIntent" | "operatorRemediation" | "retryable"
  >
>;

/** Existing compatibility exceptions. The policy gate rejects new ones. */
const legacyAlternateHttpStatuses = {
  delegated_oauth_scope_invalid: [401],
  knowledge_retrieval_plan_empty: [403],
  managed_secret_external_write_failed: [400, 403, 409],
  saml_request_state_invalid: [401],
  scim_error: [403, 404, 409],
} as const satisfies Partial<
  Record<PublicApiErrorCode, readonly PublicErrorHttpStatus[]>
>;

export const publicApiErrorRegistry = Object.freeze(
  Object.fromEntries(
    Object.entries(publicErrorCodesByHttpStatus).flatMap(
      ([rawStatus, codes]) => {
        const httpStatus = Number(rawStatus) as PublicErrorHttpStatus;
        return codes.map((code) => {
          const alternate =
            legacyAlternateHttpStatuses[
              code as keyof typeof legacyAlternateHttpStatuses
            ] ?? [];
          return [
            code,
            Object.freeze({
              acceptedHttpStatuses: Object.freeze([httpStatus, ...alternate]),
              code,
              httpStatus,
              ...statusPolicy[httpStatus],
            }),
          ];
        });
      },
    ),
  ),
) as Readonly<Record<PublicApiErrorCode, PublicApiErrorDefinition>>;

export function publicApiErrorDefinition(
  code: string,
): PublicApiErrorDefinition | undefined {
  return (
    publicApiErrorRegistry as Readonly<Record<string, PublicApiErrorDefinition>>
  )[code];
}

export function isPublicApiErrorCode(code: string): code is PublicApiErrorCode {
  return publicApiErrorDefinition(code) !== undefined;
}

export function requirePublicApiErrorCode(code: string): PublicApiErrorCode {
  if (isPublicApiErrorCode(code)) return code;
  throw new TypeError("Public API error code is not registered.");
}
