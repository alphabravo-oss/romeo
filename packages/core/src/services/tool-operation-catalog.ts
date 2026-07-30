import type { ToolOperation } from "../domain/entities";
import type { RomeoRepository } from "../domain/repository";

export async function listToolOperationsByConnector(
  repository: RomeoRepository,
  connectors: readonly { id: string }[],
): Promise<Map<string, ToolOperation[]>> {
  const operations = await repository.listToolOperationsForConnectors(
    connectors.map((connector) => connector.id),
  );
  const grouped = new Map<string, ToolOperation[]>();
  for (const operation of operations) {
    const values = grouped.get(operation.connectorId) ?? [];
    values.push(operation);
    grouped.set(operation.connectorId, values);
  }
  return grouped;
}
