"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { setQuoteStatus } from "@/lib/sales/actions";
import {
  QUOTE_STATUSES,
  QUOTE_STATUS_LABELS,
  quoteStatusTone,
  type QuoteStatus,
} from "@/lib/sales/types";
import type { QuoteConfirmRow } from "@/lib/sales/service";
import { useToast } from "@/components/ui/toast";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { DataTable, type Column } from "@/components/ui/data-table";
import { FilterBar } from "@/components/masters/filter-bar";
import { fmtDate, fmtNumber } from "@/lib/format";

interface Props {
  rows: QuoteConfirmRow[];
  canEdit: boolean;
}

export function QuoteConfirmationsClient({ rows, canEdit }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [query, setQuery] = useState("");
  const [fStatus, setFStatus] = useState("");
  const [fCurrency, setFCurrency] = useState("");

  const currencies = useMemo(
    () =>
      Array.from(
        new Set(rows.map((r) => r.currency_code).filter((c): c is string => !!c)),
      ).sort(),
    [rows],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (fStatus && r.status !== fStatus) return false;
      if (fCurrency && r.currency_code !== fCurrency) return false;
      if (q) {
        const hay = `${r.code ?? ""} ${r.buyer_name ?? ""} ${r.style_code ?? ""}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, query, fStatus, fCurrency]);

  function resetFilters() {
    setFStatus("");
    setFCurrency("");
  }

  function changeStatus(row: QuoteConfirmRow, next: QuoteStatus) {
    if (next === row.status) return;
    if (
      (next === "accepted" || next === "rejected") &&
      !confirm(
        `Mark quote ${row.code ?? ""} as ${QUOTE_STATUS_LABELS[next]}?` +
          (next === "accepted" ? " This wins the opportunity." : ""),
      )
    ) {
      router.refresh(); // revert the Select to the stored value
      return;
    }
    startTransition(async () => {
      const res = await setQuoteStatus(row.id, next, row.opportunity_id);
      if (res.ok) {
        success(`Quote ${QUOTE_STATUS_LABELS[next]}`);
        router.refresh();
      } else {
        toastError(res.error);
        router.refresh();
      }
    });
  }

  const columns: Column<QuoteConfirmRow>[] = [
    {
      header: "Quote No",
      cell: (r) => (
        <Link
          href={`/sales/${r.opportunity_id}`}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {r.code ?? "—"}
        </Link>
      ),
    },
    {
      header: "Quote Dt",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {fmtDate(r.created_at)}
        </span>
      ),
    },
    { header: "Customer", cell: (r) => <span className="text-sm">{r.buyer_name ?? "—"}</span> },
    {
      header: "Style No",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">{r.style_code ?? "—"}</span>
      ),
    },
    {
      header: "Costing",
      cell: (r) => (
        <span className="text-sm text-muted-foreground">
          {r.cost_version != null ? `v${r.cost_version}` : "—"}
        </span>
      ),
    },
    { header: "Curr", cell: (r) => <span className="text-sm">{r.currency_code ?? "—"}</span> },
    {
      header: "Quote Rate",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.fob_price)}</span>,
    },
    {
      header: "Valid Until",
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {r.valid_until ? fmtDate(r.valid_until) : "—"}
        </span>
      ),
    },
    {
      header: "Approval Status",
      cell: (r) =>
        canEdit ? (
          <Select
            value={r.status}
            onChange={(e) => changeStatus(r, e.target.value as QuoteStatus)}
            disabled={isPending}
            className="h-8 w-32 text-xs"
            aria-label={`Approval status for ${r.code ?? "quote"}`}
          >
            {QUOTE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {QUOTE_STATUS_LABELS[s]}
              </option>
            ))}
          </Select>
        ) : (
          <StatusPill tone={quoteStatusTone(r.status)}>
            {QUOTE_STATUS_LABELS[r.status]}
          </StatusPill>
        ),
    },
  ];

  return (
    <div className="space-y-4">
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search quote no, customer or style…"
        activeCount={[fStatus, fCurrency].filter(Boolean).length}
        onReset={resetFilters}
        right={
          <>
            {filtered.length} of {rows.length}
          </>
        }
      >
        <Select
          value={fStatus}
          onChange={(e) => setFStatus(e.target.value)}
          aria-label="Filter status"
          className="h-9 text-base md:text-sm"
        >
          <option value="">All status</option>
          {QUOTE_STATUSES.map((s) => (
            <option key={s} value={s}>
              {QUOTE_STATUS_LABELS[s]}
            </option>
          ))}
        </Select>
        <Select
          value={fCurrency}
          onChange={(e) => setFCurrency(e.target.value)}
          aria-label="Filter currency"
          className="h-9 text-base md:text-sm"
        >
          <option value="">All currencies</option>
          {currencies.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </Select>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        getKey={(r) => r.id}
        empty="No quotes match. Prepare a quote on an opportunity first."
      />
    </div>
  );
}
