"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DataTable, type Column } from "@/components/ui/data-table";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { fmtDate } from "@/lib/format";
import { createGeneralStockGroup, deleteGeneralStockGroup } from "@/lib/planning/config-actions";
import type { GeneralStockGroup } from "@/lib/planning/config-types";

const ITEM_CLASS_OPTIONS = ["Yarn", "Fabric", "Trims", "Garments", "Components", "Accessories"];

export function GeneralStocksClient({ rows }: { rows: GeneralStockGroup[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    group_date: new Date().toISOString().slice(0, 10),
    group_description: "",
    long_description: "",
    selectedClasses: [] as string[],
  });

  function toggleClass(cls: string) {
    setForm((f) => ({
      ...f,
      selectedClasses: f.selectedClasses.includes(cls)
        ? f.selectedClasses.filter((c) => c !== cls)
        : [...f.selectedClasses, cls],
    }));
  }

  function submit() {
    startTransition(async () => {
      const res = await createGeneralStockGroup({
        group_date: form.group_date,
        group_description: form.group_description || null,
        long_description: form.long_description || null,
        item_classes: form.selectedClasses.map((cls) => ({
          item_class_code: cls,
          is_selected: true,
        })),
      });
      if (res.ok) {
        success("Stock group created.");
        setOpen(false);
        setForm({ group_date: new Date().toISOString().slice(0, 10), group_description: "", long_description: "", selectedClasses: [] });
        router.refresh();
      } else error(res.error);
    });
  }

  const columns: Column<GeneralStockGroup>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.group_date)}</span> },
    { header: "Description", cell: (r) => r.group_description ?? "—" },
    { header: "Details", cell: (r) => <span className="text-xs text-muted-foreground line-clamp-1">{r.long_description ?? "—"}</span> },
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteGeneralStockGroup(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Stock Group</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No stock groups yet." />

      <Sheet open={open} onClose={() => setOpen(false)} title="New Stock Group" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending} onClick={submit}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Details">
            <div><Label>Date</Label><Input type="date" value={form.group_date} onChange={(e) => setForm({ ...form, group_date: e.target.value })} /></div>
            <div><Label>Description</Label><Input value={form.group_description} onChange={(e) => setForm({ ...form, group_description: e.target.value })} /></div>
            <div><Label>Long Description</Label><Input value={form.long_description} onChange={(e) => setForm({ ...form, long_description: e.target.value })} /></div>
          </DetailSection>
          <DetailSection label="Item Classes">
            <div className="flex flex-wrap gap-3">
              {ITEM_CLASS_OPTIONS.map((cls) => (
                <label key={cls} className="flex items-center gap-1.5 cursor-pointer text-sm">
                  <input type="checkbox" className="h-4 w-4 accent-primary" checked={form.selectedClasses.includes(cls)} onChange={() => toggleClass(cls)} />
                  {cls}
                </label>
              ))}
            </div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
