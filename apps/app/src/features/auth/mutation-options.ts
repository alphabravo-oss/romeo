import * as appQueryKeys from "../../lib/app-query-keys";
import { serverMutationOptions } from "../../lib/server-mutation-options";
import {
  confirmTotpEnrollment,
  disableTotpFactor,
  generateRecoveryCodes,
  setLocalPassword,
  startTotpEnrollment,
} from "./mutations";

const localAuthStatusInvalidation = () => [
  { exact: true as const, queryKey: appQueryKeys.localAuthStatus() },
];

export function setLocalPasswordMutationOptions() {
  return serverMutationOptions({
    resource: "localAuth.password.set",
    mutationFn: setLocalPassword,
    invalidations: localAuthStatusInvalidation,
  });
}

export function startTotpEnrollmentMutationOptions() {
  return serverMutationOptions({
    resource: "localAuth.totp.enrollment.start",
    mutationFn: startTotpEnrollment,
  });
}

export function confirmTotpEnrollmentMutationOptions() {
  return serverMutationOptions({
    resource: "localAuth.totp.enrollment.confirm",
    mutationFn: confirmTotpEnrollment,
    invalidations: localAuthStatusInvalidation,
  });
}

export function generateRecoveryCodesMutationOptions() {
  return serverMutationOptions({
    resource: "localAuth.recoveryCodes.generate",
    mutationFn: generateRecoveryCodes,
    invalidations: localAuthStatusInvalidation,
  });
}

export function disableTotpFactorMutationOptions() {
  return serverMutationOptions({
    resource: "localAuth.totp.disable",
    mutationFn: disableTotpFactor,
    invalidations: localAuthStatusInvalidation,
  });
}
