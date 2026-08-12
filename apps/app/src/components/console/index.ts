/**
 * The console design system — every admin and workspace surface is built from
 * these and nothing else.
 *
 * Panels supply content. Spacing, heading type, dividers, and the action slot
 * belong to these primitives, which is what keeps ~50 independently written
 * panels reading as one product. If a panel needs a margin utility to look
 * right, the primitive is missing a case — fix it here, not there.
 *
 * The chat surface is deliberately not built from these; it has its own
 * language and is out of scope.
 */
export { Page, PageTab, PageTabs } from "./Page";
/* The TanStack Table wrapper is already the right abstraction — one
   useReactTable in packages/ui, consumed everywhere. Re-exported here so a
   panel imports its whole vocabulary from one place. */
export {
  DataTable,
  createColumnHelper,
  type ColumnDef,
  type ServerPagination,
} from "../DataTable";
export { Disclosure, Section, StatRow } from "./Section";
export {
  AddButton,
  EmptyState,
  RefreshButton,
  SaveBar,
  Toolbar,
} from "./Toolbar";
