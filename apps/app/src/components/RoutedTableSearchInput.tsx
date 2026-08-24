import { Input } from "@romeo/ui";
import { useEffect, useState } from "react";

import { useDebouncedValue } from "../lib/debounce";

interface RoutedTableSearchInputProps {
  ariaLabel: string;
  delayMs?: number;
  id: string;
  name: string;
  onCommit: (value: string) => void;
  placeholder: string;
  routeValue: string;
}

export function RoutedTableSearchInput({
  ariaLabel,
  delayMs = 250,
  id,
  name,
  onCommit,
  placeholder,
  routeValue,
}: RoutedTableSearchInputProps) {
  const [draft, setDraft] = useState(routeValue);
  const debouncedDraft = useDebouncedValue(draft, delayMs);

  useEffect(() => {
    if (debouncedDraft !== routeValue) onCommit(debouncedDraft);
  }, [debouncedDraft, onCommit, routeValue]);

  return (
    <Input
      aria-label={ariaLabel}
      id={id}
      name={name}
      onChange={(event) => setDraft(event.currentTarget.value)}
      placeholder={placeholder}
      value={draft}
    />
  );
}
