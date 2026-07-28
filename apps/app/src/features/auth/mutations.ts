import {
  authenticationLoginLocal,
  authenticationVerifyLocalMfa,
  federatedAuthStartOidcLogin,
  federatedAuthStartSamlLogin,
  type FederatedAuthStartOidcLoginData,
  type FederatedAuthStartSamlLoginData,
  localAuthConfirmTotpEnrollment,
  localAuthDisableTotpFactor,
  localAuthSetPassword,
  localAuthStartTotpEnrollment,
  type LocalAuthenticatedLoginResult,
  type LocalAuthStatus,
  type LocalLoginRequest,
  type LocalLoginResult,
  type LocalMfaFactorSummary,
  type LocalMfaVerifyRequest,
  type OidcLoginStart,
  type SamlLoginStart,
  type SetLocalPasswordRequest,
  type TotpConfirmRequest,
  type TotpEnrollment,
  type TotpEnrollmentRequest,
} from "@romeo/api-client/generated/sdk";
import { configureBrowserApiClients } from "@romeo/api-client/runtime/browser";

export async function localLogin(
  input: LocalLoginRequest,
): Promise<LocalLoginResult> {
  configureBrowserApiClients();
  const response = await authenticationLoginLocal({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function verifyLocalMfa(
  input: LocalMfaVerifyRequest,
): Promise<LocalAuthenticatedLoginResult> {
  configureBrowserApiClients();
  const response = await authenticationVerifyLocalMfa({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function startOidcLogin(
  input: FederatedAuthStartOidcLoginData["query"] = {},
): Promise<OidcLoginStart> {
  configureBrowserApiClients();
  const response = await federatedAuthStartOidcLogin({
    query: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function startSamlLogin(
  input: FederatedAuthStartSamlLoginData["query"] = {},
): Promise<SamlLoginStart> {
  configureBrowserApiClients();
  const response = await federatedAuthStartSamlLogin({
    query: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function setLocalPassword(
  input: SetLocalPasswordRequest,
): Promise<LocalAuthStatus> {
  configureBrowserApiClients();
  const response = await localAuthSetPassword({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function startTotpEnrollment(
  input: TotpEnrollmentRequest = {},
): Promise<TotpEnrollment> {
  configureBrowserApiClients();
  const response = await localAuthStartTotpEnrollment({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function confirmTotpEnrollment(
  input: TotpConfirmRequest,
): Promise<LocalMfaFactorSummary> {
  configureBrowserApiClients();
  const response = await localAuthConfirmTotpEnrollment({
    body: input,
    throwOnError: true,
  });
  return response.data.data;
}

export async function disableTotpFactor(input: {
  factorId: string;
  code?: string;
}): Promise<LocalMfaFactorSummary> {
  const { factorId, code } = input;
  configureBrowserApiClients();
  const response = await localAuthDisableTotpFactor({
    path: { factorId },
    body: code === undefined ? {} : { code },
    throwOnError: true,
  });
  return response.data.data;
}
