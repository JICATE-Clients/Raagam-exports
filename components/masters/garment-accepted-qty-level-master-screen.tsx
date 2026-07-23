"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import {
  createGarmentAcceptedQtyLevel,
  updateGarmentAcceptedQtyLevel,
  deleteGarmentAcceptedQtyLevel,
} from "@/lib/masters/garment-accepted-qty-level-actions";
import type {
  GarmentAcceptedQtyLevel,
  GarmentAcceptedQtyLevelInput,
  RangeType,
} from "@/lib/masters/garment-accepted-qty-level-types";
import { RANGE_TYPES, RANGE_TYPE_LABELS } from "@/lib/masters/garment-accepted-qty-level-types";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const todayISO = () => new Date().toISOString().slice(0, 10);

type LineRow = {
  key: string;
  range_type: RangeType | "";
  from_qty: string;
  to_qty: string;
  no_of_pieces: string;
  major_allowed: string;
  minor_allowed: string;
  critical_allowed: string;
  allowed: string;
};

const blankLine = (key: string): LineRow => ({
  key,
  range_type: "",
  from_qty: "",
  to_qty: "",
  no_of_pieces: "",
  major_allowed: "",
  minor_allowed: "",
  critical_allowed: "",
  allowed: "",
});

/**
 * Garment Accepted Qty Level master — header + detail grid.
 * Header: code (auto), entry_date (<= today, required), effective_from (required).
 * Detail: range_type (U/B/A), from_qty, to_qty, no_of_pieces, major/minor/
 *         critical/allowed counts. At least one detail row required.
 */
export function GarmentAcceptedQtyLevelMasterScreen({
  rows,
  perms,
}: {
  rows: GarmentAcceptedQtyLevel[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [entryDate, setEntryDate] = useState(todayISO());
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [r.code, r.entry_date, r.effective_from].join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  const pg = usePagination(filtered, 10);

  function openAdd() {
    setEditId(null);
    setEditCode(null);
    setEntryDate(todayISO());
    setEffectiveFrom(todayISO());
    setLines([blankLine(newKey())]);
    setOpen(true);
  }

  function openEdit(r: GarmentAcceptedQtyLevel) {
    setEditId(r.id);
    setEditCode(r.code);
    setEntryDate(r.entry_date);
    setEffectiveFrom(r.effective_from);
    setLines(
      r.details
        .slice()
        .sort((a, b) => a.sno - b.sno)
        .map((d) => ({
          key: newKey(),
          range_type: (d.range_type ?? "") as RangeType | "",
          from_qty: d.from_qty != null ? String(d.from_qty) : "",
          to_qty: d.to_qty != null ? String(d.to_qty) : "",
          no_of_pieces: d.no_of_pieces != null ? String(d.no_of_pieces) : "",
          major_allowed: d.major_allowed != null ? String(d.major_allowed) : "",
          minor_allowed: d.minor_allowed != null ? String(d.minor_allowed) : "",
          critical_allowed: d.critical_allowed != null ? String(d.critical_allowed) : "",
          allowed: d.allowed != null ? String(d.allowed) : "",
        })),
    );
    setOpen(true);
  }

  function addLine() {
    setLines((ls) => [...ls, blankLine(newKey())]);
  }
  function setLineAt(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  const canSave =
    !isPending && !!entryDate && !!effectiveFrom && lines.length > 0;

  function submit() {
    startTransition(async () => {
      const payload: GarmentAcceptedQtyLevelInput = {
        entry_date: entryDate,
        effective_from: effectiveFrom,
        details: lines.map((l, i) => ({
          sno: i + 1,
          range_type: (l.range_type || null) as RangeType | null,
          from_qty: numOrNull(l.from_qty),
          to_qty: numOrNull(l.to_qty),
          no_of_pieces: numOrNull(l.no_of_pieces),
          major_allowed: numOrNull(l.major_allowed),
          minor_allowed: numOrNull(l.minor_allowed),
          critical_allowed: numOrNull(l.critical_allowed),
          allowed: numOrNull(l.allowed),
        })),
      };
      const res = editId
        ? await updateGarmentAcceptedQtyLevel(editId, payload)
        : await createGarmentAcceptedQtyLevel(payload);
      if (res.ok) {
        success(editId ? "Garment accepted qty level updated." : "Garment accepted qty level added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: GarmentAcceptedQtyLevel) {
    startTransition(async () => {
      const res = await deleteGarmentAcceptedQtyLevel(r.id);
      if (res.ok) {
        success("Garment accepted qty level deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<GarmentAcceptedQtyLevel>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    {
      header: "Entry Date",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.entry_date}</span>,
    },
    {
      header: "Effective From",
      cell: (r) => <span className="text-sm text-muted-foreground">{r.effective_from}</span>,
    },
    {
      header: "Rows",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.details.length}</span>,
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
            <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />
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
          onChange={(e) => {
            setQuery(e.target.value);
            pg.setPage(1);
          }}
          placeholder="Search accepted qty level..."
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Level
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable
          columns={columns}
          rows={pg.paged}
          getKey={(r) => r.id}
          empty="No garment accepted qty level records yet."
        />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No garment accepted qty level records yet.
          </div>
        ) : (
          pg.paged.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="min-w-0">
                <div className="truncate text-[15px] font-semibold text-foreground font-mono">
                  {r.code}
                </div>
                <div className="mt-0.5 text-xs text-muted-foreground">
                  Entry: {r.entry_date} · Effective: {r.effective_from} · {r.details.length} row
                  {r.details.length === 1 ? "" : "s"}
                </div>
              </div>
            </button>
          ))
        )}
      </div>

      <PaginationBar
        page={pg.page}
        pageCount={pg.pageCount}
        total={pg.total}
        pageSize={pg.pageSize}
        onPageChange={pg.setPage}
        onPageSizeChange={pg.setPageSize}
      />

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit Level ${editCode}` : "New Garment Accepted Qty Level"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="md" disabled={!canSave} onClick={submit}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="grid grid-cols-1 gap-x-4 gap-y-3 sm:grid-cols-2">
          {/* header fields */}
          <div className="grid grid-cols-2 gap-3 sm:col-span-2">
            <div>
              <Label htmlFor="gaql-code">Code</Label>
              <Input
                id="gaql-code"
                value={editCode ?? "(auto)"}
                disabled
                className="text-base md:text-sm"
              />
            </div>
            <div>
              <Label htmlFor="gaql-entry">
                Entry Date <span className="text-danger">*</span>
              </Label>
              <Input
                id="gaql-entry"
                type="date"
                value={entryDate}
                max={todayISO()}
                onChange={(e) => setEntryDate(e.target.value)}
                className="text-base md:text-sm"
              />
            </div>
          </div>
          <div>
            <Label htmlFor="gaql-eff">
              Effective From <span className="text-danger">*</span>
            </Label>
            <Input
              id="gaql-eff"
              type="date"
              value={effectiveFrom}
              onChange={(e) => setEffectiveFrom(e.target.value)}
              className="text-base md:text-sm"
            />
          </div>

          {/* detail grid */}
          <div className="rounded-lg border border-border sm:col-span-2">
            <div className="flex items-center justify-between border-b border-border px-3 py-2.5">
              <span className="text-sm font-medium text-foreground">
                Detail Rows{" "}
                {lines.length === 0 && (
                  <span className="text-danger text-xs">(at least 1 required)</span>
                )}
              </span>
            </div>
            <div className="space-y-3 p-3">
              {lines.length === 0 && (
                <p className="text-xs text-muted-foreground">No rows yet. Add at least one.</p>
              )}
              {lines.map((l, i) => (
                <div key={l.key} className="rounded-md border border-border p-2.5 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-medium text-muted-foreground">Row #{i + 1}</span>
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
                  {/* range type */}
                  <div>
                    <Label htmlFor={`gaql-rt-${l.key}`}>Range Type</Label>
                    <Select
                      id={`gaql-rt-${l.key}`}
                      value={l.range_type}
                      onChange={(e) =>
                        setLineAt(l.key, { range_type: e.target.value as RangeType | "" })
                      }
                      className="text-base md:text-sm"
                    >
                      <option value="">— select —</option>
                      {RANGE_TYPES.map((rt) => (
                        <option key={rt} value={rt}>
                          {rt} — {RANGE_TYPE_LABELS[rt]}
                        </option>
                      ))}
                    </Select>
                  </div>
                  {/* qty range */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor={`gaql-fq-${l.key}`}>From Qty</Label>
                      <Input
                        id={`gaql-fq-${l.key}`}
                        type="number"
                        min={0}
                        value={l.from_qty}
                        onChange={(e) => setLineAt(l.key, { from_qty: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`gaql-tq-${l.key}`}>To Qty</Label>
                      <Input
                        id={`gaql-tq-${l.key}`}
                        type="number"
                        min={0}
                        value={l.to_qty}
                        onChange={(e) => setLineAt(l.key, { to_qty: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                  </div>
                  {/* pieces + defect allowances */}
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <Label htmlFor={`gaql-np-${l.key}`}>No. of Pieces</Label>
                      <Input
                        id={`gaql-np-${l.key}`}
                        type="number"
                        min={0}
                        value={l.no_of_pieces}
                        onChange={(e) => setLineAt(l.key, { no_of_pieces: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`gaql-al-${l.key}`}>Allowed</Label>
                      <Input
                        id={`gaql-al-${l.key}`}
                        type="number"
                        min={0}
                        value={l.allowed}
                        onChange={(e) => setLineAt(l.key, { allowed: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-2">
                    <div>
                      <Label htmlFor={`gaql-maj-${l.key}`}>Major</Label>
                      <Input
                        id={`gaql-maj-${l.key}`}
                        type="number"
                        min={0}
                        value={l.major_allowed}
                        onChange={(e) => setLineAt(l.key, { major_allowed: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`gaql-min-${l.key}`}>Minor</Label>
                      <Input
                        id={`gaql-min-${l.key}`}
                        type="number"
                        min={0}
                        value={l.minor_allowed}
                        onChange={(e) => setLineAt(l.key, { minor_allowed: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                    <div>
                      <Label htmlFor={`gaql-crit-${l.key}`}>Critical</Label>
                      <Input
                        id={`gaql-crit-${l.key}`}
                        type="number"
                        min={0}
                        value={l.critical_allowed}
                        onChange={(e) => setLineAt(l.key, { critical_allowed: e.target.value })}
                        className="text-base md:text-sm"
                      />
                    </div>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                + Add Row
              </Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
