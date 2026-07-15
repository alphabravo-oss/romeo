export function append<T>(collection: T[], item: T): T {
  collection.push(item)
  return item
}

export function appendMany<T>(collection: T[], items: T[]): T[] {
  collection.push(...items)
  return items
}

export function replaceById<T extends { id: string }>(collection: T[], item: T): T {
  const index = collection.findIndex((current) => current.id === item.id)
  if (index >= 0) collection[index] = item
  return item
}

export function removeById<T extends { id: string }>(collection: T[], id: string): T | undefined {
  const index = collection.findIndex((item) => item.id === id)
  return index < 0 ? undefined : collection.splice(index, 1)[0]
}
