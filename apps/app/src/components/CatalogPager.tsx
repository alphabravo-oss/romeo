import { Button } from "@romeo/ui";
import ChevronLeft from "lucide-react/dist/esm/icons/chevron-left.mjs";
import ChevronRight from "lucide-react/dist/esm/icons/chevron-right.mjs";
import { LocalizedNumber } from "../lib/locale-format";
import { useLocale } from "../lib/i18n";

export function CatalogPager({
  page,
  pageSize,
  total,
  onPageChange,
}: {
  page: number;
  pageSize: number;
  total: number;
  onPageChange: (page: number) => void;
}) {
  const { t } = useLocale();
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  if (pageCount <= 1) return null;
  const first = page * pageSize + 1;
  const last = Math.min((page + 1) * pageSize, total);
  return (
    <nav aria-label={t("catalogPages")} className="rm-table-pager">
      <span aria-live="polite" className="rm-table-pager-info">
        <LocalizedNumber value={first} />–<LocalizedNumber value={last} />{" "}
        {t("of")} <LocalizedNumber value={total} />
      </span>
      <div className="rm-table-pager-nav">
        <Button
          aria-label={t("previousPage")}
          className="rm-icon-button"
          disabled={page <= 0}
          onClick={() => onPageChange(page - 1)}
          type="button"
        >
          <ChevronLeft aria-hidden="true" size={16} />
        </Button>
        <Button
          aria-label={t("nextPage")}
          className="rm-icon-button"
          disabled={page >= pageCount - 1}
          onClick={() => onPageChange(page + 1)}
          type="button"
        >
          <ChevronRight aria-hidden="true" size={16} />
        </Button>
      </div>
    </nav>
  );
}
