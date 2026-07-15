import { Button } from "@/components/ui/button";
import { Select } from "@/components/ui/select";

const DEFAULT_PAGE_SIZE_OPTIONS = [10, 30, 50, 100];

/**
 * Prev/Next control for `usePagination`, plus a rows-per-page picker.
 * Renders nothing when there's nothing to paginate (empty list) — the
 * `DataTable`/mobile card block already shows its own empty state. Still
 * shows the rows-per-page picker even when everything fits on one page, so
 * switching to a smaller page size is always available.
 */
export function PaginationBar({
  page,
  pageCount,
  total,
  pageSize,
  onPageChange,
  onPageSizeChange,
  pageSizeOptions = DEFAULT_PAGE_SIZE_OPTIONS,
}: {
  page: number;
  pageCount: number;
  total: number;
  pageSize: number;
  onPageChange: (page: number) => void;
  onPageSizeChange?: (pageSize: number) => void;
  pageSizeOptions?: number[];
}) {
  if (total === 0) return null;

  const start = (page - 1) * pageSize + 1;
  const end = Math.min(page * pageSize, total);

  return (
    <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-sm text-muted-foreground">
      <div className="flex items-center gap-2">
        <span>
          {start}–{end} of {total}
        </span>
        {onPageSizeChange && (
          <label className="flex items-center gap-1.5">
            <span className="text-xs">Rows</span>
            <Select
              value={pageSize}
              onChange={(e) => onPageSizeChange(Number(e.target.value))}
              className="h-7 w-auto py-0 text-xs"
              aria-label="Rows per page"
            >
              {pageSizeOptions.map((size) => (
                <option key={size} value={size}>
                  {size}
                </option>
              ))}
            </Select>
          </label>
        )}
      </div>
      {pageCount > 1 && (
        <div className="flex items-center gap-1">
          <Button
            variant="outline"
            size="sm"
            disabled={page <= 1}
            onClick={() => onPageChange(page - 1)}
          >
            Prev
          </Button>
          <span className="px-2 text-xs">
            Page {page} of {pageCount}
          </span>
          <Button
            variant="outline"
            size="sm"
            disabled={page >= pageCount}
            onClick={() => onPageChange(page + 1)}
          >
            Next
          </Button>
        </div>
      )}
    </div>
  );
}
