"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { DetailSection } from "@/components/masters/detail-section";
import { fmtDate, fmtMoney } from "@/lib/format";
import { createCatalogue, deleteCatalogue, createPriceList, deletePriceList, createPiEnquiry, deletePiEnquiry, addCatalogueStyle, addCataloguePackType, addPriceListStyle, addPiEnquiryStyle } from "@/lib/sales/catalogue-actions";
import type { StyleCatalogue, StylePriceList } from "@/lib/sales/catalogue-types";
import type { PiEnquiryRow } from "@/lib/sales/catalogue-service";
import type { StatusTone } from "@/components/ui/status-pill";

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", sent: "info", confirmed: "success", cancelled: "danger" };

function CatalogueTab({ rows }: { rows: StyleCatalogue[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingChild, setAddingChild] = useState(false);
  const [childForm, setChildForm] = useState({ style_no: "", style_description: "", design: "" });
  const [form, setForm] = useState({ catalogue_description: "", basic_price: "", hsn_code: "", catalogue_for: "" });

  function submitChild() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addCatalogueStyle(selectedId, { style_no: childForm.style_no || null, style_description: childForm.style_description || null, design: childForm.design || null });
      if (res.ok) { success("Style added."); setAddingChild(false); setChildForm({ style_no: "", style_description: "", design: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<StyleCatalogue>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Description", cell: (r) => r.catalogue_description ?? "—" },
    { header: "Category", cell: (r) => r.style_category ?? "—" },
    { header: "Price", align: "right", cell: (r) => <span className="tabular-nums">{r.basic_price != null ? fmtMoney(r.basic_price) : "—"}</span> },
    { header: "HSN", cell: (r) => r.hsn_code ?? "—" },
    { header: "Status", cell: (r) => <StatusPill tone={r.blocked ? "danger" : "success"}>{r.blocked ? "Blocked" : "Active"}</StatusPill> },
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deleteCatalogue(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Catalogue</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No catalogues yet." />
      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Styles for: {rows.find(r => r.id === selectedId)?.code ?? "—"}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddingChild(!addingChild)}>{addingChild ? "Cancel" : "+ Add Style"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
          {addingChild && (
            <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
              <div><Label>Style No</Label><Input className="w-24" value={childForm.style_no} onChange={(e) => setChildForm({ ...childForm, style_no: e.target.value })} /></div>
              <div><Label>Description</Label><Input className="w-40" value={childForm.style_description} onChange={(e) => setChildForm({ ...childForm, style_description: e.target.value })} /></div>
              <div><Label>Design</Label><Input className="w-24" value={childForm.design} onChange={(e) => setChildForm({ ...childForm, design: e.target.value })} /></div>
              <Button size="sm" disabled={isPending} onClick={submitChild}>{isPending ? "Adding…" : "Add"}</Button>
            </div>
          )}
        </div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="New Catalogue" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending} onClick={() => startTransition(async () => { const res = await createCatalogue({ catalogue_description: form.catalogue_description || null, basic_price: form.basic_price ? Number(form.basic_price) : null, hsn_code: form.hsn_code || null, catalogue_for: form.catalogue_for || null }); if (res.ok) { success("Created."); setOpen(false); router.refresh(); } else error(res.error); })}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Details">
            <div><Label>Description</Label><Input value={form.catalogue_description} onChange={(e) => setForm({ ...form, catalogue_description: e.target.value })} /></div>
            <div><Label>Basic Price</Label><Input type="number" value={form.basic_price} onChange={(e) => setForm({ ...form, basic_price: e.target.value })} /></div>
            <div><Label>HSN Code</Label><Input value={form.hsn_code} onChange={(e) => setForm({ ...form, hsn_code: e.target.value })} /></div>
            <div><Label>Catalogue For</Label><Input value={form.catalogue_for} onChange={(e) => setForm({ ...form, catalogue_for: e.target.value })} /></div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}

function PriceListTab({ rows }: { rows: StylePriceList[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingStyle, setAddingStyle] = useState(false);
  const [styleForm, setStyleForm] = useState({ style_no: "", style_description: "", uom_id: "" });
  const [form, setForm] = useState({ reference: "", effective_from: "", style_type: "", rate_for: "" });

  function submitStyle() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addPriceListStyle(selectedId, { style_no: styleForm.style_no || null, style_description: styleForm.style_description || null, uom_id: styleForm.uom_id || null });
      if (res.ok) { success("Style added."); setAddingStyle(false); setStyleForm({ style_no: "", style_description: "", uom_id: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<StylePriceList>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Reference", cell: (r) => r.reference ?? "—" },
    { header: "Effective From", cell: (r) => r.effective_from ? fmtDate(r.effective_from) : "—" },
    { header: "Type", cell: (r) => r.style_type ?? "—" },
    { header: "Rate For", cell: (r) => r.rate_for ?? "—" },
    { header: "Status", cell: (r) => <StatusPill tone={r.blocked ? "danger" : "success"}>{r.blocked ? "Blocked" : "Active"}</StatusPill> },
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deletePriceList(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New Price List</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No price lists yet." />
      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Styles for: {rows.find(r => r.id === selectedId)?.code ?? "—"}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddingStyle(!addingStyle)}>{addingStyle ? "Cancel" : "+ Add Style"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
          {addingStyle && (
            <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
              <div><Label>Style No</Label><Input className="w-24" value={styleForm.style_no} onChange={(e) => setStyleForm({ ...styleForm, style_no: e.target.value })} /></div>
              <div><Label>Description</Label><Input className="w-40" value={styleForm.style_description} onChange={(e) => setStyleForm({ ...styleForm, style_description: e.target.value })} /></div>
              <div><Label>UOM</Label><Input className="w-16" value={styleForm.uom_id} onChange={(e) => setStyleForm({ ...styleForm, uom_id: e.target.value })} /></div>
              <Button size="sm" disabled={isPending} onClick={submitStyle}>{isPending ? "Adding…" : "Add"}</Button>
            </div>
          )}
        </div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="New Price List" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending} onClick={() => startTransition(async () => { const res = await createPriceList({ reference: form.reference || null, effective_from: form.effective_from || null, style_type: form.style_type || null, rate_for: (form.rate_for as "bulk" | "sample") || null }); if (res.ok) { success("Created."); setOpen(false); router.refresh(); } else error(res.error); })}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Details">
            <div><Label>Reference</Label><Input value={form.reference} onChange={(e) => setForm({ ...form, reference: e.target.value })} /></div>
            <div><Label>Effective From</Label><Input type="date" value={form.effective_from} onChange={(e) => setForm({ ...form, effective_from: e.target.value })} /></div>
            <div><Label>Style Type</Label><Input value={form.style_type} onChange={(e) => setForm({ ...form, style_type: e.target.value })} /></div>
            <div><Label>Rate For</Label><Select value={form.rate_for} onChange={(e) => setForm({ ...form, rate_for: e.target.value })}><option value="">Select…</option><option value="bulk">Bulk</option><option value="sample">Sample</option></Select></div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}

function PiEnquiryTab({ rows }: { rows: PiEnquiryRow[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [addingStyle, setAddingStyle] = useState(false);
  const [piStyleForm, setPiStyleForm] = useState({ style_no: "", style_description: "", fabric_structure: "", order_qty: "", expected_order_qty: "" });
  const [form, setForm] = useState({ enquiry_date: new Date().toISOString().slice(0, 10), customer_reference: "", agent_name: "", season: "", notes: "" });

  function submitPiStyle() {
    if (!selectedId) return;
    startTransition(async () => {
      const res = await addPiEnquiryStyle(selectedId, {
        style_no: piStyleForm.style_no || null,
        style_description: piStyleForm.style_description || null,
        fabric_structure: piStyleForm.fabric_structure || null,
        order_qty: piStyleForm.order_qty ? Number(piStyleForm.order_qty) : 0,
        expected_order_qty: piStyleForm.expected_order_qty ? Number(piStyleForm.expected_order_qty) : 0,
      });
      if (res.ok) { success("Style added."); setAddingStyle(false); setPiStyleForm({ style_no: "", style_description: "", fabric_structure: "", order_qty: "", expected_order_qty: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  const columns: Column<PiEnquiryRow>[] = [
    { header: "Code", cell: (r) => <button type="button" className="font-mono text-xs text-primary hover:underline" onClick={() => setSelectedId(selectedId === r.id ? null : r.id)}>{r.code ?? "—"}</button> },
    { header: "Date", cell: (r) => <span className="text-xs tabular-nums">{fmtDate(r.enquiry_date)}</span> },
    { header: "Customer", cell: (r) => r.buyer_name ?? "—" },
    { header: "Reference", cell: (r) => r.customer_reference ?? "—" },
    { header: "Season", cell: (r) => [r.season, r.season_yr].filter(Boolean).join(" ") || "—" },
    { header: "Status", cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{r.status}</StatusPill> },
    { header: "", align: "right", cell: (r) => r.status === "draft" ? <Button variant="ghost" size="sm" className="text-red-600" onClick={() => startTransition(async () => { const res = await deletePiEnquiry(r.id); if (res.ok) { success("Deleted."); router.refresh(); } else error(res.error); })} disabled={isPending}>Delete</Button> : null },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end"><Button size="md" onClick={() => setOpen(true)}>+ New PI Enquiry</Button></div>
      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No PI enquiries yet." />
      {selectedId && (
        <div className="rounded-lg border border-border bg-surface p-4 space-y-3">
          <div className="flex items-center justify-between">
            <h3 className="text-sm font-semibold">Styles for: {rows.find(r => r.id === selectedId)?.code ?? "—"}</h3>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={() => setAddingStyle(!addingStyle)}>{addingStyle ? "Cancel" : "+ Add Style"}</Button>
              <Button variant="ghost" size="sm" onClick={() => setSelectedId(null)}>Close</Button>
            </div>
          </div>
          {addingStyle && (
            <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
              <div><Label>Style No</Label><Input className="w-24" value={piStyleForm.style_no} onChange={(e) => setPiStyleForm({ ...piStyleForm, style_no: e.target.value })} /></div>
              <div><Label>Description</Label><Input className="w-32" value={piStyleForm.style_description} onChange={(e) => setPiStyleForm({ ...piStyleForm, style_description: e.target.value })} /></div>
              <div><Label>Fabric</Label><Input className="w-24" value={piStyleForm.fabric_structure} onChange={(e) => setPiStyleForm({ ...piStyleForm, fabric_structure: e.target.value })} /></div>
              <div><Label>Order Qty</Label><Input className="w-20" type="number" value={piStyleForm.order_qty} onChange={(e) => setPiStyleForm({ ...piStyleForm, order_qty: e.target.value })} /></div>
              <div><Label>Exp Qty</Label><Input className="w-20" type="number" value={piStyleForm.expected_order_qty} onChange={(e) => setPiStyleForm({ ...piStyleForm, expected_order_qty: e.target.value })} /></div>
              <Button size="sm" disabled={isPending} onClick={submitPiStyle}>{isPending ? "Adding…" : "Add"}</Button>
            </div>
          )}
        </div>
      )}
      <Sheet open={open} onClose={() => setOpen(false)} title="New PI Enquiry" footer={<><Button variant="outline" size="md" onClick={() => setOpen(false)}>Cancel</Button><Button size="md" disabled={isPending} onClick={() => startTransition(async () => { const res = await createPiEnquiry({ enquiry_date: form.enquiry_date, customer_reference: form.customer_reference || null, agent_name: form.agent_name || null, season: form.season || null, notes: form.notes || null }); if (res.ok) { success("Created."); setOpen(false); router.refresh(); } else error(res.error); })}>{isPending ? "Saving…" : "Save"}</Button></>}>
        <div className="space-y-4">
          <DetailSection label="Details">
            <div><Label>Enquiry Date</Label><Input type="date" value={form.enquiry_date} onChange={(e) => setForm({ ...form, enquiry_date: e.target.value })} /></div>
            <div><Label>Customer Reference</Label><Input value={form.customer_reference} onChange={(e) => setForm({ ...form, customer_reference: e.target.value })} /></div>
            <div><Label>Agent</Label><Input value={form.agent_name} onChange={(e) => setForm({ ...form, agent_name: e.target.value })} /></div>
            <div><Label>Season</Label><Input value={form.season} onChange={(e) => setForm({ ...form, season: e.target.value })} /></div>
            <div><Label>Notes</Label><Input value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </DetailSection>
        </div>
      </Sheet>
    </div>
  );
}

export function CataloguesClient({
  catalogues,
  priceLists,
  piEnquiries,
}: {
  catalogues: StyleCatalogue[];
  priceLists: StylePriceList[];
  piEnquiries: PiEnquiryRow[];
}) {
  const items = [
    { key: "catalogues", label: `Catalogues (${catalogues.length})`, content: <CatalogueTab rows={catalogues} /> },
    { key: "price-lists", label: `Price Lists (${priceLists.length})`, content: <PriceListTab rows={priceLists} /> },
    { key: "pi-enquiries", label: `PI Enquiries (${piEnquiries.length})`, content: <PiEnquiryTab rows={piEnquiries} /> },
  ];

  return <Tabs items={items} />;
}
