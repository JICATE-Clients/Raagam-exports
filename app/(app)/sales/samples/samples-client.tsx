"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Sheet } from "@/components/ui/sheet";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { FilterBar } from "@/components/masters/filter-bar";
import { useToast } from "@/components/ui/toast";
import { fmtDate, fmtNumber } from "@/lib/format";
import { createSample, updateSample, deleteSample } from "@/lib/sales/actions";
import {
  SAMPLE_TYPES,
  SAMPLE_STATUSES,
  type SampleType,
  type SampleStatus,
} from "@/lib/sales/types";
import type {
  SampleRegisterRow,
  OpportunityRow,
  StyleRegisterRow,
} from "@/lib/sales/service";
import type { Uom } from "@/lib/masters/types";

const STATUS_TONE: Record<SampleStatus, StatusTone> = {
  requested: "neutral",
  in_progress: "info",
  sent: "warning",
  approved: "success",
  rejected: "danger",
};

const titleCase = (v: string) =>
  v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());

const EMPTY = {
  opportunity_id: "",
  style_id: "",
  type: "proto" as SampleType,
  status: "requested" as SampleStatus,
  sample_qty: "",
  unit_id: "",
  delivery_date: "",
  customer_reference: "",
  courier_ref: "",
  notes: "",
};

interface Props {
  samples: SampleRegisterRow[];
  opportunities: OpportunityRow[];
  styles: StyleRegisterRow[];
  uoms: Uom[];
  perms: { canCreate: boolean; canEdit: boolean; canDelete: boolean };
}

/** Legacy "Samples — By Sample No.": a flat register of sample requests across
 *  enquiries (Sample No · Dt · Customer · Type · Style · Qty · Unit · Deli Dt ·
 *  Customer Ref · Status) + a Sheet editor. */
export function SamplesClient({ samples, opportunities, styles, uoms, perms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [search, setSearch] = useState("");
  const [type, setType] = useState<"all" | SampleType>("all");
  const [status, setStatus] = useState<"all" | SampleStatus>("all");

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...EMPTY });

  const enquiryStyles = useMemo(
    () => styles.filter((s) => s.opportunity_id === form.opportunity_id),
    [styles, form.opportunity_id],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return samples.filter((s) => {
      if (type !== "all" && s.type !== type) return false;
      if (status !== "all" && s.status !== status) return false;
      if (q) {
        const hay = [s.code, s.enquiry_code, s.buyer_name, s.style_name, s.customer_reference]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [samples, search, type, status]);

  const activeCount = (type !== "all" ? 1 : 0) + (status !== "all" ? 1 : 0);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function openCreate() {
    setEditId(null);
    setForm({ ...EMPTY });
    setOpen(true);
  }

  function openEdit(s: SampleRegisterRow) {
    setEditId(s.id);
    setForm({
      opportunity_id: s.opportunity_id,
      style_id: s.style_id ?? "",
      type: s.type,
      status: s.status,
      sample_qty: s.sample_qty != null ? String(s.sample_qty) : "",
      unit_id: s.unit_id ?? "",
      delivery_date: s.delivery_date ?? "",
      customer_reference: s.customer_reference ?? "",
      courier_ref: s.courier_ref ?? "",
      notes: s.notes ?? "",
    });
    setOpen(true);
  }

  function save() {
    if (!form.opportunity_id) return;
    const payload = {
      opportunity_id: form.opportunity_id,
      style_id: form.style_id || null,
      type: form.type,
      status: form.status,
      sample_qty: form.sample_qty ? Number(form.sample_qty) : null,
      unit_id: form.unit_id || null,
      delivery_date: form.delivery_date || null,
      customer_reference: form.customer_reference || null,
      courier_ref: form.courier_ref || null,
      notes: form.notes || null,
    };
    start(async () => {
      const res = editId
        ? await updateSample(editId, payload)
        : await createSample(payload);
      if (res.ok) {
        success(editId ? "Sample updated." : "Sample recorded.");
        setOpen(false);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function remove(s: SampleRegisterRow) {
    if (!window.confirm(`Delete sample ${s.code ?? ""}? This cannot be undone.`)) return;
    start(async () => {
      const res = await deleteSample(s.id);
      if (res.ok) {
        success("Sample deleted.");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const dash = <span className="text-muted-foreground">—</span>;
  const columns: Column<SampleRegisterRow>[] = [
    { header: "Sample No", cell: (s) => <span className="font-mono text-xs font-medium">{s.code ?? "—"}</span> },
    { header: "Sample Dt", cell: (s) => <span className="tabular-nums text-xs">{fmtDate(s.created_at)}</span> },
    { header: "Customer", cell: (s) => s.buyer_name ?? dash },
    { header: "Sample Type", cell: (s) => s.type.toUpperCase() },
    {
      header: "Style",
      cell: (s) =>
        s.style_name ? (
          <span>
            {s.style_name}
            {s.style_code ? <span className="text-muted-foreground"> ({s.style_code})</span> : null}
          </span>
        ) : (
          dash
        ),
    },
    { header: "Sample Qty", align: "right", cell: (s) => (s.sample_qty != null ? <span className="tabular-nums">{fmtNumber(s.sample_qty)}</span> : dash) },
    { header: "Unit", cell: (s) => s.unit_code ?? dash },
    { header: "Deli Dt", cell: (s) => (s.delivery_date ? <span className="tabular-nums text-xs">{fmtDate(s.delivery_date)}</span> : dash) },
    { header: "Customer Ref", cell: (s) => s.customer_reference ?? dash },
    {
      header: "Status",
      cell: (s) => <StatusPill tone={STATUS_TONE[s.status] ?? "neutral"}>{titleCase(s.status)}</StatusPill>,
    },
    {
      header: "",
      align: "right",
      cell: (s) => (
        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
          {perms.canEdit && (
            <Button variant="outline" size="sm" onClick={() => openEdit(s)}>
              Edit
            </Button>
          )}
          {perms.canDelete && (
            <Button variant="outline" size="sm" disabled={isPending} onClick={() => remove(s)}>
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Samples"
        description="Sample requests across enquiries — proto / fit / SMS / PP / TOP, tracked to approval."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/sales">
              <Button variant="outline" size="sm">
                ← Sales Pipeline
              </Button>
            </Link>
            {perms.canCreate && (
              <Button size="sm" onClick={openCreate}>
                Add Sample
              </Button>
            )}
          </div>
        }
      />

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search sample no, enquiry, customer, style, ref…"
        activeCount={activeCount}
        onReset={() => {
          setType("all");
          setStatus("all");
        }}
        right={`${filtered.length} of ${samples.length}`}
      >
        <div>
          <Label htmlFor="flt-type">Sample Type</Label>
          <Select id="flt-type" value={type} onChange={(e) => setType(e.target.value as "all" | SampleType)}>
            <option value="all">All</option>
            {SAMPLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {t.toUpperCase()}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="flt-status">Status</Label>
          <Select id="flt-status" value={status} onChange={(e) => setStatus(e.target.value as "all" | SampleStatus)}>
            <option value="all">All</option>
            {SAMPLE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        getKey={(s) => s.id}
        empty="No samples yet. Add one against an enquiry to get started."
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? "Edit Sample" : "Add Sample"}
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={isPending || !form.opportunity_id}>
              {isPending ? "Saving…" : editId ? "Save" : "Add Sample"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="s-enq">Enquiry *</Label>
            <Select id="s-enq" value={form.opportunity_id} onChange={(e) => set("opportunity_id", e.target.value)}>
              <option value="">Select enquiry…</option>
              {opportunities.map((o) => (
                <option key={o.id} value={o.id}>
                  {(o.code ?? "—") +
                    (o.buyer_name ? ` · ${o.buyer_name}` : "") +
                    (o.season ? ` · ${o.season}` : "")}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="s-type">Sample Type *</Label>
              <Select id="s-type" value={form.type} onChange={(e) => set("type", e.target.value as SampleType)}>
                {SAMPLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="s-status">Status</Label>
              <Select id="s-status" value={form.status} onChange={(e) => set("status", e.target.value as SampleStatus)}>
                {SAMPLE_STATUSES.map((s) => (
                  <option key={s} value={s}>
                    {titleCase(s)}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="s-style">Style</Label>
            <Select id="s-style" value={form.style_id} onChange={(e) => set("style_id", e.target.value)} disabled={!form.opportunity_id}>
              <option value="">None</option>
              {enquiryStyles.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                  {s.style_code ? ` (${s.style_code})` : ""}
                </option>
              ))}
            </Select>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="s-qty">Sample Qty</Label>
              <Input id="s-qty" type="number" min={0} value={form.sample_qty} onChange={(e) => set("sample_qty", e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label htmlFor="s-unit">Unit</Label>
              <Select id="s-unit" value={form.unit_id} onChange={(e) => set("unit_id", e.target.value)}>
                <option value="">Select…</option>
                {uoms.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="s-deli">Delivery Date</Label>
              <Input id="s-deli" type="date" value={form.delivery_date} onChange={(e) => set("delivery_date", e.target.value)} />
            </div>
            <div>
              <Label htmlFor="s-ref">Customer Reference</Label>
              <Input id="s-ref" value={form.customer_reference} onChange={(e) => set("customer_reference", e.target.value)} placeholder="Buyer's ref" />
            </div>
          </div>

          <div>
            <Label htmlFor="s-courier">Courier Ref</Label>
            <Input id="s-courier" value={form.courier_ref} onChange={(e) => set("courier_ref", e.target.value)} placeholder="Dispatch / courier reference" />
          </div>

          <div>
            <Label htmlFor="s-notes">Notes</Label>
            <Input id="s-notes" value={form.notes} onChange={(e) => set("notes", e.target.value)} placeholder="Optional notes" />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
