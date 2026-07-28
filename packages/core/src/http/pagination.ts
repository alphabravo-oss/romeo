import { ApiError } from "../errors";

export function optionalBoundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    throw new ApiError(
      "invalid_pagination",
      `Expected an integer between ${minimum} and ${maximum}.`,
      400,
    );
  }
  return parsed;
}
