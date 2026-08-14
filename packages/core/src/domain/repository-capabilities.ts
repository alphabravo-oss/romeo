import type {
  CapabilityAssignment,
  ListActiveCapabilityAssignmentsInput,
  ListCapabilityAssignmentHistoryInput,
  ReplaceCapabilityAssignmentInput,
} from "./capabilities";

export interface RepositoryCapabilityAssignments {
  listActiveCapabilityAssignments(
    input: ListActiveCapabilityAssignmentsInput,
  ): Promise<CapabilityAssignment[]>;
  listCapabilityAssignmentHistory(
    input: ListCapabilityAssignmentHistoryInput,
  ): Promise<CapabilityAssignment[]>;
  replaceCapabilityAssignment(
    input: ReplaceCapabilityAssignmentInput,
  ): Promise<CapabilityAssignment>;
}
