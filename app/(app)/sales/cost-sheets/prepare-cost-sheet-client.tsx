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
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { FilterBar } from "@/components/masters/filter-bar";
import { useToast } from "@/components/ui/toast";
import { fmtMoney, fmtDate } from "@/lib/format";
import { computeFob, COST_CATEGORIES, COST_SHEET_STATUSES } from "@/lib/sales/types";
import {
  createCostSheet,
  submitCostSheet,
  approveCostSheet,
  rejectCostSheet,
  cloneCostSheet,
} from "@/lib/sales/actions";
import type {
  CostSheetRegisterRow,
  OpportunityRow,
  StyleRegisterRow,
} from "@/lib/sales/service";

const STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  rejected: "danger",
  superseded: "neutral",
};

interface LineItemDraft {
  category: (typeof COST_CATEGORIES)[number];
  description: string;
  quantity: string;
  unit_cost: string;
}

const emptyItem = (): LineItemDraft => ({
  category: "material",
  description: "",
  quantity: "1",
  unit_cost: "0",
});

interface Props {
  costSheets: CostSheetRegisterRow[];
  opportunities: OpportunityRow[];
  styles: StyleRegisterRow[];
  perms: { canCreate: boolean; canEdit: boolean; canApprove: boolean };
}

/** Legacy "Prepare Product Cost Sheet — By Enquiry No.": a cross-enquiry cost
 *  sheet register + an inline preparation editor (header + costed line items),
 *  reusing the existing cost-sheet workflow actions (submit/approve/reject/clone). */
export function PrepareCostSheetClient({
  costSheets,
  opportunities,
  styles,
  perms,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, start] = useTransition();

  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<"all" | string>("all");
  const [season, setSeason] = useState<"all" | string>("all");

  // Inline editor state
  const [open, setOpen] = useState(false);
  const [opportunityId, setOpportunityId] = useState("");
  const [styleId, setStyleId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [targetFob, setTargetFob] = useState("");
  const [notes, setNotes] = useState("");
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([emptyItem()]);

  const enquiryStyles = useMemo(
    () => styles.filter((s) => s.opportunity_id === opportunityId),
    [styles, opportunityId],
  );

  const computedFob = computeFob(
    lineItems.map((i) => ({
      quantity: parseFloat(i.quantity) || 0,
      unit_cost: parseFloat(i.unit_cost) || 0,
    })),
  );

  const seasons = useMemo(
    () =>
      [
        ...new Set(costSheets.map((c) => c.season).filter((v): v is string => !!v)),
      ].sort((a, b) => a.localeCompare(b)),
    [costSheets],
  );

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return costSheets.filter((c) => {
      if (status !== "all" && c.status !== status) return false;
      if (season !== "all" && c.season !== season) return false;
      if (q) {
        const hay = [c.enquiry_code, c.buyer_name, c.style_name, c.style_code]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [costSheets, search, status, season]);

  const activeCount = (status !== "all" ? 1 : 0) + (season !== "all" ? 1 : 0);

  function onPickEnquiry(id: string) {
    setOpportunityId(id);
    setStyleId("");
    const opp = opportunities.find((o) => o.id === id);
    if (opp) {
      if (opp.currency_code) setCurrencyCode(opp.currency_code);
      setTargetFob(opp.target_fob != null ? String(opp.target_fob) : "");
    }
  }

  function resetForm() {
    setOpportunityId("");
    setStyleId("");
    setCurrencyCode("USD");
    setTargetFob("");
    setNotes("");
    setLineItems([emptyItem()]);
  }

  function updateItem(index: number, field: keyof LineItemDraft, value: string) {
    setLineItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  }
  const addItem = () => setLineItems((prev) => [...prev, emptyItem()]);
  const removeItem = (index: number) =>
    setLineItems((prev) => prev.filter((_, i) => i !== index));

  function savePrepare() {
    if (!opportunityId) return;
    start(async () => {
      const res = await createCostSheet({
        opportunity_id: opportunityId,
        style_id: styleId || null,
        currency_code: currencyCode || null,
        target_fob: targetFob ? parseFloat(targetFob) : null,
        notes: notes || null,
        items: lineItems
          .filter((i) => i.description.trim())
          .map((item, i) => ({
            category: item.category,
            description: item.description,
            quantity: parseFloat(item.quantity) || 0,
            unit_cost: parseFloat(item.unit_cost) || 0,
            sort_order: i,
          })),
      });
      if (res.ok) {
        success("Cost sheet saved as draft.");
        resetForm();
        setOpen(false);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  function doAction(
    fn: () => Promise<{ ok: true } | { ok: false; error: string }>,
    msg: string,
  ) {
    start(async () => {
      const res = await fn();
      if (res.ok) {
        success(msg);
        router.refresh();
      } else {
        toastError(res.error);
      }
    });
  }

  const dash = <span className="text-muted-foreground">—</span>;
  const columns: Column<CostSheetRegisterRow>[] = [
    { header: "Enquiry No", cell: (c) => <span className="font-mono text-xs">{c.enquiry_code ?? "—"}</span> },
    { header: "Enquiry Dt", cell: (c) => <span className="tabular-nums text-xs">{fmtDate(c.enquiry_date)}</span> },
    { header: "Customer", cell: (c) => c.buyer_name ?? dash },
    {
      header: "Style",
      cell: (c) =>
        c.style_name ? (
          <span>
            {c.style_name}
            {c.style_code ? <span className="text-muted-foreground"> ({c.style_code})</span> : null}
          </span>
        ) : (
          dash
        ),
    },
    { header: "Ver", cell: (c) => <span className="font-mono text-xs text-muted-foreground">v{c.version}</span> },
    {
      header: "Status",
      cell: (c) => (
        <StatusPill tone={STATUS_TONE[c.status] ?? "neutral"}>
          {c.status.charAt(0).toUpperCase() + c.status.slice(1)}
        </StatusPill>
      ),
    },
    { header: "Currency", cell: (c) => c.currency_code ?? dash },
    { header: "Target FOB", align: "right", cell: (c) => <span className="tabular-nums text-muted-foreground">{fmtMoney(c.target_fob, c.currency_code)}</span> },
    { header: "Computed FOB", align: "right", cell: (c) => <span className="tabular-nums font-medium">{fmtMoney(c.computed_fob, c.currency_code)}</span> },
    {
      header: "",
      align: "right",
      cell: (c) => (
        <div className="flex items-center justify-end gap-1 whitespace-nowrap">
          {c.status === "draft" && perms.canEdit && (
            <Button variant="outline" size="sm" disabled={isPending} onClick={() => doAction(() => submitCostSheet(c.id, c.opportunity_id), "Submitted for approval.")}>
              Submit
            </Button>
          )}
          {c.status === "submitted" && perms.canApprove && (
            <>
              <Button variant="primary" size="sm" disabled={isPending} onClick={() => doAction(() => approveCostSheet(c.id, c.opportunity_id), "Cost sheet approved.")}>
                Approve
              </Button>
              <Button variant="danger" size="sm" disabled={isPending} onClick={() => doAction(() => rejectCostSheet(c.id, c.opportunity_id), "Cost sheet rejected.")}>
                Reject
              </Button>
            </>
          )}
          {perms.canCreate && (
            <Button variant="ghost" size="sm" disabled={isPending} onClick={() => doAction(() => cloneCostSheet(c.id, c.opportunity_id), "Cloned as new draft.")}>
              Clone
            </Button>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title="Prepare Product Cost Sheet"
        description="Cost sheets across enquiries — versioned costing against the target FOB."
        actions={
          <div className="flex items-center gap-2">
            <Link href="/sales">
              <Button variant="outline" size="sm">
                ← Sales Pipeline
              </Button>
            </Link>
            {perms.canCreate && (
              <Button size="sm" onClick={() => setOpen((v) => !v)}>
                {open ? "Cancel" : "Prepare Cost Sheet"}
              </Button>
            )}
          </div>
        }
      />

      {open && perms.canCreate && (
        <Card>
          <CardHeader>
            <CardTitle>New Cost Sheet</CardTitle>
            <span className="text-sm font-medium text-foreground">
              Computed FOB:{" "}
              <span className="tabular-nums text-primary">
                {fmtMoney(computedFob, currencyCode || "USD")}
              </span>
            </span>
          </CardHeader>
          <CardBody>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
                <div className="lg:col-span-2">
                  <Label htmlFor="cs-enq">Enquiry *</Label>
                  <Select id="cs-enq" value={opportunityId} onChange={(e) => onPickEnquiry(e.target.value)}>
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
                  <Label htmlFor="cs-style">Style</Label>
                  <Select id="cs-style" value={styleId} onChange={(e) => setStyleId(e.target.value)} disabled={!opportunityId}>
                    <option value="">None</option>
                    {enquiryStyles.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.style_code ? ` (${s.style_code})` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="cs-cur">Currency</Label>
                  <Input id="cs-cur" value={currencyCode} onChange={(e) => setCurrencyCode(e.target.value)} placeholder="USD" maxLength={3} />
                </div>
                <div>
                  <Label htmlFor="cs-tfob">Target FOB</Label>
                  <Input id="cs-tfob" type="number" min="0" step="0.01" value={targetFob} onChange={(e) => setTargetFob(e.target.value)} placeholder="0.00" />
                </div>
              </div>

              <div>
                <Label htmlFor="cs-notes">Notes</Label>
                <Input id="cs-notes" value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Optional notes" />
              </div>

              {/* Line items */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                    Line Items
                  </span>
                  <Button type="button" variant="subtle" size="sm" onClick={addItem}>
                    + Add line
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-muted">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Category</th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">Description</th>
                        <th className="w-24 px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Qty</th>
                        <th className="w-28 px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Unit Cost</th>
                        <th className="w-28 px-3 py-2 text-right text-xs font-semibold text-muted-foreground">Amount</th>
                        <th className="w-10 px-3 py-2" />
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((item, i) => {
                        const amount =
                          (parseFloat(item.quantity) || 0) * (parseFloat(item.unit_cost) || 0);
                        return (
                          <tr key={i} className="border-b border-border last:border-0">
                            <td className="px-2 py-1.5">
                              <Select value={item.category} onChange={(e) => updateItem(i, "category", e.target.value)} className="h-8 text-xs">
                                {COST_CATEGORIES.map((c) => (
                                  <option key={c} value={c}>
                                    {c.charAt(0).toUpperCase() + c.slice(1)}
                                  </option>
                                ))}
                              </Select>
                            </td>
                            <td className="px-2 py-1.5">
                              <Input value={item.description} onChange={(e) => updateItem(i, "description", e.target.value)} placeholder="e.g. Main fabric" className="h-8 text-xs" />
                            </td>
                            <td className="px-2 py-1.5">
                              <Input type="number" min="0" step="0.001" value={item.quantity} onChange={(e) => updateItem(i, "quantity", e.target.value)} className="h-8 text-right text-xs" />
                            </td>
                            <td className="px-2 py-1.5">
                              <Input type="number" min="0" step="0.0001" value={item.unit_cost} onChange={(e) => updateItem(i, "unit_cost", e.target.value)} className="h-8 text-right text-xs" />
                            </td>
                            <td className="px-3 py-1.5 text-right text-xs font-medium tabular-nums">
                              {fmtMoney(amount, currencyCode || "USD")}
                            </td>
                            <td className="px-2 py-1.5">
                              <button type="button" onClick={() => removeItem(i)} disabled={lineItems.length === 1} className="text-xs text-muted-foreground hover:text-danger disabled:opacity-30" title="Remove line">
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="border-t border-border bg-surface-muted">
                        <td colSpan={4} className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                          Computed FOB
                        </td>
                        <td className="px-3 py-2 text-right text-xs font-semibold tabular-nums">
                          {fmtMoney(computedFob, currencyCode || "USD")}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="flex justify-end gap-2">
                <Button variant="outline" size="sm" onClick={() => { resetForm(); setOpen(false); }}>
                  Cancel
                </Button>
                <Button size="sm" onClick={savePrepare} disabled={isPending || !opportunityId}>
                  {isPending ? "Saving…" : "Save as Draft"}
                </Button>
              </div>
            </div>
          </CardBody>
        </Card>
      )}

      <FilterBar
        search={search}
        onSearch={setSearch}
        searchPlaceholder="Search enquiry, customer, style…"
        activeCount={activeCount}
        onReset={() => {
          setStatus("all");
          setSeason("all");
        }}
        right={`${filtered.length} of ${costSheets.length}`}
      >
        <div>
          <Label htmlFor="flt-status">Status</Label>
          <Select id="flt-status" value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="all">All</option>
            {COST_SHEET_STATUSES.map((s) => (
              <option key={s} value={s}>
                {s.charAt(0).toUpperCase() + s.slice(1)}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="flt-season">Season</Label>
          <Select id="flt-season" value={season} onChange={(e) => setSeason(e.target.value)}>
            <option value="all">All</option>
            {seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      <DataTable
        columns={columns}
        rows={filtered}
        getKey={(c) => c.id}
        empty="No cost sheets yet. Prepare one against an enquiry to get started."
      />
    </div>
  );
}
