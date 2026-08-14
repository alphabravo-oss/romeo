import {
  isSafeRelativeReturnPath,
  normalizeWebOrigin,
} from "@romeo/auth/navigation";

import { ApiError } from "../errors";
import { requirePublicApiErrorCode } from "../public-api-error-registry";

export function normalizeAppOrigin(value: string): string {
  return normalizeWebOrigin(value);
}

export function sanitizeAuthReturnTo(
  value: string | undefined,
  options: { errorCode: string; flowName: string },
): string {
  if (value === undefined || value.length === 0) return "/";
  if (!isSafeRelativeReturnPath(value)) {
    throw new ApiError(
      requirePublicApiErrorCode(options.errorCode),
      `${options.flowName} return path must be a relative application path.`,
      400,
    );
  }
  return value;
}
