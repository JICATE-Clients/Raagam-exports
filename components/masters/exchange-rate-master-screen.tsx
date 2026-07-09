"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import {
  createExchangeRateEntry,
  updateExchangeRateEntry,
  deleteExchangeRateEntry,
} from "@/lib/masters/exchange-rate-actions";
import {
  MONTHS,
  REGISTER_META,
  type ExchangeRateEntry,
  type ExchangeRateInput,
  type ExchangeRateRegister,
} from "@/lib/masters/exchange-rate-types";
import type { Currency } from "@/lib/masters/types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
type LineRow = { key: string; currency_code: string; ex_rate: string };

const todayISO = () => new Date().toISOString().slice(0, 10);
const thisMonth = () => new Date().getMonth() + 1;
const thisYear = () => new Date().getFullYear();

/** "July 2026" for a month/year entry, else the effective-from date, else "—". */
function periodLabel(r: ExchangeRateEntry): string {
  if (r.rate_month && r.rate_year) return `${MONTHS[r.rate_month - 1]} ${r.rate_year}`;
  return r.effective_from ?? "—";
}

/**
 * Exchange-rate register master (Currencies). Master-detail: header (auto Entry
 * No · Date · For · Effective From) + a grid of Currency → Ex-Rate. One screen
 * serves all three registers (Quotes/Orders · Customs · Imports) — `register`
 * picks the label, the "For" options, and the rate-column header.
 */
export function ExchangeRateMasterScreen({
  rows,
  register,
  currencies,
  perms,
}: {
  rows: ExchangeRateEntry[];
  register: ExchangeRateRegister;
  currencies: Currency[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const meta = REGISTER_META[register];
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEntryNo, setEditEntryNo] = useState<number | null>(null);
  const [entryDate, setEntryDate] = useState(todayISO());
  const [rateFor, setRateFor] = useState<string>(meta.forOptions[0] ?? "");
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [rateMonth, setRateMonth] = useState<number>(thisMonth());
  const [rateYear, setRateYear] = useState<string>(String(thisYear()));
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const currencyName = useMemo(() => {
    const m = new Map<string, string>();
    for (const c of currencies) m.set(c.code, c.name);
    return m;
  }, [currencies]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [String(r.entry_no), r.entry_date, r.rate_for, r.effective_from]
        .filter(Boolean)
        .join(" ")
        .toLowerCase()
        .includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setEditEntryNo(null);
    setEntryDate(todayISO());
    setRateFor(meta.forOptions[0] ?? "");
    setEffectiveFrom(todayISO());
    setRateMonth(thisMonth());
    setRateYear(String(thisYear()));
    setLines([{ key: newKey(), currency_code: "", ex_rate: "0" }]);
    setOpen(true);
  }
  function openEdit(r: ExchangeRateEntry) {
    setEditId(r.id);
    setEditEntryNo(r.entry_no);
    setEntryDate(r.entry_date);
    setRateFor(r.rate_for ?? meta.forOptions[0] ?? "");
    setEffectiveFrom(r.effective_from ?? todayISO());
    setRateMonth(r.rate_month ?? thisMonth());
    setRateYear(String(r.rate_year ?? thisYear()));
    setLines(
      r.lines.length
        ? r.lines.map((l) => ({
            key: newKey(),
            currency_code: l.currency_code,
            ex_rate: String(l.ex_rate),
          }))
        : [{ key: newKey(), currency_code: "", ex_rate: "0" }],
    );
    setOpen(true);
  }

  function addLine() {
    setLines((ls) => [...ls, { key: newKey(), currency_code: "", ex_rate: "0" }]);
  }
  function setLineCurrency(key: string, currency_code: string) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, currency_code } : l)));
  }
  function setLineRate(key: string, ex_rate: string) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ex_rate } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  function submit() {
    startTransition(async () => {
      const monthYear = meta.period === "month_year";
      const payload: ExchangeRateInput = {
        register,
        entry_date: entryDate,
        rate_for: rateFor || null,
        effective_from: monthYear ? null : effectiveFrom || null,
        rate_month: monthYear ? rateMonth : null,
        rate_year: monthYear ? Number(rateYear) || null : null,
        lines: lines
          .filter((l) => l.currency_code)
          .map((l, i) => ({
            sno: i + 1,
            currency_code: l.currency_code,
            ex_rate: Number(l.ex_rate) || 0,
          })),
      };
      const res = editId
        ? await updateExchangeRateEntry(editId, payload)
        : await createExchangeRateEntry(payload);
      if (res.ok) {
        success(editId ? "Exchange rate updated." : "Exchange rate added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: ExchangeRateEntry) {
    startTransition(async () => {
      const res = await deleteExchangeRateEntry(r.id);
      if (res.ok) {
        success("Exchange rate deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<ExchangeRateEntry>[] = [
    { header: "Entry", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Date", cell: (r) => <span className="text-sm">{r.entry_date}</span> },
    { header: "For", cell: (r) => <span className="text-sm">{r.rate_for ?? "—"}</span> },
    {
      header: "Period",
      cell: (r) => <span className="text-sm text-muted-foreground">{periodLabel(r)}</span>,
    },
    {
      header: "Currencies",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.lines.length}</span>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && (
            <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
          {perms.canDelete && (
            <Button
              variant="ghost"
              size="sm"
              className="text-muted-foreground hover:text-danger"
              disabled={isPending}
              onClick={() => remove(r)}
            >
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search entry…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Entry
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={columns} rows={filtered} getKey={(r) => r.id} empty="No exchange-rate entries yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No exchange-rate entries yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="text-[15px] font-semibold text-foreground">
                    Entry #{r.entry_no} · {r.rate_for ?? "—"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    {r.entry_date} · {periodLabel(r)} · {r.lines.length} currencies
                  </div>
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editEntryNo ? `Edit Entry #${editEntryNo}` : "New Exchange-rate Entry"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={
                isPending ||
                !entryDate ||
                (meta.period === "effective_from" ? !effectiveFrom : !rateMonth || !rateYear)
              }
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="xr-entry">Entry No</Label>
              <Input id="xr-entry" value={editEntryNo ?? "(auto)"} disabled className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="xr-date">Date</Label>
              <Input
                id="xr-date"
                type="date"
                value={entryDate}
                onChange={(e) => setEntryDate(e.target.value)}
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="xr-for">For</Label>
              <Select
                id="xr-for"
                value={rateFor}
                onChange={(e) => setRateFor(e.target.value)}
                className="text-base md:text-sm"
              >
                {meta.forOptions.map((o) => (
                  <option key={o} value={o}>
                    {o}
                  </option>
                ))}
              </Select>
            </div>
            {meta.period === "effective_from" ? (
              <div>
                <Label htmlFor="xr-eff">Effective From</Label>
                <Input
                  id="xr-eff"
                  type="date"
                  value={effectiveFrom}
                  onChange={(e) => setEffectiveFrom(e.target.value)}
                  className="text-base md:text-sm"
                />
              </div>
            ) : (
              <>
                <div>
                  <Label htmlFor="xr-month">Month</Label>
                  <Select
                    id="xr-month"
                    value={String(rateMonth)}
                    onChange={(e) => setRateMonth(Number(e.target.value))}
                    className="text-base md:text-sm"
                  >
                    {MONTHS.map((m, i) => (
                      <option key={m} value={i + 1}>
                        {m}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="xr-year">Year</Label>
                  <Input
                    id="xr-year"
                    type="number"
                    value={rateYear}
                    onChange={(e) => setRateYear(e.target.value)}
                    className="text-base md:text-sm"
                  />
                </div>
              </>
            )}
          </div>

          {/* Exchange Rates grid */}
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">
              Exchange Rates
            </div>
            <div className="space-y-3 p-3">
              {lines.length === 0 && (
                <p className="text-xs text-muted-foreground">No currencies yet.</p>
              )}
              {lines.map((l, i) => (
                <div key={l.key} className="space-y-2 rounded-md border border-border p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">
                      S No {i + 1}
                      {l.currency_code && currencyName.get(l.currency_code)
                        ? ` · ${currencyName.get(l.currency_code)}`
                        : ""}
                    </span>
                    <Button
                      type="button"
                      variant="ghost"
                      size="sm"
                      className="text-muted-foreground hover:text-danger"
                      onClick={() => removeLine(l.key)}
                      aria-label="Remove row"
                    >
                      ✕
                    </Button>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label>Currency</Label>
                      <CurrencyPicker
                        label="Currency"
                        currencies={currencies}
                        value={l.currency_code || null}
                        onChange={(code) => setLineCurrency(l.key, code)}
                        canCreate={perms.canCreate}
                        canEdit={perms.canEdit}
                        compact
                      />
                    </div>
                    <div>
                      <Label>{meta.rateLabel}</Label>
                      <Input
                        type="number"
                        step="0.0001"
                        min="0"
                        value={l.ex_rate}
                        onChange={(e) => setLineRate(l.key, e.target.value)}
                        className="text-base md:text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                + Add currency
              </Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
