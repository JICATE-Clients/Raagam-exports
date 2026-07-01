"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Tabs } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable, type Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { usePermission } from "@/lib/auth/permission-context";
import { fmtMoney, fmtDate } from "@/lib/format";
import {
  computeFob,
  FABRIC_TYPES,
  FABRIC_SUBTYPES,
  COST_CATEGORIES,
} from "@/lib/sales/types";
import {
  createStyle,
  createCostSheet,
  submitCostSheet,
  approveCostSheet,
  rejectCostSheet,
  cloneCostSheet,
  createQuote,
  setQuoteStatus,
  createSample,
} from "@/lib/sales/actions";
import type {
  Style,
  Quote,
  Sample,
  QuoteStatus,
} from "@/lib/sales/types";
import type { OpportunityRow, CostSheetWithItems } from "@/lib/sales/service";
import type { Buyer, Uom } from "@/lib/masters/types";
import type { StatusTone } from "@/components/ui/status-pill";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface LineItemDraft {
  category: (typeof COST_CATEGORIES)[number];
  description: string;
  quantity: string;
  unit_cost: string;
}

interface Props {
  opportunity: OpportunityRow;
  styles: Style[];
  costSheets: CostSheetWithItems[];
  quotes: Quote[];
  samples: Sample[];
  buyers: Buyer[];
  uoms: Uom[];
}

// ---------------------------------------------------------------------------
// Status tone maps
// ---------------------------------------------------------------------------

const COST_STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  submitted: "info",
  approved: "success",
  rejected: "danger",
  superseded: "neutral",
};

const QUOTE_STATUS_TONE: Record<string, StatusTone> = {
  draft: "neutral",
  sent: "info",
  accepted: "success",
  rejected: "danger",
};

const SAMPLE_STATUS_TONE: Record<string, StatusTone> = {
  requested: "neutral",
  in_progress: "info",
  sent: "warning",
  approved: "success",
  rejected: "danger",
};

// ---------------------------------------------------------------------------
// Styles Tab
// ---------------------------------------------------------------------------

function StylesTab({
  styles,
  opportunityId,
}: {
  styles: Style[];
  opportunityId: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const [name, setName] = useState("");
  const [styleCode, setStyleCode] = useState("");
  const [fabricType, setFabricType] = useState<(typeof FABRIC_TYPES)[number] | "">("");
  const [fabricSubtype, setFabricSubtype] = useState<(typeof FABRIC_SUBTYPES)[number] | "">("");
  const [description, setDescription] = useState("");

  function resetForm() {
    setName("");
    setStyleCode("");
    setFabricType("");
    setFabricSubtype("");
    setDescription("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createStyle({
        opportunity_id: opportunityId,
        name,
        style_code: styleCode || null,
        fabric_type: fabricType || null,
        fabric_subtype: fabricSubtype || null,
        description: description || null,
      });
      if (result.ok) {
        toast.success("Style added");
        resetForm();
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const columns: Column<Style>[] = [
    {
      header: "Style Code",
      cell: (row) => (
        <span className="font-mono text-xs">{row.style_code ?? "—"}</span>
      ),
    },
    { header: "Name", cell: (row) => row.name },
    {
      header: "Fabric Type",
      cell: (row) => row.fabric_type ?? <span className="text-muted-foreground">—</span>,
    },
    {
      header: "Subtype",
      cell: (row) => row.fabric_subtype ?? <span className="text-muted-foreground">—</span>,
    },
    {
      header: "Description",
      cell: (row) => (
        <span className="text-muted-foreground line-clamp-1">
          {row.description ?? "—"}
        </span>
      ),
    },
    {
      header: "Added",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground text-xs">
          {fmtDate(row.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Cancel" : "Add style"}
        </Button>
      </div>

      {open && (
        <Card>
          <CardHeader>
            <CardTitle>New Style</CardTitle>
          </CardHeader>
          <CardBody>
            <form
              onSubmit={handleSubmit}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div>
                <Label htmlFor="st-name">Name *</Label>
                <Input
                  id="st-name"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  required
                  placeholder="e.g. Core Polo"
                />
              </div>
              <div>
                <Label htmlFor="st-code">Style Code</Label>
                <Input
                  id="st-code"
                  value={styleCode}
                  onChange={(e) => setStyleCode(e.target.value)}
                  placeholder="e.g. PLO-001"
                />
              </div>
              <div>
                <Label htmlFor="st-ft">Fabric Type</Label>
                <Select
                  id="st-ft"
                  value={fabricType}
                  onChange={(e) =>
                    setFabricType(e.target.value as (typeof FABRIC_TYPES)[number] | "")
                  }
                >
                  <option value="">Select…</option>
                  {FABRIC_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.replace("_", " ")}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="st-fst">Fabric Subtype</Label>
                <Select
                  id="st-fst"
                  value={fabricSubtype}
                  onChange={(e) =>
                    setFabricSubtype(
                      e.target.value as (typeof FABRIC_SUBTYPES)[number] | "",
                    )
                  }
                >
                  <option value="">Select…</option>
                  {FABRIC_SUBTYPES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="sm:col-span-2 lg:col-span-2">
                <Label htmlFor="st-desc">Description</Label>
                <Input
                  id="st-desc"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  placeholder="Brief style description"
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isPending}
                >
                  {isPending ? "Saving…" : "Add style"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={styles}
        getKey={(row) => row.id}
        empty="No styles yet. Add a style card to get started."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Cost Sheets Tab
// ---------------------------------------------------------------------------

function CostSheetsTab({
  costSheets,
  styles,
  opportunityId,
}: {
  costSheets: CostSheetWithItems[];
  styles: Style[];
  uoms: Uom[];
  opportunityId: string;
}) {
  const canApprove = usePermission("sales", "approve");
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  // Sheet-level fields
  const [styleId, setStyleId] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");
  const [targetFob, setTargetFob] = useState("");
  const [notes, setNotes] = useState("");

  // Dynamic line items
  const emptyItem = (): LineItemDraft => ({
    category: "material",
    description: "",
    quantity: "1",
    unit_cost: "0",
  });
  const [lineItems, setLineItems] = useState<LineItemDraft[]>([emptyItem()]);

  const computedFob = computeFob(
    lineItems.map((i) => ({
      quantity: parseFloat(i.quantity) || 0,
      unit_cost: parseFloat(i.unit_cost) || 0,
    })),
  );

  function updateItem(index: number, field: keyof LineItemDraft, value: string) {
    setLineItems((prev) =>
      prev.map((item, i) => (i === index ? { ...item, [field]: value } : item)),
    );
  }

  function addItem() {
    setLineItems((prev) => [...prev, emptyItem()]);
  }

  function removeItem(index: number) {
    setLineItems((prev) => prev.filter((_, i) => i !== index));
  }

  function resetForm() {
    setStyleId("");
    setCurrencyCode("USD");
    setTargetFob("");
    setNotes("");
    setLineItems([emptyItem()]);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createCostSheet({
        opportunity_id: opportunityId,
        style_id: styleId || null,
        currency_code: currencyCode || null,
        target_fob: targetFob ? parseFloat(targetFob) : null,
        notes: notes || null,
        items: lineItems.map((item, i) => ({
          category: item.category,
          description: item.description,
          quantity: parseFloat(item.quantity) || 0,
          unit_cost: parseFloat(item.unit_cost) || 0,
          sort_order: i,
        })),
      });
      if (result.ok) {
        toast.success("Cost sheet saved as draft");
        resetForm();
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function doAction(
    fn: () => Promise<{ ok: boolean; error?: string }>,
    successMsg: string,
  ) {
    startTransition(async () => {
      const result = await fn();
      if (result.ok) {
        toast.success(successMsg);
        router.refresh();
      } else {
        toast.error((result as { ok: false; error: string }).error);
      }
    });
  }

  const columns: Column<CostSheetWithItems>[] = [
    {
      header: "Ver",
      cell: (row) => (
        <span className="font-mono text-xs text-muted-foreground">v{row.version}</span>
      ),
    },
    {
      header: "Status",
      cell: (row) => (
        <StatusPill tone={COST_STATUS_TONE[row.status] ?? "neutral"}>
          {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
        </StatusPill>
      ),
    },
    {
      header: "Computed FOB",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums font-medium">
          {fmtMoney(row.computed_fob, row.currency_code)}
        </span>
      ),
    },
    {
      header: "Target FOB",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {fmtMoney(row.target_fob, row.currency_code)}
        </span>
      ),
    },
    {
      header: "Created",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {fmtDate(row.created_at)}
        </span>
      ),
    },
    {
      header: "Actions",
      align: "right",
      cell: (row) => (
        <div className="flex justify-end gap-1">
          {row.status === "draft" && (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() =>
                doAction(
                  () => submitCostSheet(row.id, opportunityId),
                  "Submitted for approval",
                )
              }
            >
              Submit
            </Button>
          )}
          {row.status === "submitted" && canApprove && (
            <>
              <Button
                variant="primary"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  doAction(
                    () => approveCostSheet(row.id, opportunityId),
                    "Cost sheet approved",
                  )
                }
              >
                Approve
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  doAction(
                    () => rejectCostSheet(row.id, opportunityId),
                    "Cost sheet rejected",
                  )
                }
              >
                Reject
              </Button>
            </>
          )}
          <Button
            variant="ghost"
            size="sm"
            disabled={isPending}
            onClick={() =>
              doAction(
                () => cloneCostSheet(row.id, opportunityId),
                "Cloned as new draft",
              )
            }
          >
            Clone
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Cancel" : "New cost sheet"}
        </Button>
      </div>

      {open && (
        <Card>
          <CardHeader>
            <CardTitle>New Cost Sheet</CardTitle>
            <span className="text-sm font-medium text-foreground">
              Computed FOB:{" "}
              <span className="text-primary tabular-nums">
                {fmtMoney(computedFob, currencyCode || "USD")}
              </span>
            </span>
          </CardHeader>
          <CardBody>
            <form onSubmit={handleSubmit} className="space-y-4">
              {/* Sheet header fields */}
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                <div>
                  <Label htmlFor="cs-style">Style (optional)</Label>
                  <Select
                    id="cs-style"
                    value={styleId}
                    onChange={(e) => setStyleId(e.target.value)}
                  >
                    <option value="">None</option>
                    {styles.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                        {s.style_code ? ` (${s.style_code})` : ""}
                      </option>
                    ))}
                  </Select>
                </div>
                <div>
                  <Label htmlFor="cs-cur">Currency</Label>
                  <Input
                    id="cs-cur"
                    value={currencyCode}
                    onChange={(e) => setCurrencyCode(e.target.value)}
                    placeholder="USD"
                    maxLength={3}
                  />
                </div>
                <div>
                  <Label htmlFor="cs-tfob">Target FOB</Label>
                  <Input
                    id="cs-tfob"
                    type="number"
                    min="0"
                    step="0.01"
                    value={targetFob}
                    onChange={(e) => setTargetFob(e.target.value)}
                    placeholder="0.00"
                  />
                </div>
                <div>
                  <Label htmlFor="cs-notes">Notes</Label>
                  <Input
                    id="cs-notes"
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    placeholder="Optional notes"
                  />
                </div>
              </div>

              {/* Line items */}
              <div>
                <div className="mb-2 flex items-center justify-between">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
                    Line Items
                  </span>
                  <Button
                    type="button"
                    variant="subtle"
                    size="sm"
                    onClick={addItem}
                  >
                    + Add line
                  </Button>
                </div>
                <div className="overflow-x-auto rounded-lg border border-border">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="border-b border-border bg-surface-muted">
                        <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                          Category
                        </th>
                        <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                          Description
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground w-24">
                          Qty
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground w-28">
                          Unit Cost
                        </th>
                        <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground w-28">
                          Amount
                        </th>
                        <th className="px-3 py-2 w-10" />
                      </tr>
                    </thead>
                    <tbody>
                      {lineItems.map((item, i) => {
                        const qty = parseFloat(item.quantity) || 0;
                        const uc = parseFloat(item.unit_cost) || 0;
                        const amount = qty * uc;
                        return (
                          <tr key={i} className="border-b border-border last:border-0">
                            <td className="px-2 py-1.5">
                              <Select
                                value={item.category}
                                onChange={(e) =>
                                  updateItem(i, "category", e.target.value)
                                }
                                className="h-8 text-xs"
                              >
                                {COST_CATEGORIES.map((c) => (
                                  <option key={c} value={c}>
                                    {c.charAt(0).toUpperCase() + c.slice(1)}
                                  </option>
                                ))}
                              </Select>
                            </td>
                            <td className="px-2 py-1.5">
                              <Input
                                value={item.description}
                                onChange={(e) =>
                                  updateItem(i, "description", e.target.value)
                                }
                                placeholder="e.g. Main fabric"
                                className="h-8 text-xs"
                                required
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <Input
                                type="number"
                                min="0"
                                step="0.001"
                                value={item.quantity}
                                onChange={(e) =>
                                  updateItem(i, "quantity", e.target.value)
                                }
                                className="h-8 text-xs text-right"
                              />
                            </td>
                            <td className="px-2 py-1.5">
                              <Input
                                type="number"
                                min="0"
                                step="0.0001"
                                value={item.unit_cost}
                                onChange={(e) =>
                                  updateItem(i, "unit_cost", e.target.value)
                                }
                                className="h-8 text-xs text-right"
                              />
                            </td>
                            <td className="px-3 py-1.5 text-right tabular-nums text-xs font-medium">
                              {fmtMoney(amount, currencyCode || "USD")}
                            </td>
                            <td className="px-2 py-1.5">
                              <button
                                type="button"
                                onClick={() => removeItem(i)}
                                disabled={lineItems.length === 1}
                                className="text-muted-foreground hover:text-danger disabled:opacity-30 text-xs"
                                title="Remove line"
                              >
                                ✕
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                    <tfoot>
                      <tr className="bg-surface-muted border-t border-border">
                        <td
                          colSpan={4}
                          className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground"
                        >
                          Total FOB
                        </td>
                        <td className="px-3 py-2 text-right tabular-nums text-sm font-bold text-primary">
                          {fmtMoney(computedFob, currencyCode || "USD")}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  </table>
                </div>
              </div>

              <div className="flex gap-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isPending}
                >
                  {isPending ? "Saving…" : "Save as draft"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={costSheets}
        getKey={(row) => row.id}
        empty="No cost sheets yet."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Quotes Tab
// ---------------------------------------------------------------------------

function QuotesTab({
  quotes,
  costSheets,
  opportunityId,
  buyerId,
}: {
  quotes: Quote[];
  costSheets: CostSheetWithItems[];
  opportunityId: string;
  buyerId: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const approvedSheets = costSheets.filter((cs) => cs.status === "approved");

  const [costSheetId, setCostSheetId] = useState("");
  const [fobPrice, setFobPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [incoterm, setIncoterm] = useState("FOB");
  const [includeSample, setIncludeSample] = useState(false);
  const [validUntil, setValidUntil] = useState("");
  const [currencyCode, setCurrencyCode] = useState("USD");

  function resetForm() {
    setCostSheetId("");
    setFobPrice("");
    setQuantity("");
    setIncoterm("FOB");
    setIncludeSample(false);
    setValidUntil("");
    setCurrencyCode("USD");
  }

  // Prefill FOB from selected cost sheet
  function handleSheetChange(id: string) {
    setCostSheetId(id);
    if (id) {
      const sheet = approvedSheets.find((s) => s.id === id);
      if (sheet) {
        setFobPrice(String(sheet.computed_fob));
        setCurrencyCode(sheet.currency_code ?? "USD");
      }
    }
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createQuote({
        opportunity_id: opportunityId,
        buyer_id: buyerId,
        cost_sheet_id: costSheetId || null,
        fob_price: parseFloat(fobPrice) || 0,
        currency_code: currencyCode || null,
        quantity: quantity ? parseFloat(quantity) : null,
        incoterm: incoterm || "FOB",
        include_sample: includeSample,
        valid_until: validUntil || null,
      });
      if (result.ok) {
        toast.success("Quote created");
        resetForm();
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  function doStatus(id: string, status: QuoteStatus, successMsg: string) {
    startTransition(async () => {
      const result = await setQuoteStatus(id, status, opportunityId);
      if (result.ok) {
        toast.success(successMsg);
        router.refresh();
      } else {
        toast.error((result as { ok: false; error: string }).error);
      }
    });
  }

  const columns: Column<Quote>[] = [
    {
      header: "Code",
      cell: (row) => (
        <span className="font-mono text-xs">{row.code ?? "—"}</span>
      ),
    },
    {
      header: "FOB Price",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums font-medium">
          {fmtMoney(row.fob_price, row.currency_code)}
        </span>
      ),
    },
    {
      header: "Qty",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-muted-foreground">
          {row.quantity ?? "—"}
        </span>
      ),
    },
    {
      header: "Status",
      cell: (row) => (
        <StatusPill tone={QUOTE_STATUS_TONE[row.status] ?? "neutral"}>
          {row.status.charAt(0).toUpperCase() + row.status.slice(1)}
        </StatusPill>
      ),
    },
    {
      header: "Sample",
      cell: (row) =>
        row.include_sample ? (
          <span className="text-xs text-success">Yes</span>
        ) : (
          <span className="text-xs text-muted-foreground">No</span>
        ),
    },
    {
      header: "Valid Until",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {fmtDate(row.valid_until)}
        </span>
      ),
    },
    {
      header: "Actions",
      align: "right",
      cell: (row) => (
        <div className="flex justify-end gap-1">
          {row.status === "draft" && (
            <Button
              variant="outline"
              size="sm"
              disabled={isPending}
              onClick={() => doStatus(row.id, "sent", "Quote marked as sent")}
            >
              Mark Sent
            </Button>
          )}
          {row.status === "sent" && (
            <>
              <Button
                variant="primary"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  doStatus(row.id, "accepted", "Quote accepted — opportunity won!")
                }
              >
                Accept
              </Button>
              <Button
                variant="danger"
                size="sm"
                disabled={isPending}
                onClick={() =>
                  doStatus(row.id, "rejected", "Quote marked as rejected")
                }
              >
                Reject
              </Button>
            </>
          )}
        </div>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Cancel" : "New quote"}
        </Button>
      </div>

      {open && (
        <Card>
          <CardHeader>
            <CardTitle>New Quote</CardTitle>
          </CardHeader>
          <CardBody>
            <form
              onSubmit={handleSubmit}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div>
                <Label htmlFor="qt-sheet">Approved Cost Sheet</Label>
                <Select
                  id="qt-sheet"
                  value={costSheetId}
                  onChange={(e) => handleSheetChange(e.target.value)}
                >
                  <option value="">None</option>
                  {approvedSheets.map((s) => (
                    <option key={s.id} value={s.id}>
                      v{s.version} — {fmtMoney(s.computed_fob, s.currency_code)}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="qt-fob">FOB Price *</Label>
                <Input
                  id="qt-fob"
                  type="number"
                  min="0"
                  step="0.01"
                  value={fobPrice}
                  onChange={(e) => setFobPrice(e.target.value)}
                  required
                  placeholder="0.00"
                />
              </div>
              <div>
                <Label htmlFor="qt-cur">Currency</Label>
                <Input
                  id="qt-cur"
                  value={currencyCode}
                  onChange={(e) => setCurrencyCode(e.target.value)}
                  placeholder="USD"
                  maxLength={3}
                />
              </div>
              <div>
                <Label htmlFor="qt-qty">Quantity</Label>
                <Input
                  id="qt-qty"
                  type="number"
                  min="0"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  placeholder="0"
                />
              </div>
              <div>
                <Label htmlFor="qt-inco">Incoterm</Label>
                <Input
                  id="qt-inco"
                  value={incoterm}
                  onChange={(e) => setIncoterm(e.target.value)}
                  placeholder="FOB"
                />
              </div>
              <div>
                <Label htmlFor="qt-valid">Valid Until</Label>
                <Input
                  id="qt-valid"
                  type="date"
                  value={validUntil}
                  onChange={(e) => setValidUntil(e.target.value)}
                />
              </div>
              <div className="flex items-center gap-2 pt-5">
                <input
                  id="qt-sample"
                  type="checkbox"
                  checked={includeSample}
                  onChange={(e) => setIncludeSample(e.target.checked)}
                  className="h-4 w-4 rounded border-border accent-primary"
                />
                <Label htmlFor="qt-sample" className="mb-0">
                  Include sample
                </Label>
              </div>
              <div className="flex items-end sm:col-span-2 lg:col-span-2">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isPending}
                >
                  {isPending ? "Creating…" : "Create quote"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={quotes}
        getKey={(row) => row.id}
        empty="No quotes yet."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Samples Tab
// ---------------------------------------------------------------------------

const SAMPLE_TYPES = ["proto", "fit", "sms", "pp", "top"] as const;
const SAMPLE_STATUSES = [
  "requested",
  "in_progress",
  "sent",
  "approved",
  "rejected",
] as const;

function SamplesTab({
  samples,
  styles,
  opportunityId,
}: {
  samples: Sample[];
  styles: Style[];
  opportunityId: string;
}) {
  const [open, setOpen] = useState(false);
  const [isPending, startTransition] = useTransition();
  const router = useRouter();
  const toast = useToast();

  const [type, setType] = useState<(typeof SAMPLE_TYPES)[number]>("proto");
  const [status, setStatus] =
    useState<(typeof SAMPLE_STATUSES)[number]>("requested");
  const [styleId, setStyleId] = useState("");
  const [courierRef, setCourierRef] = useState("");
  const [notes, setNotes] = useState("");

  function resetForm() {
    setType("proto");
    setStatus("requested");
    setStyleId("");
    setCourierRef("");
    setNotes("");
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await createSample({
        opportunity_id: opportunityId,
        style_id: styleId || null,
        type,
        status,
        courier_ref: courierRef || null,
        notes: notes || null,
      });
      if (result.ok) {
        toast.success("Sample recorded");
        resetForm();
        setOpen(false);
        router.refresh();
      } else {
        toast.error(result.error);
      }
    });
  }

  const columns: Column<Sample>[] = [
    {
      header: "Type",
      cell: (row) => (
        <span className="font-mono text-xs uppercase">{row.type}</span>
      ),
    },
    {
      header: "Status",
      cell: (row) => (
        <StatusPill tone={SAMPLE_STATUS_TONE[row.status] ?? "neutral"}>
          {row.status.replace("_", " ")}
        </StatusPill>
      ),
    },
    {
      header: "Courier Ref",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {row.courier_ref ?? "—"}
        </span>
      ),
    },
    {
      header: "Dispatched",
      cell: (row) => (
        <span className="text-xs text-muted-foreground">
          {fmtDate(row.dispatched_at)}
        </span>
      ),
    },
    {
      header: "Notes",
      cell: (row) => (
        <span className="text-xs text-muted-foreground line-clamp-1">
          {row.notes ?? "—"}
        </span>
      ),
    },
    {
      header: "Added",
      align: "right",
      cell: (row) => (
        <span className="tabular-nums text-xs text-muted-foreground">
          {fmtDate(row.created_at)}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button
          variant="outline"
          size="sm"
          onClick={() => setOpen((v) => !v)}
        >
          {open ? "Cancel" : "Add sample"}
        </Button>
      </div>

      {open && (
        <Card>
          <CardHeader>
            <CardTitle>Add Sample</CardTitle>
          </CardHeader>
          <CardBody>
            <form
              onSubmit={handleSubmit}
              className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3"
            >
              <div>
                <Label htmlFor="sm-type">Sample Type *</Label>
                <Select
                  id="sm-type"
                  value={type}
                  onChange={(e) =>
                    setType(e.target.value as (typeof SAMPLE_TYPES)[number])
                  }
                >
                  {SAMPLE_TYPES.map((t) => (
                    <option key={t} value={t}>
                      {t.toUpperCase()}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="sm-status">Status</Label>
                <Select
                  id="sm-status"
                  value={status}
                  onChange={(e) =>
                    setStatus(e.target.value as (typeof SAMPLE_STATUSES)[number])
                  }
                >
                  {SAMPLE_STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s.replace("_", " ")}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="sm-style">Style (optional)</Label>
                <Select
                  id="sm-style"
                  value={styleId}
                  onChange={(e) => setStyleId(e.target.value)}
                >
                  <option value="">None</option>
                  {styles.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <Label htmlFor="sm-courier">Courier Reference</Label>
                <Input
                  id="sm-courier"
                  value={courierRef}
                  onChange={(e) => setCourierRef(e.target.value)}
                  placeholder="e.g. DHL-12345"
                />
              </div>
              <div className="sm:col-span-2">
                <Label htmlFor="sm-notes">Notes</Label>
                <Textarea
                  id="sm-notes"
                  value={notes}
                  onChange={(e) => setNotes(e.target.value)}
                  placeholder="Optional notes"
                  rows={2}
                />
              </div>
              <div className="flex items-end">
                <Button
                  type="submit"
                  variant="primary"
                  size="sm"
                  disabled={isPending}
                >
                  {isPending ? "Saving…" : "Add sample"}
                </Button>
              </div>
            </form>
          </CardBody>
        </Card>
      )}

      <DataTable
        columns={columns}
        rows={samples}
        getKey={(row) => row.id}
        empty="No samples recorded yet."
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main export
// ---------------------------------------------------------------------------

export function OpportunityTabs({
  opportunity,
  styles,
  costSheets,
  quotes,
  samples,
  uoms,
}: Props) {
  const items = [
    {
      key: "styles",
      label: `Styles (${styles.length})`,
      content: (
        <StylesTab styles={styles} opportunityId={opportunity.id} />
      ),
    },
    {
      key: "cost-sheets",
      label: `Cost Sheets (${costSheets.length})`,
      content: (
        <CostSheetsTab
          costSheets={costSheets}
          styles={styles}
          uoms={uoms}
          opportunityId={opportunity.id}
        />
      ),
    },
    {
      key: "quotes",
      label: `Quotes (${quotes.length})`,
      content: (
        <QuotesTab
          quotes={quotes}
          costSheets={costSheets}
          opportunityId={opportunity.id}
          buyerId={opportunity.buyer_id}
        />
      ),
    },
    {
      key: "samples",
      label: `Samples (${samples.length})`,
      content: (
        <SamplesTab
          samples={samples}
          styles={styles}
          opportunityId={opportunity.id}
        />
      ),
    },
  ];

  return <Tabs items={items} defaultKey="styles" />;
}
