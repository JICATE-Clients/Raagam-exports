"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import {
  createSizingRate,
  updateSizingRate,
  deleteSizingRate,
} from "@/lib/masters/grid-master-actions";
import { Select } from "@/components/ui/select";
import type { SizingRate, SizingRateInput } from "@/lib/masters/grid-master-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };
type LookupOption = { id: string; code: string; name: string };

const todayISO = () => new Date().toISOString().slice(0, 10);

type LineRow = { key: string; category_id: string | null; item_id: string | null; rate_ends_upto: string; rate_ends_more: string };
const blankLine = (key: string): LineRow => ({ key, category_id: null, item_id: null, rate_ends_upto: "", rate_ends_more: "" });

export function SizingRateMasterScreen({ rows, categories, items, perms }: { rows: SizingRate[]; categories: LookupOption[]; items: LookupOption[]; perms: Perms }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [entryType, setEntryType] = useState("N");
  const [baseRate, setBaseRate] = useState("");
  const [inactive, setInactive] = useState(false);
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const pg = usePagination(rows, 10);

  function openAdd() {
    setEditId(null);
    setEditCode(null);
    setEffectiveFrom(todayISO());
    setEntryType("N");
    setBaseRate("");
    setInactive(false);
    setLines([blankLine(newKey())]);
    setOpen(true);
  }
  function openEdit(r: SizingRate) {
    setEditId(r.id);
    setEditCode(r.code);
    setEffectiveFrom(r.effective_from);
    setEntryType(r.entry_type ?? "N");
    setBaseRate(r.base_rate != null ? String(r.base_rate) : "");
    setInactive(!r.is_active);
    setLines(r.details.slice().sort((a, b) => a.sno - b.sno).map((d) => ({
      key: newKey(),
      category_id: d.category_id,
      item_id: d.item_id,
      rate_ends_upto: d.rate_ends_upto != null ? String(d.rate_ends_upto) : "",
      rate_ends_more: d.rate_ends_more != null ? String(d.rate_ends_more) : "",
    })));
    setOpen(true);
  }

  function addLine() { setLines((ls) => [...ls, blankLine(newKey())]); }
  function setLineAt(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) { setLines((ls) => ls.filter((l) => l.key !== key)); }

  const numOrZero = (v: string) => (v.trim() === "" ? 0 : Number(v));

  function submit() {
    startTransition(async () => {
      const payload: SizingRateInput = {
        effective_from: effectiveFrom,
        entry_type: entryType,
        base_rate: numOrZero(baseRate),
        is_active: !inactive,
        details: lines.map((l, i) => ({
          sno: i + 1,
          category_id: l.category_id,
          item_id: l.item_id,
          rate_ends_upto: numOrZero(l.rate_ends_upto),
          rate_ends_more: numOrZero(l.rate_ends_more),
        })),
      };
      const res = editId ? await updateSizingRate(editId, payload) : await createSizingRate(payload);
      if (res.ok) {
        success(editId ? "Sizing rate updated." : "Sizing rate added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: SizingRate) {
    startTransition(async () => {
      const res = await deleteSizingRate(r.id);
      if (res.ok) {
        success("Sizing rate deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<SizingRate>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Effective From", cell: (r) => <span className="text-sm text-muted-foreground">{r.effective_from}</span> },
    { header: "Base Rate", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.base_rate}</span> },
    { header: "Yarns", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.details.length}</span> },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.is_active ? "success" : "danger"}>
          {r.is_active ? "Active" : "Inactive"}
        </StatusPill>
      ),
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {perms.canEdit && <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button>}
          {perms.canDelete && <DeleteConfirmButton isPending={isPending} onConfirm={() => remove(r)} />}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex-1" />
        {perms.canCreate && <Button size="md" onClick={openAdd}>+ Add Sizing Rate</Button>}
      </div>

      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No sizing rate records yet." />
      </div>
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">No sizing rate records yet.</div>
        ) : pg.paged.map((r) => (
          <button key={r.id} type="button" onClick={() => perms.canEdit && openEdit(r)}
            className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="font-mono text-[15px] font-semibold text-foreground">{r.code}</div>
                <div className="mt-0.5 text-xs text-muted-foreground">Effective: {r.effective_from} · Base: {r.base_rate}</div>
              </div>
              <StatusPill tone={r.is_active ? "success" : "danger"}>{r.is_active ? "Active" : "Inactive"}</StatusPill>
            </div>
          </button>
        ))}
      </div>

      <PaginationBar page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />

      <Sheet open={open} onClose={() => setOpen(false)}
        title={editId ? `Edit Sizing Rate ${editCode}` : "New Sizing Rate"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="md" disabled={isPending || !effectiveFrom || lines.length === 0} onClick={submit}>
              {isPending ? "Saving..." : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sr-code">Code</Label>
              <Input id="sr-code" value={editCode ?? "(auto)"} disabled className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="sr-eff">Effective From <span className="text-danger">*</span></Label>
              <Input id="sr-eff" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="text-base md:text-sm" />
            </div>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="sr-type">Entry Type</Label>
              <Input id="sr-type" value={entryType} onChange={(e) => setEntryType(e.target.value)} className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="sr-base">Base Rate</Label>
              <Input id="sr-base" type="number" min={0} step="0.01" value={baseRate} onChange={(e) => setBaseRate(e.target.value)} className="text-base md:text-sm" />
            </div>
          </div>
          <label className="flex cursor-pointer items-center gap-2">
            <input type="checkbox" className="h-4 w-4 cursor-pointer accent-primary" checked={inactive} onChange={(e) => setInactive(e.target.checked)} />
            <span className="text-sm text-foreground">Inactive</span>
          </label>

          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">Yarn Rates (by Ends)</div>
            <div className="space-y-2 p-3">
              {lines.map((l, i) => (
                <div key={l.key} className="space-y-2 rounded-lg border border-border/50 bg-surface-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-center text-xs font-medium text-muted-foreground">{i + 1}</span>
                    <Select value={l.category_id ?? ""}
                      onChange={(e) => setLineAt(l.key, { category_id: e.target.value || null })}
                      className="flex-1 text-base md:text-sm">
                      <option value="">— category —</option>
                      {categories.map((c) => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </Select>
                    <Select value={l.item_id ?? ""}
                      onChange={(e) => setLineAt(l.key, { item_id: e.target.value || null })}
                      className="flex-1 text-base md:text-sm">
                      <option value="">— yarn —</option>
                      {items.map((it) => (
                        <option key={it.id} value={it.id}>{it.code} — {it.name}</option>
                      ))}
                    </Select>
                    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger"
                      onClick={() => removeLine(l.key)} aria-label="Remove">✕</Button>
                  </div>
                  <div className="ml-8 grid grid-cols-2 gap-2">
                    <div>
                      <Label className="text-xs">Rate (Ends &le; 10K)</Label>
                      <Input type="number" value={l.rate_ends_upto} min={0} step="0.01"
                        onChange={(e) => setLineAt(l.key, { rate_ends_upto: e.target.value })}
                        className="text-base md:text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Rate (Ends &gt; 10K)</Label>
                      <Input type="number" value={l.rate_ends_more} min={0} step="0.01"
                        onChange={(e) => setLineAt(l.key, { rate_ends_more: e.target.value })}
                        className="text-base md:text-sm" />
                    </div>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>+ Add Yarn Row</Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
