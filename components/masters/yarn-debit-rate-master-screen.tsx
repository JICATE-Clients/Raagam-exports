"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PaginationBar } from "@/components/ui/pagination";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { usePagination } from "@/lib/use-pagination";
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import {
  createYarnDebitRate,
  updateYarnDebitRate,
  deleteYarnDebitRate,
} from "@/lib/masters/grid-master-actions";
import { Select } from "@/components/ui/select";
import type { YarnDebitRate, YarnDebitRateInput } from "@/lib/masters/grid-master-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };
type LookupOption = { id: string; code: string; name: string };

const todayISO = () => new Date().toISOString().slice(0, 10);

type LineRow = { key: string; item_id: string | null; rate_per_kg: string; rate_per_bundle: string };
const blankLine = (key: string): LineRow => ({ key, item_id: null, rate_per_kg: "", rate_per_bundle: "" });

export function YarnDebitRateMasterScreen({
  rows,
  items,
  perms,
}: {
  rows: YarnDebitRate[];
  items: LookupOption[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const pg = usePagination(rows, 10);

  function openAdd() {
    setEditId(null);
    setEditCode(null);
    setEffectiveFrom(todayISO());
    setLines([blankLine(newKey())]);
    setOpen(true);
  }
  function openEdit(r: YarnDebitRate) {
    setEditId(r.id);
    setEditCode(r.code);
    setEffectiveFrom(r.effective_from);
    setLines(r.details.slice().sort((a, b) => a.sno - b.sno).map((d) => ({
      key: newKey(),
      item_id: d.item_id,
      rate_per_kg: d.rate_per_kg != null ? String(d.rate_per_kg) : "",
      rate_per_bundle: d.rate_per_bundle != null ? String(d.rate_per_bundle) : "",
    })));
    setOpen(true);
  }

  function addLine() { setLines((ls) => [...ls, blankLine(newKey())]); }
  function setLineAt(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) { setLines((ls) => ls.filter((l) => l.key !== key)); }

  const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

  function submit() {
    startTransition(async () => {
      const payload: YarnDebitRateInput = {
        effective_from: effectiveFrom,
        details: lines.map((l, i) => ({
          sno: i + 1,
          item_id: l.item_id,
          rate_per_kg: numOrNull(l.rate_per_kg) ?? 0,
          rate_per_bundle: numOrNull(l.rate_per_bundle) ?? 0,
        })),
      };
      const res = editId ? await updateYarnDebitRate(editId, payload) : await createYarnDebitRate(payload);
      if (res.ok) {
        success(editId ? "Yarn debit rate updated." : "Yarn debit rate added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: YarnDebitRate) {
    startTransition(async () => {
      const res = await deleteYarnDebitRate(r.id);
      if (res.ok) {
        success("Yarn debit rate deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<YarnDebitRate>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Effective From", cell: (r) => <span className="text-sm text-muted-foreground">{r.effective_from}</span> },
    { header: "Rows", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.details.length}</span> },
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
        {perms.canCreate && <Button size="md" onClick={openAdd}>+ Add Rate</Button>}
      </div>

      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No yarn debit rate records yet." />
      </div>
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">No yarn debit rate records yet.</div>
        ) : pg.paged.map((r) => (
          <button key={r.id} type="button" onClick={() => perms.canEdit && openEdit(r)}
            className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted">
            <div className="min-w-0">
              <div className="font-mono text-[15px] font-semibold text-foreground">{r.code}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Effective: {r.effective_from} · {r.details.length} row{r.details.length === 1 ? "" : "s"}</div>
            </div>
          </button>
        ))}
      </div>

      <PaginationBar page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />

      <Sheet open={open} onClose={() => setOpen(false)}
        title={editId ? `Edit Rate ${editCode}` : "New Yarn Debit Rate"}
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
              <Label htmlFor="ydr-code">Code</Label>
              <Input id="ydr-code" value={editCode ?? "(auto)"} disabled className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="ydr-eff">Effective From <span className="text-danger">*</span></Label>
              <Input id="ydr-eff" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="text-base md:text-sm" />
            </div>
          </div>
          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">Rates</div>
            <div className="space-y-2 p-3">
              {lines.map((l, i) => (
                <div key={l.key} className="flex items-center gap-2">
                  <span className="w-6 shrink-0 text-center text-xs text-muted-foreground">{i + 1}</span>
                  <Select value={l.item_id ?? ""}
                    onChange={(e) => setLineAt(l.key, { item_id: e.target.value || null })}
                    className="flex-1 text-base md:text-sm">
                    <option value="">— select yarn —</option>
                    {items.map((it) => (
                      <option key={it.id} value={it.id}>{it.code} — {it.name}</option>
                    ))}
                  </Select>
                  <Input type="number" placeholder="Rate/KG" value={l.rate_per_kg} min={0} step="0.01"
                    onChange={(e) => setLineAt(l.key, { rate_per_kg: e.target.value })}
                    className="w-24 text-base md:text-sm" />
                  <Input type="number" placeholder="Rate/Bundle" value={l.rate_per_bundle} min={0}
                    onChange={(e) => setLineAt(l.key, { rate_per_bundle: e.target.value })}
                    className="w-28 text-base md:text-sm" />
                  <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger"
                    onClick={() => removeLine(l.key)} aria-label="Remove">✕</Button>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>+ Add Row</Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
