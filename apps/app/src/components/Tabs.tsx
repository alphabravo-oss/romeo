import { Tabs as PrimitiveTabs } from "@romeo/ui";
import { useLocale } from "../lib/i18n";

export interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

/** Compatibility adapter over the design-system tabs primitive. */
export function Tabs({
  tabs,
  initialId,
}: {
  tabs: TabItem[];
  initialId?: string;
}): React.ReactNode {
  const { t } = useLocale();
  const defaultValue = initialId ?? tabs[0]?.id;
  return (
    <PrimitiveTabs
      aria-label={t("sections")}
      className="rm-tabs"
      {...(defaultValue ? { defaultValue } : {})}
      tabs={tabs.map((tab) => ({
        content: tab.content,
        label: tab.label,
        value: tab.id,
      }))}
    />
  );
}
