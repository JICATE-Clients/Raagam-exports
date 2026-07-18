"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { fmtDate } from "@/lib/format";
import { createSqDetail, confirmSqDetail, deleteSqDetail, addSqPack, deleteSqPack } from "@/lib/sales/sq-actions";
import { SQ_SUB_TYPES, SOURCING_TYPES } from "@/lib/sales/sq-types";
import type { SqDetailRow } from "@/lib/sales/sq-service";
import type { StatusTone } from "@/components/ui/status-pill";

const STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  confirmed: "success",
  cancelled: "danger",
};

export function SqDetailsClient({ rows }: { rows: SqDetailRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [packForm, setPackForm] = useState({ country_code: "", consignee_name: "", assortment_type: "", no_of_cartons: "", sq_qty: "", delivery_date: "" });
  const [addingPack, setAddingPack] = useState(false);
  const [form, setForm] = useState({
    opportunity_id: "",
    sq_date: new Date().toISOString().slice(0, 10),
    sq_sub_type: "" as string,
    sourcing_type: "" as string,
    order_qty: "",
    excess_pct: "",
    rejection_pct: "",
    sq_description: "",
    notes: "",
  });

  function submit() {
    startTransition(async () => {
      const res = await createSqDetail({
        opportunity_id: form.opportunity_id,
        sq_date: form.sq_date,
        sq_sub_type: (form.sq_sub_type as (typeof SQ_SUB_TYPES)[number]) || null,
        sourcing_type: (form.sourcing_type as (typeof SOURCING_TYPES)[number]) || null,
        order_qty: form.order_qty ? Number(form.order_qty) : 0,
        excess_pct: form.excess_pct ? Number(form.excess_pct) : 0,
        rejection_pct: form.rejection_pct ? Number(form.rejection_pct) : 0,
        sq_description: form.sq_description || null,
        notes: form.notes || null,
      });
      if (res.ok) {
        success("SQ Detail created.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function submitPack() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addSqPack(selectedId, {
        country_code: packForm.country_code || null,
        consignee_name: packForm.consignee_name || null,
        assortment_type: packForm.assortment_type || null,
        no_of_cartons: packForm.no_of_cartons ? Number(packForm.no_of_cartons) : null,
        sq_qty: packForm.sq_qty ? Number(packForm.sq_qty) : 0,
        delivery_date: packForm.delivery_date || null,
      });
      if (res.ok) { success("Pack added."); setAddingPack(false); setPackForm({ country_code: "", consignee_name: "", assortment_type: "", no_of_cartons: "", sq_qty: "", delivery_date: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  function confirm(id: string) {
    startTransition(async () => {
      const res = await confirmSqDetail(id);
      if (res.ok) { success("SQ confirmed."); router.refresh(); }
      else error(res.error);
    });
  }

  function remove(id: string) {
    startTransition(async () => {
      const res = await deleteSqDetail(id);
      if (res.ok) { success("SQ deleted."); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<SqDetailRow>[] = [
    { header: "SQ No", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.sq_date)}</span> },
    { header: "Opportunity", cell: (r) => <span className="text-xs">{r.opportunity_code ?? "—"}</span> },
    { header: "Customer", cell: (r) => r.buyer_name ?? "—" },
    { header: "Type", cell: (r) => r.sq_sub_type?.replace("_", " ") ?? "—" },
    { header: "Source", cell: (r) => r.sourcing_type?.replace("_", " ") ?? "—" },
    { header: "Order Qty", align: "right", cell: (r) => <span className="tabular-nums">{r.order_qty}</span> },
    { header: "SQ Qty", align: "right", cell: (r) => <span className="tabular-nums">{r.sq_qty}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          {r.status === "draft" && (
            <Button variant="ghost" size="sm" onClick={() => confirm(r.id)} disabled={isPending}>
              Confirm
            </Button>
          )}
          {r.status === "draft" && (
            <Button variant="ghost" size="sm" className="text-red-600" onClick={() => remove(r.id)} disabled={isPending}>
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button size="md" onClick={() => setOpen(true)}>+ New SQ Detail</Button>
      </div>

      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No SQ Details yet." />

      {/* Pack editor for selected SQ */}
      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Packs for SQ: {rows.find(r => r.id === selectedId)?.code ?? "—"}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddingPack(!addingPack)}>{addingPack ? "Cancel" : "+ Add Pack"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
          {addingPack && (
            <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
              <div><Label>Country</Label><Input className="w-20" value={packForm.country_code} onChange={(e) => setPackForm({ ...packForm, country_code: e.target.value })} /></div>
              <div><Label>Consignee</Label><Input className="w-32" value={packForm.consignee_name} onChange={(e) => setPackForm({ ...packForm, consignee_name: e.target.value })} /></div>
              <div><Label>Assortment</Label><Select className="w-24" value={packForm.assortment_type} onChange={(e) => setPackForm({ ...packForm, assortment_type: e.target.value })}><option value="">—</option><option value="solid">Solid</option><option value="assorted">Assorted</option></Select></div>
              <div><Label>Cartons</Label><Input className="w-20" type="number" value={packForm.no_of_cartons} onChange={(e) => setPackForm({ ...packForm, no_of_cartons: e.target.value })} /></div>
              <div><Label>SQ Qty</Label><Input className="w-24" type="number" value={packForm.sq_qty} onChange={(e) => setPackForm({ ...packForm, sq_qty: e.target.value })} /></div>
              <div><Label>Delivery</Label><Input className="w-32" type="date" value={packForm.delivery_date} onChange={(e) => setPackForm({ ...packForm, delivery_date: e.target.value })} /></div>
              <Button size="sm" disabled={isPending} onClick={submitPack}>{isPending ? "Adding…" : "Add"}</Button>
            </div>
          )}
          <p className="text-xs text-muted-foreground">Packs are loaded when the SQ detail page is viewed. Click + Add Pack to add new packs.</p>
        </div>
      )}

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="New SQ Detail"
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button>
            <Button size="md" disabled={isPending || !form.opportunity_id} onClick={submit}>
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <DetailSection label="Header">
            <div>
              <Label htmlFor="sq-opp">Opportunity ID *</Label>
              <Input id="sq-opp" value={form.opportunity_id} onChange={(e) => setForm({ ...form, opportunity_id: e.target.value })} placeholder="UUID" />
            </div>
            <div>
              <Label htmlFor="sq-date">SQ Date</Label>
              <Input id="sq-date" type="date" value={form.sq_date} onChange={(e) => setForm({ ...form, sq_date: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="sq-subtype">Sub Type</Label>
              <Select id="sq-subtype" value={form.sq_sub_type} onChange={(e) => setForm({ ...form, sq_sub_type: e.target.value })}>
                <option value="">Select…</option>
                {SQ_SUB_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </Select>
            </div>
            <div>
              <Label htmlFor="sq-source">Sourcing</Label>
              <Select id="sq-source" value={form.sourcing_type} onChange={(e) => setForm({ ...form, sourcing_type: e.target.value })}>
                <option value="">Select…</option>
                {SOURCING_TYPES.map((t) => <option key={t} value={t}>{t.replace("_", " ")}</option>)}
              </Select>
            </div>
          </DetailSection>
          <DetailSection label="Quantities">
            <div>
              <Label htmlFor="sq-qty">Order Qty</Label>
              <Input id="sq-qty" type="number" value={form.order_qty} onChange={(e) => setForm({ ...form, order_qty: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="sq-excess">Excess %</Label>
              <Input id="sq-excess" type="number" value={form.excess_pct} onChange={(e) => setForm({ ...form, excess_pct: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="sq-rej">Rejection %</Label>
              <Input id="sq-rej" type="number" value={form.rejection_pct} onChange={(e) => setForm({ ...form, rejection_pct: e.target.value })} />
            </div>
          </DetailSection>
          <DetailSection label="Description">
            <div>
              <Label htmlFor="sq-desc">SQ Description</Label>
              <Input id="sq-desc" value={form.sq_description} onChange={(e) => setForm({ ...form, sq_description: e.target.value })} />
            </div>
            <div>
              <Label htmlFor="sq-notes">Notes</Label>
              <Input id="sq-notes" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}
