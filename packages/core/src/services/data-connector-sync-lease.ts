import type { DataConnector } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import {
  startWorkLeaseHeartbeat,
  type WorkLeaseHeartbeat,
} from "./work-lease-heartbeat";

export function startDataConnectorSyncHeartbeat(
  repository: RomeoRepository,
  connector: DataConnector,
): WorkLeaseHeartbeat {
  const lease = connector.syncLease;
  if (lease === undefined) throw leaseLost();
  return startWorkLeaseHeartbeat({
    leaseDurationMs: 300_000,
    lostError: leaseLost,
    renew: async (renewal) =>
      (await repository.renewDataConnectorSyncLease({
        connectorId: connector.id,
        fencingToken: lease.fencingToken,
        leaseOwner: lease.owner,
        leaseToken: lease.token,
        ...renewal,
      })) !== undefined,
  });
}

function leaseLost(): ApiError {
  return new ApiError(
    "connector_sync_lease_lost",
    "The connector synchronization lease was lost.",
    409,
  );
}
