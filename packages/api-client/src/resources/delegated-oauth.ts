import type {
  DelegatedOAuthConnection,
  DelegatedOAuthProvider,
  DelegatedOAuthStartResult,
  StartDelegatedOAuthInput,
} from "../contracts/delegated-oauth";
import type { RomeoTransport } from "../transport";

export function createDelegatedOAuthResource(transport: RomeoTransport) {
  return {
    providers: () =>
      transport.data<DelegatedOAuthProvider[]>(
        "GET",
        "/api/v1/delegated-oauth/providers",
      ),
    connections: (workspaceId?: string) => {
      const query =
        workspaceId === undefined
          ? ""
          : `?workspaceId=${encodeURIComponent(workspaceId)}`;
      return transport.data<DelegatedOAuthConnection[]>(
        "GET",
        `/api/v1/delegated-oauth/connections${query}`,
      );
    },
    revoke: (connectionId: string) =>
      transport.data<DelegatedOAuthConnection>(
        "POST",
        `/api/v1/delegated-oauth/connections/${encodeURIComponent(connectionId)}/revoke`,
      ),
    start: (input: StartDelegatedOAuthInput) =>
      transport.data<DelegatedOAuthStartResult>(
        "POST",
        "/api/v1/delegated-oauth/start",
        input,
      ),
  };
}
