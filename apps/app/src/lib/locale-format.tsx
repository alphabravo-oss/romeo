import { useLocale, type Locale } from "./i18n";

export type DateValue = Date | number | string;

const FORMATTER_CACHE_LIMIT = 32;
const dateFormatters = new Map<string, Intl.DateTimeFormat>();
const numberFormatters = new Map<string, Intl.NumberFormat>();

export interface DateDisplayOptions {
  reportInvalid?: (details: { traceId?: string; value: DateValue }) => void;
  timeZone?: string;
  traceId?: string;
  unknownLabel?: string;
}

function cacheKey(
  locale: Locale,
  options: Intl.DateTimeFormatOptions | Intl.NumberFormatOptions,
): string {
  return `${locale}:${JSON.stringify(
    Object.entries(options).sort(([left], [right]) =>
      left.localeCompare(right),
    ),
  )}`;
}

function cachedFormatter<T>(
  cache: Map<string, T>,
  key: string,
  create: () => T,
): T {
  const existing = cache.get(key);
  if (existing !== undefined) {
    cache.delete(key);
    cache.set(key, existing);
    return existing;
  }
  const formatter = create();
  cache.set(key, formatter);
  if (cache.size > FORMATTER_CACHE_LIMIT) {
    const oldest = cache.keys().next().value as string | undefined;
    if (oldest !== undefined) cache.delete(oldest);
  }
  return formatter;
}

function dateFormatter(
  locale: Locale,
  options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
  const key = cacheKey(locale, options);
  return cachedFormatter(
    dateFormatters,
    key,
    () => new Intl.DateTimeFormat(locale, options),
  );
}

function numberFormatter(
  locale: Locale,
  options: Intl.NumberFormatOptions,
): Intl.NumberFormat {
  const key = cacheKey(locale, options);
  return cachedFormatter(
    numberFormatters,
    key,
    () => new Intl.NumberFormat(locale, options),
  );
}

function validDate(value: DateValue): Date | undefined {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function invalidDateLabel(
  value: DateValue,
  options: DateDisplayOptions,
): string {
  options.reportInvalid?.({
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
    value,
  });
  return options.unknownLabel ?? "—";
}

export function formatDateTime(
  value: DateValue,
  locale: Locale,
  options: DateDisplayOptions = {},
): string {
  const date = validDate(value);
  if (date === undefined) return invalidDateLabel(value, options);
  return dateFormatter(locale, {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: options.timeZone ?? "UTC",
  }).format(date);
}

export function formatDate(
  value: DateValue,
  locale: Locale,
  options: DateDisplayOptions = {},
): string {
  const date = validDate(value);
  if (date === undefined) return invalidDateLabel(value, options);
  return dateFormatter(locale, {
    dateStyle: "medium",
    timeZone: options.timeZone ?? "UTC",
  }).format(date);
}

export function formatNumber(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return numberFormatter(locale, options).format(value);
}

export function formatCompactNumber(value: number, locale: Locale): string {
  return formatNumber(value, locale, {
    maximumFractionDigits: 1,
    notation: "compact",
  });
}

export function formatCurrency(
  value: number,
  locale: Locale,
  currency = "USD",
): string {
  return formatNumber(value, locale, {
    currency,
    currencyDisplay: "narrowSymbol",
    maximumFractionDigits: 6,
    style: "currency",
  });
}

export function formatPercent(
  value: number,
  locale: Locale,
  options: Intl.NumberFormatOptions = {},
): string {
  return formatNumber(value, locale, {
    maximumFractionDigits: 1,
    ...options,
    style: "percent",
  });
}

export function formatUnit(
  value: number,
  locale: Locale,
  unit: Intl.NumberFormatOptions["unit"],
  options: Intl.NumberFormatOptions = {},
): string {
  return formatNumber(value, locale, {
    ...options,
    style: "unit",
    unit,
    unitDisplay: options.unitDisplay ?? "short",
  });
}

export function formatBytes(value: number, locale: Locale): string {
  const safe = Math.max(0, value);
  if (safe < 1_000) return formatUnit(safe, locale, "byte");
  const units = ["kilobyte", "megabyte", "gigabyte", "terabyte"] as const;
  let amount = safe / 1_000;
  let unit: (typeof units)[number] = units[0];
  for (let index = 1; amount >= 1_000 && index < units.length; index += 1) {
    amount /= 1_000;
    unit = units[index]!;
  }
  return formatUnit(amount, locale, unit, {
    maximumFractionDigits: amount < 10 ? 1 : 0,
  });
}

export function formatTokens(value: number, locale: Locale): string {
  const label =
    value === 1
      ? { en: "token", es: "token", fr: "jeton" }[locale]
      : { en: "tokens", es: "tokens", fr: "jetons" }[locale];
  return `${formatNumber(value, locale)} ${label}`;
}

export function LocalizedDateTime({
  reportInvalid,
  timeZone,
  traceId,
  unknownLabel,
  value,
}: DateDisplayOptions & { value: DateValue }) {
  const { locale, t } = useLocale();
  const date = validDate(value);
  const fallback = unknownLabel ?? t("unknownDate");
  const options = dateDisplayOptions({
    reportInvalid,
    timeZone,
    traceId,
    unknownLabel: fallback,
  });
  if (date === undefined) {
    formatDateTime(value, locale, options);
    return <span>{fallback}</span>;
  }
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {formatDateTime(value, locale, options)}
    </time>
  );
}

export function LocalizedDate({
  reportInvalid,
  timeZone,
  traceId,
  unknownLabel,
  value,
}: DateDisplayOptions & { value: DateValue }) {
  const { locale, t } = useLocale();
  const date = validDate(value);
  const fallback = unknownLabel ?? t("unknownDate");
  const options = dateDisplayOptions({
    reportInvalid,
    timeZone,
    traceId,
    unknownLabel: fallback,
  });
  if (date === undefined) {
    formatDate(value, locale, options);
    return <span>{fallback}</span>;
  }
  return (
    <time dateTime={date.toISOString()} suppressHydrationWarning>
      {formatDate(value, locale, options)}
    </time>
  );
}

export function LocalizedNumber({
  options,
  value,
}: {
  options?: Intl.NumberFormatOptions;
  value: number;
}) {
  const { locale } = useLocale();
  return formatNumber(value, locale, options);
}

export function LocalizedCurrency({
  currency,
  value,
}: {
  currency?: string;
  value: number;
}) {
  const { locale } = useLocale();
  return formatCurrency(value, locale, currency);
}

export function LocalizedBytes({ value }: { value: number }) {
  const { locale } = useLocale();
  return formatBytes(value, locale);
}

export function LocalizedTokens({ value }: { value: number }) {
  const { locale, t } = useLocale();
  return t("tokenCount", {
    count: value,
    formatted: formatNumber(value, locale),
  });
}

export function LocalizedDuration({ milliseconds }: { milliseconds: number }) {
  const { locale } = useLocale();
  return milliseconds < 1_000
    ? formatUnit(Math.round(milliseconds), locale, "millisecond")
    : formatUnit(milliseconds / 1_000, locale, "second", {
        maximumFractionDigits: 1,
      });
}

export function formatterCacheStats(): {
  date: number;
  limit: number;
  number: number;
} {
  return {
    date: dateFormatters.size,
    limit: FORMATTER_CACHE_LIMIT,
    number: numberFormatters.size,
  };
}

export function resetFormatterCaches(): void {
  dateFormatters.clear();
  numberFormatters.clear();
}

function dateDisplayOptions(options: {
  reportInvalid: DateDisplayOptions["reportInvalid"];
  timeZone: string | undefined;
  traceId: string | undefined;
  unknownLabel: string;
}): DateDisplayOptions {
  return {
    ...(options.reportInvalid === undefined
      ? {}
      : { reportInvalid: options.reportInvalid }),
    ...(options.timeZone === undefined ? {} : { timeZone: options.timeZone }),
    ...(options.traceId === undefined ? {} : { traceId: options.traceId }),
    unknownLabel: options.unknownLabel,
  };
}
