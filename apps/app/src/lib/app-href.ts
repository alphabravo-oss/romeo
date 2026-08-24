export function appHref(
  pathname: string,
  search: Readonly<Record<string, boolean | number | string | undefined>>,
): string {
  const parameters = new URLSearchParams();
  for (const [key, value] of Object.entries(search).sort(([left], [right]) =>
    left.localeCompare(right),
  )) {
    if (value !== undefined && value !== "") parameters.set(key, String(value));
  }
  const query = parameters.toString();
  return query === "" ? pathname : `${pathname}?${query}`;
}
