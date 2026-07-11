"use client";

import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Trash2, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Tabs } from "@/components/ui/tabs";
import { Card, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { PageHeader } from "@/components/ui/page-header";
import { useToast } from "@/components/ui/toast";
import { fmtDate } from "@/lib/format";
import { RecordPicker } from "@/components/masters/record-picker";
import {
  createProcessAmendment,
  updateProcessAmendment,
  deleteProcessAmendment,
} from "@/lib/orders/process-amendments/actions";
import type { GarmentProcessAmendment, GpaTab } from "@/lib/orders/process-amendments/types";
import type {
  GpaFormData,
  StyleRow,
} from "@/lib/orders/process-amendments/service";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };
interface Props {
  rows: GarmentProcessAmendment[];
  data: GpaFormData;
  perms: Perms;
}

type LineRow = { key: string; style_id: string | null };

const today = () => new Date().toISOString().slice(0, 10);

export function ProcessAmendmentScreen({ rows, data, perms }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [mode, setMode] = useState<"list" | "edit">("list");
  const [editId, setEditId] = useState<string | null>(null);
  const [amendDate, setAmendDate] = useState(() => today());
  const [customerId, setCustomerId] = useState<string | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [amendSno, setAmendSno] = useState("");
  const [orderNo, setOrderNo] = useState("");
  const [component, setComponent] = useState<LineRow[]>([]);
  const [garment, setGarment] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `k${keySeq.current++}`;

  const styleById = useMemo(() => {
    const m = new Map<string, StyleRow>();
    data.styles.forEach((s) => m.set(s.id, s));
    return m;
  }, [data.styles]);

  const buyerItems = useMemo(
    () => data.buyers.map((b) => ({ id: b.id, code: b.code, name: b.name })),
    [data.buyers],
  );
  const orderItems = useMemo(
    () => data.orders.map((o) => ({ id: o.id, code: o.order_number, name: o.order_number ?? "—" })),
    [data.orders],
  );
  const styleItems = useMemo(
    () => data.styles.map((s) => ({ id: s.id, code: s.code, name: s.style_name ?? "(unnamed)" })),
    [data.styles],
  );

  function openAdd() {
    setEditId(null);
    setAmendDate(today());
    setCustomerId(null);
    setOrderId(null);
    setAmendSno("");
    setOrderNo("");
    setComponent([{ key: newKey(), style_id: null }]);
    setGarment([{ key: newKey(), style_id: null }]);
    setMode("edit");
  }

  function openEdit(r: GarmentProcessAmendment) {
    setEditId(r.id);
    setAmendDate(r.amend_date ?? today());
    setCustomerId(r.customer_id);
    setOrderId(r.sales_order_id);
    setAmendSno(r.amend_sno != null ? String(r.amend_sno) : "");
    setOrderNo(r.order_no ?? "");
    setComponent(
      r.lines.filter((l) => l.tab === "component").map((l) => ({ key: newKey(), style_id: l.style_id })),
    );
    setGarment(
      r.lines.filter((l) => l.tab === "garment").map((l) => ({ key: newKey(), style_id: l.style_id })),
    );
    setMode("edit");
  }

  function onPickOrder(id: string | null) {
    setOrderId(id);
    // auto-fill Customer from the picked order's buyer (legacy behaviour)
    if (id) {
      const o = data.orders.find((x) => x.id === id);
      if (o?.buyer_id && !customerId) setCustomerId(o.buyer_id);
    }
  }

  function submit() {
    const lines = [
      ...component.map((r) => ({ tab: "component" as GpaTab, sno: 0, style_id: r.style_id })),
      ...garment.map((r) => ({ tab: "garment" as GpaTab, sno: 0, style_id: r.style_id })),
    ];
    const payload = {
      amend_date: amendDate,
      customer_id: customerId,
      sales_order_id: orderId,
      amend_sno: amendSno ? Number(amendSno) : null,
      order_no: orderNo || null,
      lines,
    };
    start(async () => {
      const res = editId
        ? await updateProcessAmendment(editId, payload)
        : await createProcessAmendment(payload);
      if (res.ok) {
        success(editId ? "Amendment updated" : "Amendment created");
        setMode("list");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function del(r: GarmentProcessAmendment) {
    if (!confirm(`Delete amendment ${r.code ?? ""}?`)) return;
    start(async () => {
      const res = await deleteProcessAmendment(r.id);
      if (res.ok) {
        success("Amendment deleted");
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  // ---------------- LIST ----------------
  if (mode === "list") {
    const columns: Column<GarmentProcessAmendment>[] = [
      {
        header: "Entry No",
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
      { header: "Date", cell: (r) => <span className="tabular-nums text-xs">{fmtDate(r.amend_date)}</span> },
      { header: "Customer", cell: (r) => <span className="text-sm">{r.customer?.name ?? "—"}</span> },
      {
        header: "SC No",
        cell: (r) => (
          <span className="font-mono text-xs">{r.sales_order?.order_number ?? "—"}</span>
        ),
      },
      { header: "Order No", cell: (r) => <span className="text-sm">{r.order_no ?? "—"}</span> },
      {
        header: "",
        align: "right",
        cell: (r) => (
          <div className="flex justify-end gap-1">
            {perms.canEdit && (
              <Button variant="outline" size="sm" onClick={() => openEdit(r)}>Edit</Button>
            )}
            {perms.canDelete && (
              <Button variant="outline" size="sm" onClick={() => del(r)}>Delete</Button>
            )}
          </div>
        ),
      },
    ];
    return (
      <div className="space-y-4">
        <PageHeader
          title="Garment Process Amendment"
          description="Amend the component / garment process of styles on an order."
          actions={perms.canCreate ? <Button onClick={openAdd}>New Amendment</Button> : undefined}
        />
        <DataTable columns={columns} rows={rows} getKey={(r) => r.id} empty="No amendments yet." />
      </div>
    );
  }

  // ---------------- EDIT ----------------
  return (
    <div className="space-y-4">
      <PageHeader
        title={editId ? "Edit Amendment" : "New Amendment"}
        description="Pick styles on the Component / Garment process tabs. Blank rows are ignored."
        actions={
          <Button variant="outline" size="sm" onClick={() => setMode("list")}>
            ← Back to list
          </Button>
        }
      />

      <Card>
        <CardBody className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div>
            <Label>Entry No</Label>
            <Input value={editId ? (rows.find((r) => r.id === editId)?.code ?? "") : "(auto)"} disabled />
          </div>
          <div>
            <Label htmlFor="gpa-date">Date *</Label>
            <Input id="gpa-date" type="date" value={amendDate} onChange={(e) => setAmendDate(e.target.value)} />
          </div>
          <RecordPicker label="Customer" items={buyerItems} value={customerId} onChange={setCustomerId} />
          <RecordPicker label="SC No" items={orderItems} value={orderId} onChange={onPickOrder} />
          <div>
            <Label htmlFor="gpa-sno">Amend S No</Label>
            <Input id="gpa-sno" type="number" value={amendSno} onChange={(e) => setAmendSno(e.target.value)} />
          </div>
          <div>
            <Label htmlFor="gpa-order">Order No</Label>
            <Input id="gpa-order" value={orderNo} onChange={(e) => setOrderNo(e.target.value)} />
          </div>
        </CardBody>
      </Card>

      <Tabs
        items={[
          {
            key: "component",
            label: "Component Process",
            content: (
              <StyleGrid
                title="Component Process Details"
                rows={component}
                setRows={setComponent}
                styleItems={styleItems}
                styleById={styleById}
                newKey={newKey}
              />
            ),
          },
          {
            key: "garment",
            label: "Garment Process",
            content: (
              <StyleGrid
                title="Garment Process Details"
                rows={garment}
                setRows={setGarment}
                styleItems={styleItems}
                styleById={styleById}
                newKey={newKey}
              />
            ),
          },
        ]}
        defaultKey="component"
      />

      <div className="sticky bottom-0 flex justify-end gap-2 border-t border-border bg-surface/95 py-3 backdrop-blur">
        <Button variant="outline" onClick={() => setMode("list")}>Cancel</Button>
        <Button disabled={isPending || !amendDate} onClick={submit}>
          {isPending ? "Saving…" : "Save"}
        </Button>
      </div>
    </div>
  );
}

function StyleGrid({
  title,
  rows,
  setRows,
  styleItems,
  styleById,
  newKey,
}: {
  title: string;
  rows: LineRow[];
  setRows: React.Dispatch<React.SetStateAction<LineRow[]>>;
  styleItems: { id: string; code: string | null; name: string }[];
  styleById: Map<string, StyleRow>;
  newKey: () => string;
}) {
  return (
    <Card>
      <CardBody>
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-foreground">{title}</h3>
          <Button
            type="button"
            variant="subtle"
            size="sm"
            onClick={() => setRows((xs) => [...xs, { key: newKey(), style_id: null }])}
          >
            <Plus className="mr-1 h-3.5 w-3.5" /> Add row
          </Button>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-muted text-xs text-muted-foreground">
                <th className="w-12 px-3 py-1.5 text-left font-medium">S No</th>
                <th className="px-3 py-1.5 text-left font-medium">Style Ref No</th>
                <th className="px-3 py-1.5 text-left font-medium">Style</th>
                <th className="px-3 py-1.5 text-left font-medium">Article No</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {rows.map((r, i) => {
                const st = r.style_id ? styleById.get(r.style_id) : undefined;
                return (
                  <tr key={r.key} className="border-b border-border last:border-0">
                    <td className="px-3 py-1 text-xs text-muted-foreground">{i + 1}</td>
                    <td className="px-3 py-1">
                      <RecordPicker
                        label="Style Ref No"
                        items={styleItems}
                        value={r.style_id}
                        onChange={(id) =>
                          setRows((xs) => xs.map((x) => (x.key === r.key ? { ...x, style_id: id } : x)))
                        }
                        compact
                      />
                    </td>
                    <td className="px-3 py-1 text-sm">{st?.style_name ?? "—"}</td>
                    <td className="px-3 py-1 text-sm text-muted-foreground">{st?.article_no ?? "—"}</td>
                    <td className="px-2 py-1">
                      <button
                        type="button"
                        onClick={() => setRows((xs) => xs.filter((x) => x.key !== r.key))}
                        aria-label="Remove row"
                        className="flex h-7 w-7 items-center justify-center rounded-md text-muted-foreground hover:bg-surface-muted hover:text-danger"
                      >
                        <Trash2 className="h-4 w-4" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </CardBody>
    </Card>
  );
}
