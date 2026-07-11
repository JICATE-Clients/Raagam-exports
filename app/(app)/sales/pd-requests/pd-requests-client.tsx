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
import { createPdRequest, cancelPdRequest } from "@/lib/sales/pd-handoff-actions";
import { SAMPLE_TYPES, type SampleType } from "@/lib/sales/types";
import type { SalesPdRequestRow, OpportunityRow, StyleRegisterRow } from "@/lib/sales/service";
import type { Uom } from "@/lib/masters/types";

const STATUS_TONE: Record<string, StatusTone> = {
  open: "info",
  closed: "success",
  cancelled: "neutral",
};

const humanize = (v: string) =>
  v ? v.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase()) : "—";

const EMPTY = {
  opportunity_id: "",
  title: "",
  style_id: "",
  sample_type: "" as SampleType | "",
  sample_qty: "",
  unit_id: "",
  delivery_date: "",
  customer_reference: "",
  description: "",
};

interface Props {
  requests: SalesPdRequestRow[];
  opportunities: OpportunityRow[];
  styles: StyleRegisterRow[];
  uoms: Uom[];
  perms: { canCreate: boolean; canEdit: boolean };
}

/** Legacy "Product Development Request — By Sample No.": raise PD requests (into
 *  Planning's pipeline) against an enquiry, capturing style / sample type & qty /
 *  unit / delivery date / customer reference. Register + Sheet editor. */
export function PdRequestsClient({ requests, opportunities, styles, uoms, perms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | string>("all");

  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({ ...EMPTY });

  const enquiryStyles = useMemo(
    () => styles.filter((s) => s.opportunity_id === form.opportunity_id),
    [styles, form.opportunity_id],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return requests.filter((r) => {
      if (status !== "all" && r.status !== status) return false;
      if (q) {
        const hay = [r.code, r.enquiry_code, r.buyer_name, r.style_name, r.customer_reference]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [requests, search, status]);

  const set = <K extends keyof typeof form>(k: K, v: (typeof form)[K]) =>
    setForm((f) => ({ ...f, [k]: v }));

  function onPickEnquiry(id: string) {
    const opp = opportunities.find((o) => o.id === id);
    setForm((f) => ({
      ...f,
      opportunity_id: id,
      style_id: "",
      // default the title from the enquiry if the user hasn't typed one
      title: f.title.trim() ? f.title : opp?.title ?? "",
    }));
  }

  function openCreate() {
    setForm({ ...EMPTY });
    setOpen(true);
  }

  function save() {
    if (!form.opportunity_id || !form.title.trim()) return;
    start(async () => {
      const res = await createPdRequest({
        opportunity_id: form.opportunity_id,
        title: form.title,
        description: form.description || null,
        style_id: form.style_id || null,
        sample_type: form.sample_type || null,
        sample_qty: form.sample_qty ? Number(form.sample_qty) : null,
        unit_id: form.unit_id || null,
        delivery_date: form.delivery_date || null,
        customer_reference: form.customer_reference || null,
      });
      if (res.ok) {
        success("Product development requested → Planning.");
        setOpen(false);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function cancel(r: SalesPdRequestRow) {
    if (!window.confirm(`Cancel PD request ${r.code ?? ""}?`)) return;
    start(async () => {
      const res = await cancelPdRequest(r.id);
      if (res.ok) {
        success("PD request cancelled.");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const dash = <span className="text-muted-foreground">—</span>;
  const columns: Column<SalesPdRequestRow>[] = [
    { header: "PD No", cell: (r) => <span className="font-mono text-xs font-medium">{r.code ?? "—"}</span> },
    { header: "Date", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.created_at)}</span> },
    { header: "Customer", cell: (r) => r.buyer_name ?? dash },
    {
      header: "Style",
      cell: (r) =>
        r.style_name ? (
          <span>
            {r.style_name}
            {r.style_code ? <span className="text-muted-foreground"> ({r.style_code})</span> : null}
          </span>
        ) : (
          dash
        ),
    },
    { header: "Sample Type", cell: (r) => (r.sample_type ? r.sample_type.toUpperCase() : dash) },
    { header: "Sample Qty", align: "right", cell: (r) => (r.sample_qty != null ? <span className="tabular-nums">{fmtNumber(r.sample_qty)}</span> : dash) },
    { header: "Unit", cell: (r) => r.unit_code ?? dash },
    { header: "Deli Dt", cell: (r) => (r.delivery_date ? <span className="tabular-nums text-xs">{fmtDate(r.delivery_date)}</span> : dash) },
    { header: "Customer Ref", cell: (r) => r.customer_reference ?? dash },
    { header: "Stage", cell: (r) => <span className="text-xs text-muted-foreground">{humanize(r.stage)}</span> },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={STATUS_TONE[r.status] ?? "neutral"}>{humanize(r.status)}</StatusPill>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
          <Link href={`/planning/product-dev/${r.id}`} className="text-xs font-medium text-primary hover:underline">
            Planning
          </Link>
          {perms.canEdit && r.status === "open" && (
            <Button variant="outline" size="sm" disabled={isPending} onClick={() => cancel(r)}>
              Cancel
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Product Development Request"
        description="Raise product development requests against enquiries — they flow into Planning's PD pipeline."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/sales">
              <Button variant="outline" size="sm">
                ← Sales Pipeline
              </Button>
            </Link>
            {perms.canCreate && (
              <Button size="sm" onClick={openCreate}>
                Raise PD Request
              </Button>
            )}
          </div>
        }
      />

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search PD no, enquiry, customer, style, ref…"
        activeCount={status !== "all" ? 1 : 0}
        onReset={() => setStatus("all")}
        right={`${filtered.length} of ${requests.length}`}
      >
        <div>
          <Label htmlFor="flt-status">Status</Label>
          <Select id="flt-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            <option value="open">Open</option>
            <option value="closed">Closed</option>
            <option value="cancelled">Cancelled</option>
          </Select>
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        getKey={(r) => r.id}
        empty="No PD requests yet. Raise one against an enquiry to get started."
      />

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Raise PD Request"
        footer={
          <>
            <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button size="sm" onClick={save} disabled={isPending || !form.opportunity_id || !form.title.trim()}>
              {isPending ? "Requesting…" : "Raise Request"}
            </Button>
          </>
        }
      >
        <div className="space-y-4">
          <div>
            <Label htmlFor="pd-enq">Enquiry *</Label>
            <Select id="pd-enq" value={form.opportunity_id} onChange={(e) => onPickEnquiry(e.target.value)}>
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

          <div>
            <Label htmlFor="pd-title">Title *</Label>
            <Input id="pd-title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. SS26 Polo development" />
          </div>

          <div>
            <Label htmlFor="pd-style">Style</Label>
            <Select id="pd-style" value={form.style_id} onChange={(e) => set("style_id", e.target.value)} disabled={!form.opportunity_id}>
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
              <Label htmlFor="pd-sampletype">Sample Type</Label>
              <Select id="pd-sampletype" value={form.sample_type} onChange={(e) => set("sample_type", e.target.value as SampleType | "")}>
                <option value="">Select…</option>
                {SAMPLE_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t.toUpperCase()}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="pd-deli">Delivery Date</Label>
              <Input id="pd-deli" type="date" value={form.delivery_date} onChange={(e) => set("delivery_date", e.target.value)} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label htmlFor="pd-qty">Sample Qty</Label>
              <Input id="pd-qty" type="number" min={0} value={form.sample_qty} onChange={(e) => set("sample_qty", e.target.value)} placeholder="0" />
            </div>
            <div>
              <Label htmlFor="pd-unit">Unit</Label>
              <Select id="pd-unit" value={form.unit_id} onChange={(e) => set("unit_id", e.target.value)}>
                <option value="">Select…</option>
                {uoms.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.code}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div>
            <Label htmlFor="pd-ref">Customer Reference</Label>
            <Input id="pd-ref" value={form.customer_reference} onChange={(e) => set("customer_reference", e.target.value)} placeholder="Buyer's reference / PO" />
          </div>

          <div>
            <Label htmlFor="pd-desc">Description</Label>
            <Input id="pd-desc" value={form.description} onChange={(e) => set("description", e.target.value)} placeholder="Optional notes" />
          </div>
        </div>
      </Sheet>
    </div>
  );
}
