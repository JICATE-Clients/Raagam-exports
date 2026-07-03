"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { fmtNumber } from "@/lib/format";
import { DataIoToolbar } from "@/components/data-io/data-io-toolbar";
import { BulkDeleteBar } from "@/components/data-io/bulk-delete-bar";
import { useRowSelection } from "@/lib/data-io/use-row-selection";
import {
  createLookup,
  updateLookup,
  deleteLookup,
  createTransporter,
  updateTransporter,
  createGstRate,
  updateGstRate,
  createCurrency,
  updateCurrency,
} from "@/lib/masters/extras-actions";
import {
  LOOKUP_KINDS,
  LOOKUP_KIND_LABELS,
  type LookupKind,
  type ConfigLookup,
  type Transporter,
  type GstRate,
} from "@/lib/masters/extras-types";
import type { Currency } from "@/lib/masters/types";

type Res = { ok: boolean; error?: string };

/** Import/Export/Delete permission flags threaded to each master section. */
interface IoPerms {
  canCreate: boolean;
  canExport: boolean;
  canDelete: boolean;
}

/* ------------------------------------------------------------------ */
/* Materials Config — generic lookups with an internal kind selector   */
/* ------------------------------------------------------------------ */
export function MaterialsConfigSection({ lookups }: { lookups: ConfigLookup[] }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [kind, setKind] = useState<LookupKind>("material_category");
  const [editId, setEditId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [notes, setNotes] = useState("");

  const rows = lookups.filter((l) => l.kind === kind);

  function reset() {
    setEditId(null);
    setCode("");
    setName("");
    setNotes("");
  }
  function openEdit(l: ConfigLookup) {
    setEditId(l.id);
    setCode(l.code ?? "");
    setName(l.name);
    setNotes(l.notes ?? "");
  }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = { kind, code: code || null, name, notes: notes || null, is_active: true };
      const r: Res = editId ? await updateLookup(editId, payload) : await createLookup(payload);
      if (r.ok) {
        success(editId ? "Updated" : "Added");
        reset();
        router.refresh();
      } else toastError(r.error ?? "Failed");
    });
  }
  function remove(id: string) {
    startTransition(async () => {
      const r = await deleteLookup(id);
      if (r.ok) {
        success("Deleted");
        router.refresh();
      } else toastError(r.error ?? "Failed");
    });
  }

  const columns: Column<ConfigLookup>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Notes", cell: (r) => <span className="text-sm text-muted-foreground">{r.notes ?? "—"}</span> },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1">
          <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button>
          <Button variant="outline" size="sm" className="text-danger hover:border-danger" disabled={isPending} onClick={() => remove(r.id)}>Del</Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-1.5">
        {LOOKUP_KINDS.map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => { setKind(k); reset(); }}
            className={`rounded-md border px-2.5 py-1 text-xs font-medium transition-colors ${
              k === kind ? "border-primary bg-primary/10 text-primary" : "border-border text-muted-foreground hover:bg-surface-muted"
            }`}
          >
            {LOOKUP_KIND_LABELS[k]}
          </button>
        ))}
      </div>

      <Card>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="w-28"><Label htmlFor="lk-code">Code</Label><Input id="lk-code" value={code} onChange={(e) => setCode(e.target.value)} /></div>
            <div className="min-w-[200px] flex-1"><Label htmlFor="lk-name">{LOOKUP_KIND_LABELS[kind].replace(/s$/, "")} name</Label><Input id="lk-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="min-w-[160px] flex-1"><Label htmlFor="lk-notes">Notes</Label><Input id="lk-notes" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            <Button type="submit" variant="primary" size="sm" disabled={isPending}>{editId ? "Update" : "Add"}</Button>
            {editId && <Button type="button" variant="outline" size="sm" onClick={reset}>Cancel</Button>}
          </form>
        </CardBody>
      </Card>

      <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty={`No ${LOOKUP_KIND_LABELS[kind].toLowerCase()} yet.`} />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Transporters                                                        */
/* ------------------------------------------------------------------ */
export function TransportersSection({ transporters, io }: { transporters: Transporter[]; io: IoPerms }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const sel = useRowSelection();
  const [editId, setEditId] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [contact, setContact] = useState("");
  const [phone, setPhone] = useState("");

  function reset() { setEditId(null); setCode(""); setName(""); setContact(""); setPhone(""); }
  function openEdit(t: Transporter) { setEditId(t.id); setCode(t.code ?? ""); setName(t.name); setContact(t.contact_person ?? ""); setPhone(t.phone ?? ""); }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = { code: code || null, name, contact_person: contact || null, phone: phone || null, is_active: true };
      const r: Res = editId ? await updateTransporter(editId, payload) : await createTransporter(payload);
      if (r.ok) { success(editId ? "Updated" : "Added"); reset(); router.refresh(); } else toastError(r.error ?? "Failed");
    });
  }

  const columns: Column<Transporter>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code ?? "—"}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Contact", cell: (r) => <span className="text-sm">{r.contact_person ?? "—"}</span> },
    { header: "Phone", cell: (r) => <span className="text-sm">{r.phone ?? "—"}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={r.is_active ? "success" : "neutral"}>{r.is_active ? "Active" : "Inactive"}</StatusPill> },
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DataIoToolbar entityKey="transporters" rows={transporters} canImport={io.canCreate} canExport={io.canExport} />
      </div>

      {io.canDelete && (
        <BulkDeleteBar entityKey="transporters" selectedIds={sel.selectedIds} onClear={sel.clear} label="transporters" />
      )}

      <Card>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="w-28"><Label htmlFor="tr-code">Code</Label><Input id="tr-code" value={code} onChange={(e) => setCode(e.target.value)} /></div>
            <div className="min-w-[180px] flex-1"><Label htmlFor="tr-name">Name</Label><Input id="tr-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="w-40"><Label htmlFor="tr-contact">Contact</Label><Input id="tr-contact" value={contact} onChange={(e) => setContact(e.target.value)} /></div>
            <div className="w-36"><Label htmlFor="tr-phone">Phone</Label><Input id="tr-phone" value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
            <Button type="submit" variant="primary" size="sm" disabled={isPending}>{editId ? "Update" : "Add"}</Button>
            {editId && <Button type="button" variant="outline" size="sm" onClick={reset}>Cancel</Button>}
          </form>
        </CardBody>
      </Card>
      <DataTable
        columns={columns}
        rows={transporters}
        getKey={(r) => r.id}
        empty="No transporters yet."
        selectable={io.canDelete}
        selectedKeys={sel.selectedKeys}
        onToggle={sel.toggle}
        onToggleAll={() => sel.toggleAll(transporters.map((r) => r.id))}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* GST Rates                                                           */
/* ------------------------------------------------------------------ */
export function GstRatesSection({ gstRates, io }: { gstRates: GstRate[]; io: IoPerms }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const sel = useRowSelection();
  const [editId, setEditId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [rate, setRate] = useState("");
  const [hsn, setHsn] = useState("");

  function reset() { setEditId(null); setName(""); setRate(""); setHsn(""); }
  function openEdit(g: GstRate) { setEditId(g.id); setName(g.name); setRate(String(g.rate_pct)); setHsn(g.hsn_code ?? ""); }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = { name, rate_pct: parseFloat(rate) || 0, hsn_code: hsn || null, is_active: true };
      const r: Res = editId ? await updateGstRate(editId, payload) : await createGstRate(payload);
      if (r.ok) { success(editId ? "Updated" : "Added"); reset(); router.refresh(); } else toastError(r.error ?? "Failed");
    });
  }

  const columns: Column<GstRate>[] = [
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Rate %", align: "right", cell: (r) => <span className="tabular-nums text-sm">{fmtNumber(r.rate_pct)}</span> },
    { header: "HSN", cell: (r) => <span className="text-sm">{r.hsn_code ?? "—"}</span> },
    { header: "Status", cell: (r) => <StatusPill tone={r.is_active ? "success" : "neutral"}>{r.is_active ? "Active" : "Inactive"}</StatusPill> },
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DataIoToolbar entityKey="gst_rates" rows={gstRates} canImport={io.canCreate} canExport={io.canExport} />
      </div>

      {io.canDelete && (
        <BulkDeleteBar entityKey="gst_rates" selectedIds={sel.selectedIds} onClear={sel.clear} label="rates" />
      )}

      <Card>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="min-w-[180px] flex-1"><Label htmlFor="gs-name">Name</Label><Input id="gs-name" placeholder="e.g. GST 5%" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="w-28"><Label htmlFor="gs-rate">Rate %</Label><Input id="gs-rate" type="number" min="0" max="100" step="0.01" value={rate} onChange={(e) => setRate(e.target.value)} /></div>
            <div className="w-32"><Label htmlFor="gs-hsn">HSN code</Label><Input id="gs-hsn" value={hsn} onChange={(e) => setHsn(e.target.value)} /></div>
            <Button type="submit" variant="primary" size="sm" disabled={isPending}>{editId ? "Update" : "Add"}</Button>
            {editId && <Button type="button" variant="outline" size="sm" onClick={reset}>Cancel</Button>}
          </form>
        </CardBody>
      </Card>
      <DataTable
        columns={columns}
        rows={gstRates}
        getKey={(r) => r.id}
        empty="No GST rates yet."
        selectable={io.canDelete}
        selectedKeys={sel.selectedKeys}
        onToggle={sel.toggle}
        onToggleAll={() => sel.toggleAll(gstRates.map((r) => r.id))}
      />
    </div>
  );
}

/* ------------------------------------------------------------------ */
/* Currencies                                                          */
/* ------------------------------------------------------------------ */
export function CurrenciesSection({ currencies, io }: { currencies: Currency[]; io: IoPerms }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [editCode, setEditCode] = useState<string | null>(null);
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [symbol, setSymbol] = useState("");

  function reset() { setEditCode(null); setCode(""); setName(""); setSymbol(""); }
  function openEdit(c: Currency) { setEditCode(c.code); setCode(c.code); setName(c.name); setSymbol(c.symbol ?? ""); }
  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const payload = { code, name, symbol: symbol || null };
      const r: Res = editCode ? await updateCurrency(editCode, payload) : await createCurrency(payload);
      if (r.ok) { success(editCode ? "Updated" : "Added"); reset(); router.refresh(); } else toastError(r.error ?? "Failed");
    });
  }

  const columns: Column<Currency>[] = [
    { header: "Code", cell: (r) => <span className="font-mono text-xs">{r.code}</span> },
    { header: "Name", cell: (r) => <span className="text-sm">{r.name}</span> },
    { header: "Symbol", cell: (r) => <span className="text-sm">{r.symbol ?? "—"}</span> },
    { header: "", align: "right", cell: (r) => <Button variant="ghost" size="sm" onClick={() => openEdit(r)}>Edit</Button> },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <DataIoToolbar entityKey="currencies" rows={currencies} canImport={io.canCreate} canExport={io.canExport} />
      </div>

      <Card>
        <CardBody>
          <form onSubmit={handleSubmit} className="flex flex-wrap items-end gap-3">
            <div className="w-24"><Label htmlFor="cu-code">Code</Label><Input id="cu-code" value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} disabled={!!editCode} required /></div>
            <div className="min-w-[180px] flex-1"><Label htmlFor="cu-name">Name</Label><Input id="cu-name" value={name} onChange={(e) => setName(e.target.value)} required /></div>
            <div className="w-24"><Label htmlFor="cu-symbol">Symbol</Label><Input id="cu-symbol" value={symbol} onChange={(e) => setSymbol(e.target.value)} /></div>
            <Button type="submit" variant="primary" size="sm" disabled={isPending}>{editCode ? "Update" : "Add"}</Button>
            {editCode && <Button type="button" variant="outline" size="sm" onClick={reset}>Cancel</Button>}
          </form>
        </CardBody>
      </Card>
      <DataTable columns={columns} rows={currencies} getKey={(r) => r.code} empty="No currencies yet." />
    </div>
  );
}
