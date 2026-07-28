import { useLocale, type Locale } from "./i18n";

type DateValue = Date | number | string;

export function formatDateTime(value: DateValue, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(toDate(value));
}

export function formatDate(value: DateValue, locale: Locale): string {
  return new Intl.DateTimeFormat(locale, { dateStyle: "medium" }).format(
    toDate(value),
  );
}

export function formatNumber(
  value: number,
  locale: Locale,
  options?: Intl.NumberFormatOptions,
): string {
  return new Intl.NumberFormat(locale, options).format(value);
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

export function formatBytes(value: number, locale: Locale): string {
  const safe = Math.max(0, value);
  if (safe < 1_000) return `${formatNumber(safe, locale)} B`;
  const units = ["kB", "MB", "GB", "TB"];
  let amount = safe / 1_000;
  let unit = units[0]!;
  for (let index = 1; amount >= 1_000 && index < units.length; index += 1) {
    amount /= 1_000;
    unit = units[index]!;
  }
  return `${formatNumber(amount, locale, { maximumFractionDigits: amount < 10 ? 1 : 0 })} ${unit}`;
}

export function formatTokens(value: number, locale: Locale): string {
  return `${formatNumber(value, locale)} ${locale === "fr" ? "jetons" : locale === "es" ? "tokens" : "tokens"}`;
}

export function LocalizedDateTime({ value }: { value: DateValue }) {
  const { locale } = useLocale();
  return (
    <time dateTime={toDate(value).toISOString()} suppressHydrationWarning>
      {formatDateTime(value, locale)}
    </time>
  );
}

export function LocalizedDate({ value }: { value: DateValue }) {
  const { locale } = useLocale();
  return (
    <time dateTime={toDate(value).toISOString()} suppressHydrationWarning>
      {formatDate(value, locale)}
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
  const { locale } = useLocale();
  return formatTokens(value, locale);
}

export function LocalizedDuration({ milliseconds }: { milliseconds: number }) {
  const { locale } = useLocale();
  return milliseconds < 1_000
    ? `${formatNumber(Math.round(milliseconds), locale)} ms`
    : `${formatNumber(milliseconds / 1_000, locale, { maximumFractionDigits: 1 })} s`;
}

function toDate(value: DateValue): Date {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) throw new RangeError("Invalid date value");
  return date;
}
