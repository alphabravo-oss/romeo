import { Checkbox, Input, NativeSelect } from "@romeo/ui";

import type { AuditRouteState } from "../lib/audit-route-state";
import { useLocale } from "../lib/i18n";
import { categoryMessageKey } from "./audit-table-display";
import { AUDIT_CATEGORIES, type AuditCategory } from "./audit-table-query";
import type { RangePreset } from "./date-range";
import { DateRangeSelect } from "./DateRangeSelect";

export function AuditTableFilters({
  category,
  includeNoise,
  onCategoryChange,
  onIncludeNoiseChange,
  onOutcomeChange,
  onRangeChange,
  onSearchChange,
  outcome,
  range,
  search,
  searchTooShort,
}: {
  category: AuditCategory | "";
  includeNoise: boolean;
  onCategoryChange: (value: AuditCategory | "") => void;
  onIncludeNoiseChange: (value: boolean) => void;
  onOutcomeChange: (value: AuditRouteState["outcome"]) => void;
  onRangeChange: (value: RangePreset) => void;
  onSearchChange: (value: string) => void;
  outcome: AuditRouteState["outcome"];
  range: RangePreset;
  search: string;
  searchTooShort: boolean;
}) {
  const { t } = useLocale();
  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <DateRangeSelect onChange={onRangeChange} value={range} />
      <Input
        aria-describedby={searchTooShort ? "audit-search-guidance" : undefined}
        aria-invalid={searchTooShort}
        aria-label={t("auditFilterAction")}
        onChange={(event) => onSearchChange(event.currentTarget.value)}
        placeholder={t("auditSearch")}
        style={{ width: 280 }}
        value={search}
      />
      {searchTooShort ? (
        <span
          className="self-center text-sm text-muted"
          id="audit-search-guidance"
          role="status"
        >
          {t("auditSearchMinLength")}
        </span>
      ) : null}
      <NativeSelect
        aria-label={t("auditCategory")}
        onChange={(event) =>
          onCategoryChange(event.currentTarget.value as AuditCategory | "")
        }
        style={{ width: 180 }}
        value={category}
      >
        <option value="">{t("auditCategoryAll")}</option>
        {AUDIT_CATEGORIES.map((value) => (
          <option key={value} value={value}>
            {t(categoryMessageKey(value))}
          </option>
        ))}
      </NativeSelect>
      <NativeSelect
        aria-label={t("auditOutcome")}
        onChange={(event) =>
          onOutcomeChange(
            event.currentTarget.value as AuditRouteState["outcome"],
          )
        }
        style={{ width: 180 }}
        value={outcome}
      >
        <option value="">{t("auditAnyOutcome")}</option>
        <option value="success">{t("auditSuccess")}</option>
        <option value="failure">{t("auditFailure")}</option>
      </NativeSelect>
      <Checkbox
        checked={includeNoise}
        label={t("auditIncludeBackground")}
        onCheckedChange={(checked) => onIncludeNoiseChange(checked === true)}
      />
    </div>
  );
}
