import type { RomeoRepository } from "../domain/repository";
import { InMemoryOrganizationRepository } from "./in-memory-organization";

export class InMemoryRomeoRepository
  extends InMemoryOrganizationRepository
  implements RomeoRepository {}

export const defaultRepository = new InMemoryRomeoRepository();
