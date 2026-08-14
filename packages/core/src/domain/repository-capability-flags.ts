import type {
  ListOrganizationCapabilityFlagHistoryInput,
  ListOrganizationCapabilityFlagsInput,
  OrganizationCapabilityFlag,
  ReplaceOrganizationCapabilityFlagInput,
} from "./capability-flags";

export interface RepositoryCapabilityFlags {
  listActiveOrganizationCapabilityFlags(
    input: ListOrganizationCapabilityFlagsInput,
  ): Promise<OrganizationCapabilityFlag[]>;
  listOrganizationCapabilityFlagHistory(
    input: ListOrganizationCapabilityFlagHistoryInput,
  ): Promise<OrganizationCapabilityFlag[]>;
  replaceOrganizationCapabilityFlag(
    input: ReplaceOrganizationCapabilityFlagInput,
  ): Promise<OrganizationCapabilityFlag>;
}
