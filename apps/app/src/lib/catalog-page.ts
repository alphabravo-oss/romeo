export interface CatalogPage<T> {
  items: T[];
  page: number;
  pageCount: number;
  total: number;
}

export function catalogPage<T>(
  items: T[],
  options: {
    page: number;
    pageSize: number;
    query?: string;
    searchText?: (item: T) => string;
  },
): CatalogPage<T> {
  const query = options.query?.trim().toLocaleLowerCase() ?? "";
  const filtered =
    query === "" || options.searchText === undefined
      ? items
      : items.filter((item) =>
          options.searchText!(item).toLocaleLowerCase().includes(query),
        );
  const pageSize = Math.max(1, Math.floor(options.pageSize));
  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  const page = Math.min(Math.max(0, Math.floor(options.page)), pageCount - 1);
  return {
    items: filtered.slice(page * pageSize, (page + 1) * pageSize),
    page,
    pageCount,
    total: filtered.length,
  };
}
