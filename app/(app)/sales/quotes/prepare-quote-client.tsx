"use client";

import { useMemo, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/page-header";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { FilterBar } from "@/components/masters/filter-bar";
import { useToast } from "@/components/ui/toast";
import { fmtNumber, fmtDate } from "@/lib/format";
import { RecordPicker } from "@/components/masters/record-picker";
import { CurrencyPicker } from "@/components/masters/currency-picker";
import {
  createQuoteCosting,
  updateQuoteCosting,
  deleteQuoteCosting,
} from "@/lib/sales/quote-costings/actions";
import {
  computeRollup,
  QC_STATUSES,
  QC_STATUS_LABELS,
  qcStatusTone,
  type QuoteCosting,
} from "@/lib/sales/quote-costings/types";
import type { QuoteCostingFormData, PickerRow } from "@/lib/sales/quote-costings/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

interface Props {
  rows: QuoteCosting[];
  data: QuoteCostingFormData;
  perms: Perms;
  /** masters:create/edit — gates inline Add/Modify inside the Currency picker. */
  masterPerms: { canCreate: boolean; canEdit: boolean };
}

type Form = {
  costing_date: string;
  opportunity_id: string | null;
  customer_id: string | null;
  style_id: string | null;
  currency_code: string | null;
  weight: string;
  fabric_cost: string;
  trims_cost: string;
  cmt_cost: string;
  garment_process_cost: string;
  other_expenses: string;
  garment_waste_pct: string;
  margin_pct: string;
  notes: string;
};

const today = () => new Date().toISOString().slice(0, 10);

const BLANK: Form = {
  costing_date: "",
  opportunity_id: null,
  customer_id: null,
  style_id: null,
  currency_code: null,
  weight: "",
  fabric_cost: "",
  trims_cost: "",
  cmt_cost: "",
  garment_process_cost: "",
  other_expenses: "",
  garment_waste_pct: "",
  margin_pct: "",
  notes: "",
};

const n = (v: string) => Number(v) || 0;
const numOrNull = (v: string) => (v.trim() ? Number(v) : null);

export function PrepareQuoteClient({ rows, data, perms, masterPerms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [search, setSearch] = useState("");
  const [statusF, setStatusF] = useState<"all" | string>("all");
  const [customerF, setCustomerF] = useState<"all" | string>("all");
  const [currencyF, setCurrencyF] = useState<"all" | string>("all");

  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState<string | null>(null);
  const [form, setForm] = useState<Form>(BLANK);
  const set = (patch: Partial<Form>) => setForm((f) => ({ ...f, ...patch }));

  const buyerName = useMemo(() => {
    const m = new Map<string, string>();
    for (const b of data.buyers) m.set(b.id, b.name);
    return m;
  }, [data.buyers]);

  // Live roll-up preview for the editor.
  const rollup = computeRollup({
    fabric_cost: n(form.fabric_cost),
    trims_cost: n(form.trims_cost),
    cmt_cost: n(form.cmt_cost),
    garment_process_cost: n(form.garment_process_cost),
    other_expenses: n(form.other_expenses),
    garment_waste_pct: n(form.garment_waste_pct),
    margin_pct: n(form.margin_pct),
  });

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusF !== "all" && r.status !== statusF) return false;
      if (customerF !== "all" && r.customer_id !== customerF) return false;
      if (currencyF !== "all" && r.currency_code !== currencyF) return false;
      if (q) {
        const hay = [r.code, r.customer?.name, r.style?.style_name, r.opportunity?.code]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [rows, search, statusF, customerF, currencyF]);

  const activeCount =
    (statusF !== "all" ? 1 : 0) + (customerF !== "all" ? 1 : 0) + (currencyF !== "all" ? 1 : 0);

  /** Picking an Enquiry prefills the currency (like the Cost Sheet screen). */
  function onPickEnquiry(id: string | null) {
    if (!id) {
      set({ opportunity_id: null });
      return;
    }
    const enq = data.enquiries.find((e) => e.id === id);
    set({
      opportunity_id: id,
      currency_code: enq?.currency_code ?? form.currency_code,
    });
  }

  function openAdd() {
    setEditId(null);
    setEditCode(null);
    setForm({ ...BLANK, costing_date: today() });
    setOpen(true);
  }

  function openEdit(r: QuoteCosting) {
    setEditId(r.id);
    setEditCode(r.code);
    setForm({
      costing_date: r.costing_date ?? today(),
      opportunity_id: r.opportunity_id,
      customer_id: r.customer_id,
      style_id: r.style_id,
      currency_code: r.currency_code,
      weight: r.weight ? String(r.weight) : "",
      fabric_cost: r.fabric_cost ? String(r.fabric_cost) : "",
      trims_cost: r.trims_cost ? String(r.trims_cost) : "",
      cmt_cost: r.cmt_cost ? String(r.cmt_cost) : "",
      garment_process_cost: r.garment_process_cost ? String(r.garment_process_cost) : "",
      other_expenses: r.other_expenses ? String(r.other_expenses) : "",
      garment_waste_pct: r.garment_waste_pct ? String(r.garment_waste_pct) : "",
      margin_pct: r.margin_pct ? String(r.margin_pct) : "",
      notes: r.notes ?? "",
    });
    setOpen(true);
  }

  function submit(status: "draft" | "finalised") {
    const payload = {
      status,
      costing_date: form.costing_date,
      opportunity_id: form.opportunity_id,
      customer_id: form.customer_id,
      style_id: form.style_id,
      currency_code: form.currency_code,
      weight: numOrNull(form.weight) ?? 0,
      fabric_cost: numOrNull(form.fabric_cost) ?? 0,
      trims_cost: numOrNull(form.trims_cost) ?? 0,
      cmt_cost: numOrNull(form.cmt_cost) ?? 0,
      garment_process_cost: numOrNull(form.garment_process_cost) ?? 0,
      other_expenses: numOrNull(form.other_expenses) ?? 0,
      garment_waste_pct: numOrNull(form.garment_waste_pct) ?? 0,
      margin_pct: numOrNull(form.margin_pct) ?? 0,
      notes: form.notes || null,
    };
    start(async () => {
      const res = editId
        ? await updateQuoteCosting(editId, payload)
        : await createQuoteCosting(payload);
      if (res.ok) {
        success(editId ? "Costing updated" : "Costing created");
        setOpen(false);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: QuoteCosting) {
    if (!confirm(`Delete costing ${r.code ?? ""}?`)) return;
    start(async () => {
      const res = await deleteQuoteCosting(r.id);
      if (res.ok) {
        success("Costing deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const dash = <span className="text-muted-foreground">—</span>;
  const money = (v: number) => <span className="tabular-nums">{fmtNumber(v)}</span>;

  const columns: Column<QuoteCosting>[] = [
    {
      header: "Costing No",
      cell: (r) => (
        <button
          type="button"
          onClick={() => perms.canEdit && openEdit(r)}
          className="font-mono text-xs font-medium text-primary hover:underline"
        >
          {r.code ?? "—"}
        </button>
      ),
    },
    { header: "Costing Dt", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.costing_date)}</span> },
    { header: "Customer", cell: (r) => r.customer?.name ?? dash },
    { header: "Style No", cell: (r) => (r.style ? (r.style.code ?? r.style.style_name ?? dash) : dash) },
    { header: "Wt", align: "right", cell: (r) => money(r.weight) },
    { header: "Fabric", align: "right", cell: (r) => money(r.fabric_cost) },
    { header: "Trims", align: "right", cell: (r) => money(r.trims_cost) },
    { header: "CMT", align: "right", cell: (r) => money(r.cmt_cost) },
    { header: "Gmt Proc", align: "right", cell: (r) => money(r.garment_process_cost) },
    { header: "Other Exp", align: "right", cell: (r) => money(r.other_expenses) },
    { header: "Gross", align: "right", cell: (r) => <span className="font-medium">{money(r.gross_cost)}</span> },
    { header: "Waste %", align: "right", cell: (r) => money(r.garment_waste_pct) },
    { header: "Waste", align: "right", cell: (r) => money(r.garment_waste_amt) },
    { header: "Total", align: "right", cell: (r) => <span className="font-medium">{money(r.total_cost)}</span> },
    { header: "Margin %", align: "right", cell: (r) => money(r.margin_pct) },
    {
      header: "FOB INR",
      align: "right",
      cell: (r) => <span className="font-semibold text-primary">{money(r.fob_value)}</span>,
    },
    {
      header: "Status",
      cell: (r) => <StatusPill tone={qcStatusTone(r.status)}>{QC_STATUS_LABELS[r.status]}</StatusPill>,
    },
    {
      header: "",
      align: "right",
      cell: (r) => (
        <div className="flex justify-end gap-1 whitespace-nowrap">
          {perms.canEdit && (
            <Button variant="outline" size="sm" onClick={() => openEdit(r)}>
              Edit
            </Button>
          )}
          {perms.canDelete && (
            <Button variant="outline" size="sm" onClick={() => del(r)}>
              Delete
            </Button>
          )}
        </div>
      ),
    },
  ];

  const cur = form.currency_code || "";

  return (
    <div className="space-y-4">
      <PageHeader
        title="Quote Preparation"
        description="Garment costing sheets — cost buckets roll up to Gross, Waste, Total, Margin & FOB, by Costing No."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/sales">
              <Button variant="outline" size="sm">
                ← Sales Pipeline
              </Button>
            </Link>
            {perms.canCreate && (
              <Button size="sm" onClick={() => (open ? setOpen(false) : openAdd())}>
                {open ? "Cancel" : "Prepare Quote"}
              </Button>
            )}
          </div>
        }
      />

      {open && perms.canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>{editId ? `Edit Costing ${editCode ?? ""}` : "New Costing"}</CardTitle>
            <span className="text-sm font-medium text-foreground">
              FOB {cur}: <span className="tabular-nums text-primary">{fmtNumber(rollup.fob_value)}</span>
            </span>
          </CardHeader>
          <CardBody className="space-y-4">
            {/* Header pickers */}
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              <div>
                <Label htmlFor="qc-date">Costing Dt *</Label>
                <Input id="qc-date" type="date" value={form.costing_date} onChange={(e) => set({ costing_date: e.target.value })} />
              </div>
              <RecordPicker
                label="Enquiry No"
                items={data.enquiries as PickerRow[]}
                value={form.opportunity_id}
                onChange={onPickEnquiry}
              />
              <RecordPicker
                label="Customer"
                items={data.buyers}
                value={form.customer_id}
                onChange={(id) => set({ customer_id: id })}
              />
              <RecordPicker
                label="Style No"
                items={data.styles}
                value={form.style_id}
                onChange={(id) => set({ style_id: id })}
              />
              <CurrencyPicker
                label="Currency"
                currencies={data.currencies}
                value={form.currency_code}
                onChange={(code) => set({ currency_code: code })}
                canCreate={masterPerms.canCreate}
                canEdit={masterPerms.canEdit}
              />
              <div>
                <Label htmlFor="qc-wt">Wt</Label>
                <Input id="qc-wt" type="number" value={form.weight} onChange={(e) => set({ weight: e.target.value })} />
              </div>
            </div>

            {/* Cost buckets + live roll-up */}
            <div className="overflow-x-auto rounded-lg border border-border">
              <table className="w-full min-w-[720px] text-sm">
                <tbody>
                  <tr className="border-b border-border">
                    <BucketCell label="Fabric" value={form.fabric_cost} onChange={(v) => set({ fabric_cost: v })} />
                    <BucketCell label="Trims" value={form.trims_cost} onChange={(v) => set({ trims_cost: v })} />
                    <BucketCell label="CMT" value={form.cmt_cost} onChange={(v) => set({ cmt_cost: v })} />
                  </tr>
                  <tr className="border-b border-border">
                    <BucketCell label="Garment Process" value={form.garment_process_cost} onChange={(v) => set({ garment_process_cost: v })} />
                    <BucketCell label="Other Expenses" value={form.other_expenses} onChange={(v) => set({ other_expenses: v })} />
                    <TotalCell label="Gross Cost" value={rollup.gross_cost} />
                  </tr>
                  <tr className="border-b border-border">
                    <BucketCell label="Garment Waste %" value={form.garment_waste_pct} onChange={(v) => set({ garment_waste_pct: v })} />
                    <TotalCell label="Garment Waste" value={rollup.garment_waste_amt} />
                    <TotalCell label="Total Cost" value={rollup.total_cost} strong />
                  </tr>
                  <tr>
                    <BucketCell label="Margin %" value={form.margin_pct} onChange={(v) => set({ margin_pct: v })} />
                    <td className="px-3 py-2" />
                    <TotalCell label="FOB INR" value={rollup.fob_value} strong />
                  </tr>
                </tbody>
              </table>
            </div>

            <div>
              <Label htmlFor="qc-notes">Notes</Label>
              <Input id="qc-notes" value={form.notes} onChange={(e) => set({ notes: e.target.value })} placeholder="Optional notes" />
            </div>

            <div className="flex justify-end gap-2">
              <Button variant="outline" size="sm" onClick={() => setOpen(false)}>
                Cancel
              </Button>
              <Button variant="outline" size="sm" disabled={isPending || !form.costing_date} onClick={() => submit("draft")}>
                Save as Draft
              </Button>
              <Button size="sm" disabled={isPending || !form.costing_date} onClick={() => submit("finalised")}>
                {isPending ? "Saving…" : "Save"}
              </Button>
            </div>
          </CardBody>
        </Card>
      )}

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search costing no, customer, style, enquiry…"
        activeCount={activeCount}
        onReset={() => {
          setStatusF("all");
          setCustomerF("all");
          setCurrencyF("all");
        }}
        right={`${filtered.length} of ${rows.length}`}
      >
        <div>
          <Label htmlFor="flt-status">Status</Label>
          <Select id="flt-status" value={statusF} onChange={(e) => setStatusF(e.target.value)}>
            <option value="all">All</option>
            {QC_STATUSES.map((s) => (
              <option key={s} value={s}>{QC_STATUS_LABELS[s]}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="flt-cust">Customer</Label>
          <Select id="flt-cust" value={customerF} onChange={(e) => setCustomerF(e.target.value)}>
            <option value="all">All</option>
            {data.buyers.map((b) => (
              <option key={b.id} value={b.id}>{buyerName.get(b.id) ?? b.name}</option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="flt-cur">Currency</Label>
          <Select id="flt-cur" value={currencyF} onChange={(e) => setCurrencyF(e.target.value)}>
            <option value="all">All</option>
            {data.currencies.map((c) => (
              <option key={c.code} value={c.code}>{c.code}</option>
            ))}
          </Select>
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        getKey={(r) => r.id}
        empty="No costings yet. Use 'Prepare Quote' to create the first."
      />
    </div>
  );
}

/** An editable cost-bucket cell (label + numeric input). */
function BucketCell({
  label,
  value,
  onChange,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <td className="px-3 py-2 align-middle">
      <Label className="text-xs text-muted-foreground">{label}</Label>
      <Input type="number" value={value} onChange={(e) => onChange(e.target.value)} className="h-8 text-right" />
    </td>
  );
}

/** A read-only computed roll-up cell. */
function TotalCell({ label, value, strong }: { label: string; value: number; strong?: boolean }) {
  return (
    <td className="bg-surface-muted px-3 py-2 align-middle">
      <span className="text-xs text-muted-foreground">{label}</span>
      <div className={"text-right tabular-nums " + (strong ? "text-base font-semibold text-primary" : "font-medium")}>
        {fmtNumber(value)}
      </div>
    </td>
  );
}
