import type { RepositoryFragment } from "./repository-fragment-types";

export * from "./repository-fragment-types";
export * from "./repository-fragment-primary-factories";
export * from "./repository-fragment-secondary-factories";

type UnionToIntersection<Union> = (
  Union extends unknown ? (value: Union) => void : never
) extends (value: infer Intersection) => void
  ? Intersection
  : never;

export function composeRepositoryFragments<
  const Fragments extends readonly RepositoryFragment[],
>(...fragments: Fragments): UnionToIntersection<Fragments[number]> {
  const composed: Record<string, (...args: never[]) => Promise<unknown>> = {};
  for (const fragment of fragments) {
    for (const [name, method] of Object.entries(fragment)) {
      if (composed[name] !== undefined)
        throw new Error(`Repository fragment collision: ${name}`);
      composed[name] = method;
    }
  }
  return composed as UnionToIntersection<Fragments[number]>;
}
