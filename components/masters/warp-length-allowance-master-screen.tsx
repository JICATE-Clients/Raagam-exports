"use client";

import { useRef, useState, useTransition } from "react";
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
import { DeleteConfirmButton } from "@/components/masters/delete-confirm-button";
import {
  createWarpLengthAllowance,
  updateWarpLengthAllowance,
  deleteWarpLengthAllowance,
} from "@/lib/masters/grid-master-actions";
import type { WarpLengthAllowance, WarpLengthAllowanceInput } from "@/lib/masters/grid-master-types";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean; canExport?: boolean };

const todayISO = () => new Date().toISOString().slice(0, 10);

const RANGE_TYPES = [
  { value: "U", label: "Upto" },
  { value: "B", label: "Between" },
  { value: "A", label: "Above" },
] as const;

type LineRow = {
  key: string;
  range_type: "U" | "B" | "A";
  from_warp_length: string;
  to_warp_length: string;
  warp_length: string;
  fabric_length: string;
  weft_waste_pct: string;
  shuttle_loom: boolean;
  shuttleless_loom: boolean;
  hand_loom: boolean;
};
const blankLine = (key: string): LineRow => ({
  key,
  range_type: "B",
  from_warp_length: "",
  to_warp_length: "",
  warp_length: "",
  fabric_length: "",
  weft_waste_pct: "",
  shuttle_loom: false,
  shuttleless_loom: false,
  hand_loom: false,
});

export function WarpLengthAllowanceMasterScreen({
  rows,
  perms,
}: {
  rows: WarpLengthAllowance[];
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
  function openEdit(r: WarpLengthAllowance) {
    setEditId(r.id);
    setEditCode(r.code);
    setEffectiveFrom(r.effective_from);
    setLines(r.details.slice().sort((a, b) => a.sno - b.sno).map((d) => ({
      key: newKey(),
      range_type: d.range_type ?? "B",
      from_warp_length: d.from_warp_length != null ? String(d.from_warp_length) : "",
      to_warp_length: d.to_warp_length != null ? String(d.to_warp_length) : "",
      warp_length: d.warp_length != null ? String(d.warp_length) : "",
      fabric_length: d.fabric_length != null ? String(d.fabric_length) : "",
      weft_waste_pct: d.weft_waste_pct != null ? String(d.weft_waste_pct) : "",
      shuttle_loom: d.shuttle_loom ?? false,
      shuttleless_loom: d.shuttleless_loom ?? false,
      hand_loom: d.hand_loom ?? false,
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
      const payload: WarpLengthAllowanceInput = {
        effective_from: effectiveFrom,
        details: lines.map((l, i) => ({
          sno: i + 1,
          range_type: l.range_type,
          from_warp_length: numOrZero(l.from_warp_length),
          to_warp_length: numOrZero(l.to_warp_length),
          warp_length: numOrZero(l.warp_length),
          fabric_length: numOrZero(l.fabric_length),
          weft_waste_pct: numOrZero(l.weft_waste_pct),
          shuttle_loom: l.shuttle_loom,
          shuttleless_loom: l.shuttleless_loom,
          hand_loom: l.hand_loom,
        })),
      };
      const res = editId ? await updateWarpLengthAllowance(editId, payload) : await createWarpLengthAllowance(payload);
      if (res.ok) {
        success(editId ? "Warp length allowance updated." : "Warp length allowance added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: WarpLengthAllowance) {
    startTransition(async () => {
      const res = await deleteWarpLengthAllowance(r.id);
      if (res.ok) {
        success("Warp length allowance deleted.");
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<WarpLengthAllowance>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Effective From", cell: (r) => <span className="text-sm text-muted-foreground">{r.effective_from}</span> },
    { header: "Ranges", align: "right", cell: (r) => <span className="tabular-nums text-sm">{r.details.length}</span> },
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
        {perms.canCreate && <Button size="md" onClick={openAdd}>+ Add Allowance</Button>}
      </div>

      <div className="hidden md:block">
        <DataTable columns={columns} rows={pg.paged} getKey={(r) => r.id} empty="No warp length allowance records yet." />
      </div>
      <div className="space-y-2.5 md:hidden">
        {pg.paged.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">No warp length allowance records yet.</div>
        ) : pg.paged.map((r) => (
          <button key={r.id} type="button" onClick={() => perms.canEdit && openEdit(r)}
            className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted">
            <div className="min-w-0">
              <div className="font-mono text-[15px] font-semibold text-foreground">{r.code}</div>
              <div className="mt-0.5 text-xs text-muted-foreground">Effective: {r.effective_from} · {r.details.length} range{r.details.length === 1 ? "" : "s"}</div>
            </div>
          </button>
        ))}
      </div>

      <PaginationBar page={pg.page} pageCount={pg.pageCount} total={pg.total} pageSize={pg.pageSize} onPageChange={pg.setPage} onPageSizeChange={pg.setPageSize} />

      <Sheet open={open} onClose={() => setOpen(false)}
        title={editId ? `Edit Allowance ${editCode}` : "New Warp Length Allowance"}
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
              <Label htmlFor="wla-code">Code</Label>
              <Input id="wla-code" value={editCode ?? "(auto)"} disabled className="text-base md:text-sm" />
            </div>
            <div>
              <Label htmlFor="wla-eff">Effective From <span className="text-danger">*</span></Label>
              <Input id="wla-eff" type="date" value={effectiveFrom} onChange={(e) => setEffectiveFrom(e.target.value)} className="text-base md:text-sm" />
            </div>
          </div>

          <div className="rounded-lg border border-border">
            <div className="border-b border-border px-3 py-2.5 text-sm font-medium text-foreground">Ranges</div>
            <div className="space-y-3 p-3">
              {lines.map((l, i) => (
                <div key={l.key} className="space-y-2 rounded-lg border border-border/50 bg-surface-muted/30 p-3">
                  <div className="flex items-center gap-2">
                    <span className="w-6 shrink-0 text-center text-xs font-medium text-muted-foreground">{i + 1}</span>
                    <Select value={l.range_type}
                      onChange={(e) => setLineAt(l.key, { range_type: e.target.value as "U" | "B" | "A" })}
                      className="w-28 text-base md:text-sm">
                      {RANGE_TYPES.map((rt) => (
                        <option key={rt.value} value={rt.value}>{rt.label}</option>
                      ))}
                    </Select>
                    <Input type="number" placeholder="From (m)" value={l.from_warp_length} min={0}
                      onChange={(e) => setLineAt(l.key, { from_warp_length: e.target.value })}
                      className="flex-1 text-base md:text-sm" />
                    <Input type="number" placeholder="To (m)" value={l.to_warp_length} min={0}
                      onChange={(e) => setLineAt(l.key, { to_warp_length: e.target.value })}
                      className="flex-1 text-base md:text-sm" />
                    <Button type="button" variant="ghost" size="sm" className="text-muted-foreground hover:text-danger"
                      onClick={() => removeLine(l.key)} aria-label="Remove">✕</Button>
                  </div>
                  <div className="ml-8 grid grid-cols-3 gap-2">
                    <div>
                      <Label className="text-xs">Warp Length</Label>
                      <Input type="number" value={l.warp_length} min={0}
                        onChange={(e) => setLineAt(l.key, { warp_length: e.target.value })}
                        className="text-base md:text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Fabric Length</Label>
                      <Input type="number" value={l.fabric_length} min={0}
                        onChange={(e) => setLineAt(l.key, { fabric_length: e.target.value })}
                        className="text-base md:text-sm" />
                    </div>
                    <div>
                      <Label className="text-xs">Weft Waste %</Label>
                      <Input type="number" value={l.weft_waste_pct} min={0} max={100} step="0.01"
                        onChange={(e) => setLineAt(l.key, { weft_waste_pct: e.target.value })}
                        className="text-base md:text-sm" />
                    </div>
                  </div>
                  <div className="ml-8 flex gap-4">
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer accent-primary" checked={l.shuttle_loom}
                        onChange={(e) => setLineAt(l.key, { shuttle_loom: e.target.checked })} />
                      <span className="text-xs text-foreground">Shuttle Loom</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer accent-primary" checked={l.shuttleless_loom}
                        onChange={(e) => setLineAt(l.key, { shuttleless_loom: e.target.checked })} />
                      <span className="text-xs text-foreground">Shuttleless</span>
                    </label>
                    <label className="flex cursor-pointer items-center gap-1.5">
                      <input type="checkbox" className="h-3.5 w-3.5 cursor-pointer accent-primary" checked={l.hand_loom}
                        onChange={(e) => setLineAt(l.key, { hand_loom: e.target.checked })} />
                      <span className="text-xs text-foreground">Hand Loom</span>
                    </label>
                  </div>
                </div>
              ))}
              <Button type="button" variant="outline" size="sm" onClick={addLine}>+ Add Range</Button>
            </div>
          </div>
        </div>
      </Sheet>
    </div>
  );
}
