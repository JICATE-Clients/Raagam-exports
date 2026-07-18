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
import { createCatalogue, deleteCatalogue, createPriceList, deletePriceList, createPiEnquiry, deletePiEnquiry } from "@/lib/sales/catalogue-actions";
import type { StyleCatalogue, StylePriceList } from "@/lib/sales/catalogue-types";
import type { PiEnquiryRow } from "@/lib/sales/catalogue-service";
import type { StatusTone } from "@/components/ui/status-pill";

const STATUS_TONE: Record<string, StatusTone> = { draft: "neutral", sent: "info", confirmed: "success", cancelled: "danger" };

function CatalogueTab({ rows }: { rows: StyleCatalogue[] }) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ catalogue_description: "", basic_price: "", hsn_code: "", catalogue_for: "" });

  const columns: Column<StyleCatalogue>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
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
  const [form, setForm] = useState({ reference: "", effective_from: "", style_type: "", rate_for: "" });

  const columns: Column<StylePriceList>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
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
  const [form, setForm] = useState({ enquiry_date: new Date().toISOString().slice(0, 10), customer_reference: "", agent_name: "", season: "", notes: "" });

  const columns: Column<PiEnquiryRow>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
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
