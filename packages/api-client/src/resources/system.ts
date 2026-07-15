import { pathId } from "../path";
import type { RomeoTransport } from "../transport";
import type {
  BootstrapResponse,
  CreateWorkspaceInput,
  HealthStatus,
  Organization,
  UpdateMyProfileInput,
  UserProfile,
  Workspace,
  WorkspaceExportDocument,
} from "../types";

export function createSystemResource(transport: RomeoTransport) {
  return {
    health: () => transport.data<HealthStatus>("GET", "/api/v1/health"),
    me: () => transport.request<BootstrapResponse>("GET", "/api/v1/me"),
    updateMyProfile: (input: UpdateMyProfileInput) =>
      transport.data<UserProfile>("PATCH", "/api/v1/me", input),
    organizations: () =>
      transport.data<Organization[]>("GET", "/api/v1/organizations"),
    workspaces: () => transport.data<Workspace[]>("GET", "/api/v1/workspaces"),
    createWorkspace: (input: CreateWorkspaceInput) =>
      transport.data<Workspace>("POST", "/api/v1/workspaces", input),
    archiveWorkspace: (workspaceId: string) =>
      transport.data<Workspace>(
        "POST",
        `/api/v1/workspaces/${pathId(workspaceId)}/archive`,
      ),
    exportWorkspace: (workspaceId: string) =>
      transport.data<WorkspaceExportDocument>(
        "GET",
        `/api/v1/workspaces/${pathId(workspaceId)}/export`,
      ),
  };
}
