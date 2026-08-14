import { z } from "@hono/zod-openapi";

export const ServerTableSortDirectionSchema = z.enum(["asc", "desc"]);
export const ServerTableNullPlacementSchema = z.enum(["first", "last"]);
export const ServerTableFilterOperatorSchema = z.enum([
  "eq",
  "neq",
  "in",
  "not_in",
  "contains",
  "starts_with",
  "gt",
  "gte",
  "lt",
  "lte",
  "between",
  "is_null",
  "not_null",
]);

export type ServerTableFilterOperator = z.infer<
  typeof ServerTableFilterOperatorSchema
>;

export interface ServerTableQueryPolicy {
  sortFields: readonly [string, ...string[]];
  filters: Readonly<
    Record<string, Partial<Record<ServerTableFilterOperator, z.ZodType | null>>>
  >;
  defaultSort: readonly ServerTableSort[];
  maxLimit?: number;
  maxSorts?: number;
  maxFilters?: number;
  search?: { maxLength?: number; minLength?: number };
}

export interface ServerTableSort {
  field: string;
  direction: "asc" | "desc";
  nulls?: "first" | "last";
}

const SortClauseSchema = z.strictObject({
  field: z.string().min(1).max(100),
  direction: ServerTableSortDirectionSchema,
  nulls: ServerTableNullPlacementSchema.optional(),
});

const FilterClauseSchema = z.strictObject({
  field: z.string().min(1).max(100),
  operator: ServerTableFilterOperatorSchema,
  value: z.unknown().optional(),
});

export function createServerTableQuerySchema(policy: ServerTableQueryPolicy) {
  validatePolicy(policy);
  const sortFields = new Set(policy.sortFields);
  const maxLimit = policy.maxLimit ?? 200;
  const maxSorts = policy.maxSorts ?? 3;
  const maxFilters = policy.maxFilters ?? 20;
  const searchMaxLength = policy.search?.maxLength ?? 300;
  const searchMinLength = policy.search?.minLength ?? 1;

  return z
    .strictObject({
      cursor: z.string().min(1).max(2_000).optional(),
      limit: z
        .number()
        .int()
        .min(1)
        .max(maxLimit)
        .default(Math.min(50, maxLimit)),
      search:
        policy.search === undefined
          ? z.never().optional()
          : z
              .string()
              .trim()
              .min(searchMinLength)
              .max(searchMaxLength)
              .optional(),
      sort: z
        .array(SortClauseSchema)
        .max(maxSorts)
        .default([...policy.defaultSort]),
      filters: z.array(FilterClauseSchema).max(maxFilters).default([]),
    })
    .superRefine((request, context) => {
      for (const [index, sort] of request.sort.entries()) {
        if (!sortFields.has(sort.field)) {
          context.addIssue({
            code: "custom",
            message: "Sort field is not allowed.",
            path: ["sort", index, "field"],
          });
        }
      }
      for (const [index, filter] of request.filters.entries()) {
        const operators = policy.filters[filter.field];
        if (operators === undefined) {
          context.addIssue({
            code: "custom",
            message: "Filter field is not allowed.",
            path: ["filters", index, "field"],
          });
          continue;
        }
        if (!(filter.operator in operators)) {
          context.addIssue({
            code: "custom",
            message: "Filter operator is not allowed for this field.",
            path: ["filters", index, "operator"],
          });
          continue;
        }
        const valueSchema = operators[filter.operator];
        if (valueSchema === null) {
          if (filter.value !== undefined) {
            context.addIssue({
              code: "custom",
              message: "This filter operator does not accept a value.",
              path: ["filters", index, "value"],
            });
          }
          continue;
        }
        if (valueSchema === undefined) continue;
        const result = valueSchema.safeParse(filter.value);
        if (!result.success) {
          context.addIssue({
            code: "custom",
            message: "Filter value is invalid for this field and operator.",
            path: ["filters", index, "value"],
          });
        }
      }
    });
}

export function createServerTablePageSchema<Item extends z.ZodType>(
  item: Item,
) {
  return z.strictObject({
    data: z.strictObject({
      items: z.array(item),
      page: z.strictObject({
        nextCursor: z.string().min(1).max(2_000).nullable(),
        previousCursor: z.string().min(1).max(2_000).nullable(),
        limit: z.number().int().positive(),
        estimatedTotal: z.number().int().nonnegative().optional(),
      }),
      applied: z.strictObject({
        sort: z.array(SortClauseSchema),
        filters: z.array(FilterClauseSchema),
      }),
    }),
  });
}

function validatePolicy(policy: ServerTableQueryPolicy): void {
  const sortFields = new Set(policy.sortFields);
  if (
    sortFields.size !== policy.sortFields.length ||
    policy.sortFields.some((field) => !validField(field)) ||
    Object.keys(policy.filters).some((field) => !validField(field)) ||
    policy.defaultSort.length < 1 ||
    policy.defaultSort.some((sort) => !sortFields.has(sort.field)) ||
    !validBound(policy.maxLimit, 1_000) ||
    !validBound(policy.maxSorts, 10) ||
    !validBound(policy.maxFilters, 100) ||
    (policy.search !== undefined &&
      (!validBound(policy.search.minLength, 2_000) ||
        !validBound(policy.search.maxLength, 2_000) ||
        (policy.search.minLength ?? 1) > (policy.search.maxLength ?? 300)))
  ) {
    throw new TypeError("Invalid server table query policy.");
  }
  for (const operators of Object.values(policy.filters)) {
    const names = Object.keys(operators);
    if (
      names.length < 1 ||
      names.some(
        (operator) =>
          !ServerTableFilterOperatorSchema.safeParse(operator).success,
      )
    ) {
      throw new TypeError("Invalid server table filter policy.");
    }
  }
}

function validField(value: string): boolean {
  return /^[a-z][A-Za-z0-9]*$/u.test(value) && value.length <= 100;
}

function validBound(value: number | undefined, maximum: number): boolean {
  return (
    value === undefined ||
    (Number.isSafeInteger(value) && value > 0 && value <= maximum)
  );
}
