import type { RomeoRepository } from "../domain/repository";
import { InMemoryOrganizationRepository } from "./in-memory-organization";
import { createRuntimeSeedData } from "./seed-data";

export { createRuntimeSeedData } from "./seed-data";

export class InMemoryRomeoRepository
  extends InMemoryOrganizationRepository
  implements RomeoRepository {}

export const defaultRepository = new InMemoryRomeoRepository(
  createRuntimeSeedData(),
);
