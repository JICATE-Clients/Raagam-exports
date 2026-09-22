"use client";

import { type ReactNode } from "react";
import { PaginationBar } from "@/components/ui/pagination";
import { usePagination } from "@/lib/use-pagination";

/**
 * The stateful half of `DataTable`: holds the current page and shows only that
 * page's rows, under both layouts, with a `PaginationBar` beneath.
 *
 * WHY THE ROWS ARRIVE ALREADY RENDERED. `DataTable` is called from 58 server
 * pages (finance, planning, purchase, stores, …) with `cell` FUNCTIONS in its
 * `columns`, and a function cannot cross the server→client boundary — so the
 * table itself can never carry `"use client"`. A React ELEMENT can cross it.
 * `DataTable` therefore stays server-safe, renders every `<tr>` and every
 * stacked card exactly as it always did, and hands the finished elements here
 * to be sliced. From a client screen this is just one more component in the
 * tree; from a server page the rows ride the RSC payload and the slice happens
 * after hydration. Either way no call site changes.
 *
 * `rows[i]` and `cards[i]` are the SAME record in two layouts, so one page
 * index slices both — the stacked cards below `md` show the same page as the
 * table above it.
 *
 * The bar renders only past one page. A listing that fits shows nothing new —
 * the same rule `ChildGrid` applies to its own pager ("1–1 of 1" is a line of
 * chrome explaining that the one visible row is the one visible row, client
 * 2026-08-04) — so a small table inside a sheet or a card is pixel-identical to
 * before pagination existed. The page size is the app-wide one
 * (`lib/page-size.ts`); the operator changes it from the bar of any list that
 * shows one, or from the topbar "T" menu.
 */
export function DataTableFrame({
  paginate,
  wrapperClassName,
  tableClassName,
  head,
  rows,
  cards,
  emptyRow,
  emptyCard,
}: {
  paginate: boolean;
  wrapperClassName: string;
  tableClassName: string;
  head: ReactNode;
  rows: ReactNode[];
  cards: ReactNode[];
  emptyRow: ReactNode;
  emptyCard: ReactNode;
}) {
  /* Always called — hooks above every branch. When not paginating the slice
     is simply the whole array. */
  const pg = usePagination(rows);
  const paging = paginate && pg.pageCount > 1;
  const start = paging ? (pg.page - 1) * pg.pageSize : 0;
  const end = paging ? start + pg.pageSize : rows.length;
  const visibleRows = paging ? rows.slice(start, end) : rows;
  const visibleCards = paging ? cards.slice(start, end) : cards;

  return (
    <>
      <div className={wrapperClassName}>
        <table className={tableClassName}>
          {head}
          <tbody>{rows.length === 0 ? emptyRow : visibleRows}</tbody>
        </table>
        <div className="md:hidden">{cards.length === 0 ? emptyCard : visibleCards}</div>
      </div>
      {paging && (
        <div className="mt-2">
          <PaginationBar
            page={pg.page}
            pageCount={pg.pageCount}
            total={pg.total}
            pageSize={pg.pageSize}
            onPageChange={pg.setPage}
            onPageSizeChange={pg.setPageSize}
          />
        </div>
      )}
    </>
  );
}
