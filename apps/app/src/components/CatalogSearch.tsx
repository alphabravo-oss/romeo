import { Input } from "@romeo/ui";
import Search from "lucide-react/dist/esm/icons/search.mjs";
import { useId } from "react";

export function CatalogSearch(props: {
  label: string;
  onChange: (value: string) => void;
  value: string;
}) {
  const inputId = useId();
  return (
    <label className="rm-model-search" htmlFor={inputId}>
      <Search aria-hidden="true" size={15} />
      <Input
        aria-label={props.label}
        id={inputId}
        onChange={(event) => props.onChange(event.currentTarget.value)}
        placeholder={props.label}
        type="search"
        value={props.value}
      />
    </label>
  );
}

export function EmptyCatalog(props: {
  filtered: boolean;
  filteredLabel: string;
  label: string;
}) {
  return (
    <p className="text-sm text-muted">
      {props.filtered ? props.filteredLabel : props.label}
    </p>
  );
}
