import type { AuthSubject } from "@romeo/auth";

import type { RomeoRepository } from "../domain/repository";
import { createId } from "../ids";
import type { TableExportJob } from "./server-table-export-job";
import { WorkerSupervisor } from "./worker-supervisor";

export class ServerTableExportScheduler {
  private readonly supervisor = new WorkerSupervisor("server_table_export");
  private readonly workerId = createId("table_export_worker");

  constructor(
    private readonly repository: RomeoRepository,
    private readonly runNext: (input: {
      subject: AuthSubject;
      workerId: string;
      signal?: AbortSignal;
    }) => Promise<TableExportJob | undefined>,
  ) {}

  start(): void {
    this.supervisor.start((signal) => this.runAllTenants(signal), {
      intervalMs: 1_000,
      maxBackoffMs: 30_000,
      jitterRatio: 0.2,
    });
  }

  stop(): void {
    this.supervisor.stop();
  }

  drain(): Promise<void> {
    return this.supervisor.drain();
  }

  private async runAllTenants(signal?: AbortSignal): Promise<number> {
    let completed = 0;
    for (const organization of await this.repository.listAllOrganizations()) {
      if (signal?.aborted) break;
      const workspaces = await this.repository.listWorkspaces(organization.id);
      const subject: AuthSubject = {
        groupIds: [],
        id: `system_table_export_${organization.id}`,
        isAdmin: true,
        orgId: organization.id,
        scopes: ["admin:read", "workspaces:read"],
        type: "service_account",
        workspaceIds: workspaces.map((workspace) => workspace.id),
      };
      if (
        (await this.runNext({
          subject,
          workerId: this.workerId,
          ...(signal === undefined ? {} : { signal }),
        })) !== undefined
      )
        completed += 1;
    }
    return completed;
  }
}
