"use client";

import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { useToast } from "@/components/ui/toast";
import { fmtMoney } from "@/lib/format";
import {
  saveIocStyleCost,
  saveIocFabricRate,
  saveIocOtherExpense,
  deleteIocRow,
} from "@/lib/sales/ioc-actions";
import type {
  IocCostingData,
  IocStyleCost,
  IocFabricRate,
  IocOtherExpense,
  IocBudget,
} from "@/lib/sales/types";

interface Props {
  data: IocCostingData;
  costSheetId: string;
  opportunityId: string;
  currency?: string | null;
  canEdit?: boolean;
}

// ---------------------------------------------------------------------------
// Style Costs Summary Tab
// ---------------------------------------------------------------------------

function StyleCostsSummaryTab({ styleCosts, costSheetId, opportunityId, currency, canEdit }: {
  styleCosts: IocStyleCost[]; costSheetId: string; opportunityId: string; currency?: string | null; canEdit?: boolean;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ style_ref_no: "", style_no: "", article_no: "", uom_id: "", order_qty: "" });

  function addRow() {
    startTransition(async () => {
      const res = await saveIocStyleCost(costSheetId, opportunityId, {
        sno: styleCosts.length + 1,
        style_ref_no: form.style_ref_no || null,
        style_no: form.style_no || null,
        article_no: form.article_no || null,
        uom_id: form.uom_id || null,
        order_qty: form.order_qty ? Number(form.order_qty) : null,
      });
      if (res.ok) { success("Style cost added."); setAdding(false); setForm({ style_ref_no: "", style_no: "", article_no: "", uom_id: "", order_qty: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  function removeRow(id: string) {
    startTransition(async () => {
      const res = await deleteIocRow("ioc_style_costs", id, opportunityId);
      if (res.ok) { success("Removed."); router.refresh(); } else error(res.error);
    });
  }

  const columns: Column<IocStyleCost>[] = [
    { header: "#", cell: (r) => r.sno },
    { header: "Style Ref", cell: (r) => r.style_ref_no ?? "—" },
    { header: "Style No", cell: (r) => r.style_no ?? "—" },
    { header: "Article", cell: (r) => r.article_no ?? "—" },
    { header: "Order Qty", align: "right", cell: (r) => <span className="tabular-nums">{r.order_qty ?? "—"}</span> },
    { header: "Fabric", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.fabric_cost, currency)}</span> },
    { header: "Trims", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.trims_cost, currency)}</span> },
    { header: "CMT", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.cmt_cost, currency)}</span> },
    { header: "Total", align: "right", cell: (r) => <span className="tabular-nums font-semibold">{fmtMoney(r.expenses_total, currency)}</span> },
    { header: "P/L %", align: "right", cell: (r) => <span className={`tabular-nums ${r.profit_loss_pct >= 0 ? "text-green-600" : "text-red-600"}`}>{r.profit_loss_pct.toFixed(1)}%</span> },
    ...(canEdit ? [{ header: "" as const, align: "right" as const, cell: (r: IocStyleCost) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => removeRow(r.id)} disabled={isPending}>x</Button> }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Cost Summary by Style</h3>
        {canEdit && <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add Style Cost"}</Button>}
      </div>
      {adding && (
        <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
          <div><Label>Style Ref</Label><Input className="w-24" value={form.style_ref_no} onChange={(e) => setForm({ ...form, style_ref_no: e.target.value })} /></div>
          <div><Label>Style No</Label><Input className="w-24" value={form.style_no} onChange={(e) => setForm({ ...form, style_no: e.target.value })} /></div>
          <div><Label>Article</Label><Input className="w-24" value={form.article_no} onChange={(e) => setForm({ ...form, article_no: e.target.value })} /></div>
          <div><Label>UOM</Label><Input className="w-16" value={form.uom_id} onChange={(e) => setForm({ ...form, uom_id: e.target.value })} /></div>
          <div><Label>Order Qty</Label><Input className="w-24" type="number" value={form.order_qty} onChange={(e) => setForm({ ...form, order_qty: e.target.value })} /></div>
          <Button size="sm" disabled={isPending} onClick={addRow}>{isPending ? "Adding…" : "Add"}</Button>
        </div>
      )}
      <DataTable columns={columns} rows={styleCosts} getKey={(r) => r.id} empty="No style costs added yet." />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fabric Rates Tab
// ---------------------------------------------------------------------------

function FabricRatesTab({ fabricRates, costSheetId, opportunityId, currency, canEdit }: {
  fabricRates: IocFabricRate[]; costSheetId: string; opportunityId: string; currency?: string | null; canEdit?: boolean;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ fabric_description: "", structure_name: "", composition_name: "", gsm: "", fabric_rate_without_loss: "", process_loss_pct: "" });

  function addRow() {
    const rateNoLoss = Number(form.fabric_rate_without_loss) || 0;
    const lossPct = Number(form.process_loss_pct) || 0;
    startTransition(async () => {
      const res = await saveIocFabricRate(costSheetId, opportunityId, {
        sno: fabricRates.length + 1,
        fabric_description: form.fabric_description || null,
        structure_name: form.structure_name || null,
        composition_name: form.composition_name || null,
        gsm: form.gsm ? Number(form.gsm) : null,
        fabric_rate_without_loss: rateNoLoss,
        process_loss_pct: lossPct,
        fabric_rate: Math.round(rateNoLoss * (1 + lossPct / 100) * 10000) / 10000,
      });
      if (res.ok) { success("Fabric rate added."); setAdding(false); setForm({ fabric_description: "", structure_name: "", composition_name: "", gsm: "", fabric_rate_without_loss: "", process_loss_pct: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  function removeRow(id: string) {
    startTransition(async () => {
      const res = await deleteIocRow("ioc_fabric_rates", id, opportunityId);
      if (res.ok) { success("Removed."); router.refresh(); } else error(res.error);
    });
  }

  const columns: Column<IocFabricRate>[] = [
    { header: "#", cell: (r) => r.sno },
    { header: "Fabric", cell: (r) => r.fabric_description ?? "—" },
    { header: "Structure", cell: (r) => r.structure_name ?? "—" },
    { header: "Composition", cell: (r) => r.composition_name ?? "—" },
    { header: "GSM", align: "right", cell: (r) => r.gsm ?? "—" },
    { header: "Rate (w/o loss)", align: "right", cell: (r) => <span className="tabular-nums">{r.fabric_rate_without_loss.toFixed(2)}</span> },
    { header: "Loss %", align: "right", cell: (r) => <span className="tabular-nums">{r.process_loss_pct.toFixed(1)}%</span> },
    { header: "Fabric Rate", align: "right", cell: (r) => <span className="tabular-nums font-semibold">{r.fabric_rate.toFixed(2)}</span> },
    ...(canEdit ? [{ header: "" as const, align: "right" as const, cell: (r: IocFabricRate) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => removeRow(r.id)} disabled={isPending}>x</Button> }] : []),
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Fabric Rate Master</h3>
        {canEdit && <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add Fabric Rate"}</Button>}
      </div>
      {adding && (
        <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
          <div><Label>Fabric</Label><Input className="w-32" value={form.fabric_description} onChange={(e) => setForm({ ...form, fabric_description: e.target.value })} /></div>
          <div><Label>Structure</Label><Input className="w-24" value={form.structure_name} onChange={(e) => setForm({ ...form, structure_name: e.target.value })} /></div>
          <div><Label>Composition</Label><Input className="w-24" value={form.composition_name} onChange={(e) => setForm({ ...form, composition_name: e.target.value })} /></div>
          <div><Label>GSM</Label><Input className="w-16" type="number" value={form.gsm} onChange={(e) => setForm({ ...form, gsm: e.target.value })} /></div>
          <div><Label>Rate (w/o loss)</Label><Input className="w-24" type="number" value={form.fabric_rate_without_loss} onChange={(e) => setForm({ ...form, fabric_rate_without_loss: e.target.value })} /></div>
          <div><Label>Loss %</Label><Input className="w-16" type="number" value={form.process_loss_pct} onChange={(e) => setForm({ ...form, process_loss_pct: e.target.value })} /></div>
          <Button size="sm" disabled={isPending} onClick={addRow}>{isPending ? "Adding…" : "Add"}</Button>
        </div>
      )}
      <DataTable columns={columns} rows={fabricRates} getKey={(r) => r.id} empty="No fabric rates defined." />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Other Expenses Tab
// ---------------------------------------------------------------------------

function OtherExpensesTab({ expenses, costSheetId, opportunityId, currency, canEdit }: {
  expenses: IocOtherExpense[]; costSheetId: string; opportunityId: string; currency?: string | null; canEdit?: boolean;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [adding, setAdding] = useState(false);
  const [form, setForm] = useState({ cost_short_name: "", item_description: "", type_for: "", rate_type: "", cons_qty: "", rate: "" });

  function addRow() {
    const qty = Number(form.cons_qty) || 0;
    const rate = Number(form.rate) || 0;
    startTransition(async () => {
      const res = await saveIocOtherExpense(costSheetId, opportunityId, {
        sno: expenses.length + 1,
        cost_short_name: form.cost_short_name || null,
        item_description: form.item_description || null,
        type_for: form.type_for || null,
        rate_type: form.rate_type || null,
        cons_qty: qty,
        rate,
        cost: Math.round(qty * rate * 100) / 100,
      });
      if (res.ok) { success("Expense added."); setAdding(false); setForm({ cost_short_name: "", item_description: "", type_for: "", rate_type: "", cons_qty: "", rate: "" }); router.refresh(); }
      else error(res.error);
    });
  }

  function removeRow(id: string) {
    startTransition(async () => {
      const res = await deleteIocRow("ioc_other_expenses", id, opportunityId);
      if (res.ok) { success("Removed."); router.refresh(); } else error(res.error);
    });
  }

  const columns: Column<IocOtherExpense>[] = [
    { header: "#", cell: (r) => r.sno },
    { header: "Cost Head", cell: (r) => r.cost_short_name ?? "—" },
    { header: "Description", cell: (r) => r.item_description ?? r.cost_description ?? "—" },
    { header: "Type", cell: (r) => r.type_for === "O" ? "Overall" : r.type_for === "S" ? "Per Style" : "—" },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums">{r.cons_qty || "—"}</span> },
    { header: "Rate", align: "right", cell: (r) => <span className="tabular-nums">{r.rate.toFixed(2)}</span> },
    { header: "Cost", align: "right", cell: (r) => <span className="tabular-nums font-semibold">{fmtMoney(r.cost, currency)}</span> },
    ...(canEdit ? [{ header: "" as const, align: "right" as const, cell: (r: IocOtherExpense) => <Button variant="ghost" size="sm" className="text-red-600" onClick={() => removeRow(r.id)} disabled={isPending}>x</Button> }] : []),
  ];

  const total = expenses.reduce((sum, e) => sum + e.cost, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h3 className="text-sm font-semibold text-foreground">Other Expenses</h3>
        {canEdit && <Button variant="outline" size="sm" onClick={() => setAdding(!adding)}>{adding ? "Cancel" : "+ Add Expense"}</Button>}
      </div>
      {adding && (
        <div className="flex gap-2 items-end flex-wrap rounded border border-border p-3">
          <div><Label>Cost Head</Label><Input className="w-24" value={form.cost_short_name} onChange={(e) => setForm({ ...form, cost_short_name: e.target.value })} /></div>
          <div><Label>Description</Label><Input className="w-32" value={form.item_description} onChange={(e) => setForm({ ...form, item_description: e.target.value })} /></div>
          <div><Label>Type</Label><Select className="w-24" value={form.type_for} onChange={(e) => setForm({ ...form, type_for: e.target.value })}><option value="">—</option><option value="O">Overall</option><option value="S">Per Style</option></Select></div>
          <div><Label>Rate Type</Label><Select className="w-20" value={form.rate_type} onChange={(e) => setForm({ ...form, rate_type: e.target.value })}><option value="">—</option><option value="Q">Qty</option><option value="F">Fixed</option><option value="P">%</option></Select></div>
          <div><Label>Qty</Label><Input className="w-20" type="number" value={form.cons_qty} onChange={(e) => setForm({ ...form, cons_qty: e.target.value })} /></div>
          <div><Label>Rate</Label><Input className="w-20" type="number" value={form.rate} onChange={(e) => setForm({ ...form, rate: e.target.value })} /></div>
          <Button size="sm" disabled={isPending} onClick={addRow}>{isPending ? "Adding…" : "Add"}</Button>
        </div>
      )}
      <DataTable columns={columns} rows={expenses} getKey={(r) => r.id} empty="No other expenses added." />
      {expenses.length > 0 && <div className="flex justify-end text-sm font-semibold">Total: {fmtMoney(total, currency)}</div>}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget Summary Tab (read-only — populated from IOC calculations)
// ---------------------------------------------------------------------------

function BudgetSummaryTab({ budgets, currency }: { budgets: IocBudget[]; currency?: string | null }) {
  const columns: Column<IocBudget>[] = [
    { header: "#", cell: (r) => r.sno },
    { header: "Cost Head", cell: (r) => r.cost_short_name ?? "—" },
    { header: "Description", cell: (r) => r.cost_description ?? "—" },
    { header: "By Us", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.by_us_cost, currency)}</span> },
    { header: "By Vendor", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.by_vendor_cost, currency)}</span> },
    { header: "Total", align: "right", cell: (r) => <span className="tabular-nums font-semibold">{fmtMoney(r.cost, currency)}</span> },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Budget Summary</h3>
      <DataTable columns={columns} rows={budgets} getKey={(r) => r.id} empty="No budget entries." />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main IOC Costing Tabs Component
// ---------------------------------------------------------------------------

export function IocCostingTabs({ data, costSheetId, opportunityId, currency, canEdit = false }: Props) {
  const { style_costs, fabric_rates, other_expenses, budgets } = data;

  const totalFabric = useMemo(() => style_costs.reduce((s, c) => s + c.fabric_cost, 0), [style_costs]);
  const totalTrims = useMemo(() => style_costs.reduce((s, c) => s + c.trims_cost, 0), [style_costs]);
  const totalCmt = useMemo(() => style_costs.reduce((s, c) => s + c.cmt_cost, 0), [style_costs]);
  const totalGarment = useMemo(() => style_costs.reduce((s, c) => s + c.garment_process_cost, 0), [style_costs]);
  const totalExpenses = useMemo(() => other_expenses.reduce((s, e) => s + e.cost, 0), [other_expenses]);
  const grossCost = totalFabric + totalTrims + totalCmt + totalGarment + totalExpenses;

  const items = [
    {
      key: "summary",
      label: `Summary (${style_costs.length})`,
      content: <StyleCostsSummaryTab styleCosts={style_costs} costSheetId={costSheetId} opportunityId={opportunityId} currency={currency} canEdit={canEdit} />,
    },
    {
      key: "fabric-rates",
      label: `Fabric Rates (${fabric_rates.length})`,
      content: <FabricRatesTab fabricRates={fabric_rates} costSheetId={costSheetId} opportunityId={opportunityId} currency={currency} canEdit={canEdit} />,
    },
    {
      key: "other-expenses",
      label: `Other Expenses (${other_expenses.length})`,
      content: <OtherExpensesTab expenses={other_expenses} costSheetId={costSheetId} opportunityId={opportunityId} currency={currency} canEdit={canEdit} />,
    },
    {
      key: "budget",
      label: `Budget (${budgets.length})`,
      content: <BudgetSummaryTab budgets={budgets} currency={currency} />,
    },
  ];

  return (
    <div className="space-y-4">
      {/* Cost totals strip */}
      <div className="flex flex-wrap gap-x-5 gap-y-1 rounded-lg border border-border bg-surface px-4 py-2.5 text-xs">
        <div><span className="text-muted-foreground">Fabric:</span> <span className="tabular-nums font-medium">{fmtMoney(totalFabric, currency)}</span></div>
        <div><span className="text-muted-foreground">Trims:</span> <span className="tabular-nums font-medium">{fmtMoney(totalTrims, currency)}</span></div>
        <div><span className="text-muted-foreground">CMT:</span> <span className="tabular-nums font-medium">{fmtMoney(totalCmt, currency)}</span></div>
        <div><span className="text-muted-foreground">Garment:</span> <span className="tabular-nums font-medium">{fmtMoney(totalGarment, currency)}</span></div>
        <div><span className="text-muted-foreground">Other:</span> <span className="tabular-nums font-medium">{fmtMoney(totalExpenses, currency)}</span></div>
        <div className="ml-auto"><span className="text-muted-foreground">Gross Cost:</span> <span className="tabular-nums font-semibold">{fmtMoney(grossCost, currency)}</span></div>
      </div>

      <Tabs items={items} />
    </div>
  );
}
