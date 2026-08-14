import type { BaseModel } from "../features/providers/types";
import { createColumnHelper } from "./DataTable";

export const modelCatalogColumnHelper = createColumnHelper<BaseModel>();
