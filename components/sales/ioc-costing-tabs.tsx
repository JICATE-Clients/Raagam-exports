"use client";

import { useMemo } from "react";
import { Tabs } from "@/components/ui/tabs";
import { DataTable, type Column } from "@/components/ui/data-table";
import { fmtMoney } from "@/lib/format";
import type {
  IocCostingData,
  IocStyleCost,
  IocFabricRate,
  IocOtherExpense,
  IocBudget,
} from "@/lib/sales/types";

interface Props {
  data: IocCostingData;
  currency?: string | null;
}

// ---------------------------------------------------------------------------
// Style Costs Summary Tab
// ---------------------------------------------------------------------------

function StyleCostsSummaryTab({ styleCosts, currency }: { styleCosts: IocStyleCost[]; currency?: string | null }) {
  const columns: Column<IocStyleCost>[] = [
    { header: "#", cell: (r) => r.sno },
    { header: "Style Ref", cell: (r) => r.style_ref_no ?? "—" },
    { header: "Style No", cell: (r) => r.style_no ?? "—" },
    { header: "Article", cell: (r) => r.article_no ?? "—" },
    { header: "UOM", cell: (r) => r.uom_id ?? "—" },
    { header: "Order Qty", align: "right", cell: (r) => <span className="tabular-nums">{r.order_qty ?? "—"}</span> },
    { header: "Fabric", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.fabric_cost, currency)}</span> },
    { header: "Trims", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.trims_cost, currency)}</span> },
    { header: "CMT", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.cmt_cost, currency)}</span> },
    { header: "Garment", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.garment_process_cost, currency)}</span> },
    { header: "Total", align: "right", cell: (r) => <span className="tabular-nums font-semibold">{fmtMoney(r.expenses_total, currency)}</span> },
    { header: "Revenue", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.expenses_revenue, currency)}</span> },
    { header: "P/L %", align: "right", cell: (r) => (
      <span className={`tabular-nums ${r.profit_loss_pct >= 0 ? "text-green-600" : "text-red-600"}`}>
        {r.profit_loss_pct.toFixed(1)}%
      </span>
    )},
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Cost Summary by Style</h3>
      <DataTable columns={columns} rows={styleCosts} getKey={(r) => r.id} empty="No style costs added yet." />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Fabric Rates Tab
// ---------------------------------------------------------------------------

function FabricRatesTab({ fabricRates, currency }: { fabricRates: IocFabricRate[]; currency?: string | null }) {
  const columns: Column<IocFabricRate>[] = [
    { header: "#", cell: (r) => r.sno },
    { header: "Fabric", cell: (r) => r.fabric_description ?? "—" },
    { header: "Structure", cell: (r) => r.structure_name ?? "—" },
    { header: "Composition", cell: (r) => r.composition_name ?? "—" },
    { header: "Type", cell: (r) => r.fabric_type ?? "—" },
    { header: "GSM", align: "right", cell: (r) => r.gsm ?? "—" },
    { header: "Rate (w/o loss)", align: "right", cell: (r) => <span className="tabular-nums">{r.fabric_rate_without_loss.toFixed(2)}</span> },
    { header: "Loss %", align: "right", cell: (r) => <span className="tabular-nums">{r.process_loss_pct.toFixed(1)}%</span> },
    { header: "Fabric Rate", align: "right", cell: (r) => <span className="tabular-nums font-semibold">{r.fabric_rate.toFixed(2)}</span> },
    { header: "FOB (INR)", align: "right", cell: (r) => <span className="tabular-nums">{fmtMoney(r.fob_inr, "INR")}</span> },
  ];

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Fabric Rate Master</h3>
      <DataTable columns={columns} rows={fabricRates} getKey={(r) => r.id} empty="No fabric rates defined." />
      {fabricRates.map((fr) =>
        fr.process_rates.length > 0 ? (
          <div key={fr.id} className="ml-4 space-y-2">
            <h4 className="text-xs font-medium text-muted-foreground">
              Process Rates for: {fr.fabric_description}
            </h4>
            <div className="overflow-x-auto">
              <table className="min-w-full text-xs">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="px-2 py-1">#</th>
                    <th className="px-2 py-1">Process</th>
                    <th className="px-2 py-1">UOM</th>
                    <th className="px-2 py-1 text-right">Rate</th>
                    <th className="px-2 py-1">Direct?</th>
                  </tr>
                </thead>
                <tbody>
                  {fr.process_rates.map((pr) => (
                    <tr key={pr.id} className="border-b border-border/50">
                      <td className="px-2 py-1">{pr.sno}</td>
                      <td className="px-2 py-1">{pr.process_name ?? "—"}</td>
                      <td className="px-2 py-1">{pr.uom_id ?? "—"}</td>
                      <td className="px-2 py-1 text-right tabular-nums">{pr.process_rate.toFixed(2)}</td>
                      <td className="px-2 py-1">{pr.is_direct_rate ? "Yes" : "No"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        ) : null,
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Other Expenses Tab
// ---------------------------------------------------------------------------

function OtherExpensesTab({ expenses, currency }: { expenses: IocOtherExpense[]; currency?: string | null }) {
  const columns: Column<IocOtherExpense>[] = [
    { header: "#", cell: (r) => r.sno },
    { header: "Cost Head", cell: (r) => r.cost_short_name ?? "—" },
    { header: "Description", cell: (r) => r.item_description ?? r.cost_description ?? "—" },
    { header: "Type", cell: (r) => r.type_for === "O" ? "Overall" : r.type_for === "S" ? "Per Style" : "—" },
    { header: "Rate Type", cell: (r) => r.rate_type === "Q" ? "Qty" : r.rate_type === "F" ? "Fixed" : r.rate_type === "P" ? "%" : "—" },
    { header: "Qty", align: "right", cell: (r) => <span className="tabular-nums">{r.cons_qty || "—"}</span> },
    { header: "UOM", cell: (r) => r.uom_id ?? "—" },
    { header: "Rate", align: "right", cell: (r) => <span className="tabular-nums">{r.rate.toFixed(2)}</span> },
    { header: "Cost", align: "right", cell: (r) => <span className="tabular-nums font-semibold">{fmtMoney(r.cost, currency)}</span> },
  ];

  const total = expenses.reduce((sum, e) => sum + e.cost, 0);

  return (
    <div className="space-y-4">
      <h3 className="text-sm font-semibold text-foreground">Other Expenses</h3>
      <DataTable columns={columns} rows={expenses} getKey={(r) => r.id} empty="No other expenses added." />
      {expenses.length > 0 && (
        <div className="flex justify-end text-sm font-semibold">
          Total: {fmtMoney(total, currency)}
        </div>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Budget Summary Tab
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

export function IocCostingTabs({ data, currency }: Props) {
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
      content: <StyleCostsSummaryTab styleCosts={style_costs} currency={currency} />,
    },
    {
      key: "fabric-rates",
      label: `Fabric Rates (${fabric_rates.length})`,
      content: <FabricRatesTab fabricRates={fabric_rates} currency={currency} />,
    },
    {
      key: "other-expenses",
      label: `Other Expenses (${other_expenses.length})`,
      content: <OtherExpensesTab expenses={other_expenses} currency={currency} />,
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
