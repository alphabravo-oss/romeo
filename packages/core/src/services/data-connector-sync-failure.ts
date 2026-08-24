import type { AuthSubject } from "@romeo/auth";
import type { ContentfulStatusCode } from "hono/utils/http-status";

import type { DataConnector, DataConnectorSync } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";
import { ApiError } from "../errors";
import { requirePublicApiErrorCode } from "../public-api-error-registry";
import { writeAuditLog } from "./audit-log";
import {
  connectorSyncErrorMessage,
  nextScheduleFields,
} from "./data-connector-config";

export async function failDataConnectorSync(input: {
  connector: DataConnector;
  errorCode: string;
  repository: RomeoRepository;
  statusCode: ContentfulStatusCode;
  subject: AuthSubject;
  sync: DataConnectorSync;
}): Promise<never> {
  const completedAt = new Date().toISOString();
  const lease = input.connector.syncLease;
  if (lease === undefined) throw leaseLost();
  await input.repository.transaction(async (repository) => {
    const failed = await repository.finishDataConnectorSync({
      connector: {
        ...input.connector,
        ...nextScheduleFields(input.connector, completedAt),
        updatedAt: completedAt,
      },
      fencingToken: lease.fencingToken,
      leaseOwner: lease.owner,
      leaseToken: lease.token,
      now: completedAt,
      sync: {
        ...input.sync,
        status: "failed",
        errorCode: input.errorCode,
        summary: {
          connectorType: input.connector.type,
          errorCode: input.errorCode,
        },
        completedAt,
      },
    });
    if (failed === undefined) throw leaseLost();
    await writeAuditLog(repository, {
      subject: input.subject,
      action: "data_connector.sync",
      resourceType: "data_connector",
      resourceId: input.connector.id,
      outcome: "failure",
      metadata: { syncId: input.sync.id, errorCode: input.errorCode },
    });
  });
  throw new ApiError(
    requirePublicApiErrorCode(input.errorCode),
    connectorSyncErrorMessage(input.errorCode),
    input.statusCode,
  );
}

function leaseLost(): ApiError {
  return new ApiError(
    "connector_sync_lease_lost",
    "The connector synchronization lease was lost.",
    409,
  );
}
