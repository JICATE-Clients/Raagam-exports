"use client";

import { useState, useTransition } from "react";
import { addRfqQuote, selectRfqQuote } from "@/lib/purchase/po-actions";
import type { RfqLine, RfqQuoteInput } from "@/lib/purchase/types";
import type {
  RfqWithDetails,
  RfqQuoteWithVendor,
  VendorForPicker,
} from "@/lib/purchase/po-service";
import type { Currency } from "@/lib/masters/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { DataTable } from "@/components/ui/data-table";
import type { Column } from "@/components/ui/data-table";
import { StatusPill } from "@/components/ui/status-pill";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { useToast } from "@/components/ui/toast";

// ---------- lines table ----------

const lineColumns: Column<RfqLine>[] = [
  {
    header: "#",
    cell: (r) => (
      <span className="tabular-nums text-xs text-muted-foreground">
        {r.sort_order + 1}
      </span>
    ),
  },
  {
    header: "Description",
    cell: (r) => <span className="text-sm">{r.description}</span>,
  },
  {
    header: "Qty",
    align: "right",
    cell: (r) => (
      <span className="tabular-nums text-sm">{fmtNumber(r.quantity)}</span>
    ),
  },
];

// ---------- quotes table ----------

function QuoteRow({
  quote,
  rfqStatus,
  canEdit,
  isPending,
  onSelect,
}: {
  quote: RfqQuoteWithVendor;
  rfqStatus: string;
  canEdit: boolean;
  isPending: boolean;
  onSelect: (quoteId: string) => void;
}) {
  const canSelect =
    canEdit && rfqStatus !== "awarded" && !quote.is_selected;

  return (
    <tr className="border-b border-border last:border-0 hover:bg-surface-muted/60">
      <td className="px-3 py-2 text-sm font-medium">
        {quote.vendor_name ?? "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-sm">
        {fmtMoney(quote.total_amount, quote.currency_code)}
      </td>
      <td className="px-3 py-2 text-sm">
        {quote.currency_code ?? "—"}
      </td>
      <td className="px-3 py-2 text-right tabular-nums text-sm">
        {quote.lead_days != null ? `${quote.lead_days} days` : "—"}
      </td>
      <td className="px-3 py-2">
        {quote.is_selected ? (
          <StatusPill tone="success">Selected</StatusPill>
        ) : (
          <StatusPill tone="neutral">—</StatusPill>
        )}
      </td>
      <td className="px-3 py-2 text-right">
        {canSelect && (
          <Button
            size="sm"
            variant="outline"
            disabled={isPending}
            onClick={() => onSelect(quote.id)}
          >
            Select
          </Button>
        )}
      </td>
    </tr>
  );
}

// ---------- add quote form ----------

type QuoteFields = {
  vendor_id: string;
  total_amount: string;
  currency_code: string;
  lead_days: string;
  notes: string;
};

function emptyQuoteFields(): QuoteFields {
  return {
    vendor_id: "",
    total_amount: "",
    currency_code: "INR",
    lead_days: "",
    notes: "",
  };
}

// ---------- main component ----------

export function RfqDetail({
  rfq,
  vendors,
  currencies,
  canEdit,
}: {
  rfq: RfqWithDetails;
  vendors: VendorForPicker[];
  currencies: Currency[];
  canEdit: boolean;
}) {
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [showQuoteForm, setShowQuoteForm] = useState(false);
  const [quoteForm, setQuoteForm] = useState<QuoteFields>(emptyQuoteFields());

  function handleAddQuote(e: React.FormEvent) {
    e.preventDefault();
    if (!quoteForm.vendor_id) return;

    const payload: RfqQuoteInput = {
      rfq_id: rfq.id,
      vendor_id: quoteForm.vendor_id,
      total_amount: parseFloat(quoteForm.total_amount) || 0,
      currency_code: quoteForm.currency_code || null,
      lead_days: quoteForm.lead_days ? parseInt(quoteForm.lead_days) : null,
      notes: quoteForm.notes.trim() || null,
    };

    startTransition(async () => {
      const result = await addRfqQuote(payload);
      if (result.ok) {
        success("Quote added.");
        setQuoteForm(emptyQuoteFields());
        setShowQuoteForm(false);
      } else {
        toastError(result.error);
      }
    });
  }

  function handleSelect(quoteId: string) {
    startTransition(async () => {
      const result = await selectRfqQuote(quoteId, rfq.id);
      if (result.ok) {
        success("Quote selected — RFQ awarded.");
      } else {
        toastError(result.error);
      }
    });
  }

  const canAddQuote = canEdit && rfq.status !== "awarded";

  return (
    <div className="space-y-4">
      {/* Lines */}
      <Card>
        <CardHeader>
          <CardTitle>Line items ({rfq.lines.length})</CardTitle>
        </CardHeader>
        <CardBody>
          {rfq.lines.length === 0 ? (
            <p className="text-sm text-muted-foreground">No lines on this RFQ.</p>
          ) : (
            <DataTable
              columns={lineColumns}
              rows={rfq.lines}
              getKey={(r) => r.id}
              empty="No lines."
            />
          )}
        </CardBody>
      </Card>

      {/* Vendor quotes */}
      <Card>
        <CardHeader>
          <CardTitle>Vendor quotes ({rfq.quotes.length})</CardTitle>
          {canAddQuote && (
            <Button
              size="sm"
              variant={showQuoteForm ? "outline" : "primary"}
              onClick={() => setShowQuoteForm((s) => !s)}
            >
              {showQuoteForm ? "Cancel" : "+ Add quote"}
            </Button>
          )}
        </CardHeader>
        <CardBody className="space-y-4">
          {showQuoteForm && (
            <form
              onSubmit={handleAddQuote}
              className="rounded-md border border-border bg-surface-muted p-4"
            >
              <p className="mb-3 text-xs font-semibold text-muted-foreground">
                Add vendor quote
              </p>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
                <div>
                  <Label>Vendor *</Label>
                  <Select
                    value={quoteForm.vendor_id}
                    onChange={(e) =>
                      setQuoteForm({ ...quoteForm, vendor_id: e.target.value })
                    }
                    required
                  >
                    <option value="">— Select vendor —</option>
                    {vendors.map((v) => (
                      <option key={v.id} value={v.id}>
                        {v.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <Label>Total amount</Label>
                  <Input
                    type="number"
                    min="0"
                    step="0.01"
                    placeholder="0.00"
                    value={quoteForm.total_amount}
                    onChange={(e) =>
                      setQuoteForm({
                        ...quoteForm,
                        total_amount: e.target.value,
                      })
                    }
                  />
                </div>

                <div>
                  <Label>Currency</Label>
                  <Select
                    value={quoteForm.currency_code}
                    onChange={(e) =>
                      setQuoteForm({
                        ...quoteForm,
                        currency_code: e.target.value,
                      })
                    }
                  >
                    {currencies.map((c) => (
                      <option key={c.code} value={c.code}>
                        {c.code} — {c.name}
                      </option>
                    ))}
                  </Select>
                </div>

                <div>
                  <Label>Lead days</Label>
                  <Input
                    type="number"
                    min="0"
                    placeholder="e.g. 14"
                    value={quoteForm.lead_days}
                    onChange={(e) =>
                      setQuoteForm({ ...quoteForm, lead_days: e.target.value })
                    }
                  />
                </div>

                <div className="sm:col-span-2">
                  <Label>Notes</Label>
                  <Textarea
                    rows={2}
                    placeholder="Terms, conditions…"
                    value={quoteForm.notes}
                    onChange={(e) =>
                      setQuoteForm({ ...quoteForm, notes: e.target.value })
                    }
                  />
                </div>
              </div>
              <div className="mt-3 flex justify-end gap-2">
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => {
                    setShowQuoteForm(false);
                    setQuoteForm(emptyQuoteFields());
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  size="sm"
                  disabled={isPending || !quoteForm.vendor_id}
                >
                  {isPending ? "Saving…" : "Add quote"}
                </Button>
              </div>
            </form>
          )}

          {rfq.quotes.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No quotes yet. Add vendor quotes above.
            </p>
          ) : (
            <div className="overflow-x-auto rounded-lg border border-border bg-surface">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Vendor
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                      Total
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Currency
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                      Lead time
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Status
                    </th>
                    <th className="px-3 py-2" />
                  </tr>
                </thead>
                <tbody>
                  {rfq.quotes.map((q) => (
                    <QuoteRow
                      key={q.id}
                      quote={q}
                      rfqStatus={rfq.status}
                      canEdit={canEdit}
                      isPending={isPending}
                      onSelect={handleSelect}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>
    </div>
  );
}
