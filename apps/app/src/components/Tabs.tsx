import { Tabs as PrimitiveTabs } from "@romeo/ui";
import { useLocale } from "../lib/i18n";

export interface TabItem {
  id: string;
  label: string;
  content: React.ReactNode;
}

export interface RoutedTabsState {
  activeId?: string | undefined;
  onActiveIdChange?: ((id: string) => void) | undefined;
  secondaryActiveId?: string | undefined;
  onSecondaryActiveIdChange?: ((id: string) => void) | undefined;
}

/** Compatibility adapter over the design-system tabs primitive. */
export function Tabs({
  tabs,
  initialId,
  activeId,
  onActiveIdChange,
}: {
  tabs: TabItem[];
  initialId?: string;
  activeId?: string | undefined;
  onActiveIdChange?: ((id: string) => void) | undefined;
}): React.ReactNode {
  const { t } = useLocale();
  const defaultValue = initialId ?? tabs[0]?.id;
  const controlledValue = tabs.some((tab) => tab.id === activeId)
    ? activeId
    : defaultValue;
  return (
    <PrimitiveTabs
      aria-label={t("sections")}
      className="rm-tabs"
      {...(onActiveIdChange === undefined
        ? defaultValue
          ? { defaultValue }
          : {}
        : {
            ...(controlledValue === undefined
              ? {}
              : { value: controlledValue }),
            onValueChange: onActiveIdChange,
          })}
      tabs={tabs.map((tab) => ({
        content: tab.content,
        label: tab.label,
        value: tab.id,
      }))}
    />
  );
}
