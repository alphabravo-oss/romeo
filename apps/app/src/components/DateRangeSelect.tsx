import { NativeSelect } from "@romeo/ui";

import { useLocale } from "../lib/i18n";
import { RANGE_PRESETS, type RangePreset } from "./date-range";

const LABEL_KEYS = {
  "24h": "rangeLast24Hours",
  "7d": "rangeLast7Days",
  "30d": "rangeLast30Days",
  "90d": "rangeLast90Days",
  all: "rangeAllTime",
} as const;

export function DateRangeSelect(props: {
  value: RangePreset;
  onChange: (value: RangePreset) => void;
}): React.ReactNode {
  const { t } = useLocale();
  return (
    <NativeSelect
      aria-label={t("rangeLabel")}
      name="dateRange"
      onChange={(event) =>
        props.onChange(event.currentTarget.value as RangePreset)
      }
      value={props.value}
    >
      {RANGE_PRESETS.map((preset) => (
        <option key={preset} value={preset}>
          {t(LABEL_KEYS[preset])}
        </option>
      ))}
    </NativeSelect>
  );
}
