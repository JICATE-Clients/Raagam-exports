"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createGrn } from "@/lib/purchase/grn-actions";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import type { OpenPoLine } from "@/lib/purchase/grn-service";
import type { Vendor } from "@/lib/purchase/types";
import type { QcStatus } from "@/lib/purchase/types";
import { fmtNumber } from "@/lib/format";

interface DraftLine {
  tempId: string;
  poLineItemId: string | null;
  purchaseOrderId: string | null;
  poCode: string | null;
  description: string;
  openBalance: number;
  receivedQty: string;
  acceptedQty: string;
  rejectedQty: string;
  qcStatus: QcStatus;
  rejectionReason: string;
}

function makeTempId(): string {
  return `tmp-${Math.random().toString(36).slice(2, 9)}`;
}

const QC_OPTIONS: { value: QcStatus; label: string }[] = [
  { value: "pending", label: "Pending" },
  { value: "passed", label: "Passed" },
  { value: "failed", label: "Failed" },
  { value: "partial", label: "Partial" },
];

interface Props {
  openPoLines: OpenPoLine[];
  vendors: Pick<Vendor, "id" | "code" | "name">[];
  locations: { id: string; code: string; name: string }[];
}

export function GrnNewForm({ openPoLines, vendors, locations }: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();

  const [vendorId, setVendorId] = useState("");
  const [locationId, setLocationId] = useState("");
  const [grnDate, setGrnDate] = useState(
    new Date().toISOString().split("T")[0],
  );
  const [notes, setNotes] = useState("");
  const [draftLines, setDraftLines] = useState<DraftLine[]>([]);

  // filter available PO lines by vendor (show all when no vendor selected)
  const availableLines = vendorId
    ? openPoLines.filter((l) => l.vendor_id === vendorId)
    : openPoLines;

  // ids already added — avoid duplicates
  const addedPoLineIds = new Set(
    draftLines.map((l) => l.poLineItemId).filter(Boolean),
  );

  function addPoLine(poLine: OpenPoLine) {
    setDraftLines((prev) => [
      ...prev,
      {
        tempId: makeTempId(),
        poLineItemId: poLine.id,
        purchaseOrderId: poLine.purchase_order_id,
        poCode: poLine.po_code,
        description: poLine.description,
        openBalance: poLine.open_balance,
        receivedQty: String(poLine.open_balance),
        acceptedQty: String(poLine.open_balance),
        rejectedQty: "0",
        qcStatus: "pending",
        rejectionReason: "",
      },
    ]);
  }

  function removeLine(tempId: string) {
    setDraftLines((prev) => prev.filter((l) => l.tempId !== tempId));
  }

  function updateLine(
    tempId: string,
    patch: Partial<Omit<DraftLine, "tempId">>,
  ) {
    setDraftLines((prev) =>
      prev.map((l) => (l.tempId === tempId ? { ...l, ...patch } : l)),
    );
  }

  function handleSave() {
    if (!grnDate) {
      toastError("Please enter a GRN date");
      return;
    }

    startTransition(async () => {
      const result = await createGrn({
        vendor_id: vendorId || null,
        location_id: locationId || null,
        grn_date: grnDate,
        notes: notes || null,
        lines: draftLines.map((l, i) => ({
          po_line_item_id: l.poLineItemId,
          purchase_order_id: l.purchaseOrderId,
          description: l.description,
          received_qty: parseFloat(l.receivedQty) || 0,
          accepted_qty: parseFloat(l.acceptedQty) || 0,
          rejected_qty: parseFloat(l.rejectedQty) || 0,
          qc_status: l.qcStatus,
          rejection_reason: l.rejectionReason || null,
          sort_order: i,
        })),
      });

      if (result.ok) {
        success("GRN saved as draft");
        router.push(`/purchase/grn/${result.grnId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <div className="space-y-5">
      {/* Header fields */}
      <Card>
        <CardHeader>
          <CardTitle>GRN Details</CardTitle>
        </CardHeader>
        <CardBody>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <div>
              <Label htmlFor="vendor">Vendor</Label>
              <Select
                id="vendor"
                value={vendorId}
                onChange={(e) => {
                  setVendorId(e.target.value);
                  // clear lines that no longer match the new vendor
                  setDraftLines((prev) =>
                    prev.filter((l) => {
                      if (!l.poLineItemId) return true;
                      const src = openPoLines.find(
                        (p) => p.id === l.poLineItemId,
                      );
                      return src?.vendor_id === e.target.value;
                    }),
                  );
                }}
              >
                <option value="">All vendors</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="location">Location</Label>
              <Select
                id="location"
                value={locationId}
                onChange={(e) => setLocationId(e.target.value)}
              >
                <option value="">Select location</option>
                {locations.map((l) => (
                  <option key={l.id} value={l.id}>
                    {l.name}
                  </option>
                ))}
              </Select>
            </div>
            <div>
              <Label htmlFor="grn-date">GRN Date *</Label>
              <Input
                id="grn-date"
                type="date"
                value={grnDate}
                onChange={(e) => setGrnDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="notes">Notes</Label>
              <Textarea
                id="notes"
                rows={1}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Optional notes"
              />
            </div>
          </div>
        </CardBody>
      </Card>

      {/* Available PO lines */}
      <Card>
        <CardHeader>
          <CardTitle>Available PO Lines</CardTitle>
          <span className="text-xs text-muted-foreground">
            {vendorId
              ? `Showing open lines for selected vendor`
              : `Select a vendor above to filter, or browse all`}
          </span>
        </CardHeader>
        <CardBody className="p-0">
          {availableLines.length === 0 ? (
            <p className="px-4 py-6 text-sm text-muted-foreground">
              No open PO lines found for this vendor. Approve a PO first.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      PO
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Vendor
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Description
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                      Open Qty
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground" />
                  </tr>
                </thead>
                <tbody>
                  {availableLines.map((l) => (
                    <tr
                      key={l.id}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2 text-xs text-muted-foreground">
                        {l.po_code ?? "—"}
                      </td>
                      <td className="px-3 py-2">{l.vendor_name || "—"}</td>
                      <td className="px-3 py-2">{l.description}</td>
                      <td className="px-3 py-2 text-right tabular-nums">
                        {fmtNumber(l.open_balance)}
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="outline"
                          disabled={addedPoLineIds.has(l.id)}
                          onClick={() => addPoLine(l)}
                        >
                          {addedPoLineIds.has(l.id) ? "Added" : "Add"}
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </CardBody>
      </Card>

      {/* Draft lines */}
      {draftLines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Lines to Receive ({draftLines.length})</CardTitle>
          </CardHeader>
          <CardBody className="p-0">
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border bg-surface-muted">
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      PO / Description
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                      Received
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                      Accepted
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground">
                      Rejected
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      QC Status
                    </th>
                    <th className="px-3 py-2 text-left text-xs font-semibold text-muted-foreground">
                      Rejection Reason
                    </th>
                    <th className="px-3 py-2 text-right text-xs font-semibold text-muted-foreground" />
                  </tr>
                </thead>
                <tbody>
                  {draftLines.map((l) => (
                    <tr
                      key={l.tempId}
                      className="border-b border-border last:border-0"
                    >
                      <td className="px-3 py-2">
                        <div className="text-xs text-muted-foreground">
                          {l.poCode ?? "No PO"}
                        </div>
                        <div>{l.description}</div>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          className="w-24 text-right tabular-nums"
                          value={l.receivedQty}
                          onChange={(e) =>
                            updateLine(l.tempId, { receivedQty: e.target.value })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          className="w-24 text-right tabular-nums"
                          value={l.acceptedQty}
                          onChange={(e) =>
                            updateLine(l.tempId, { acceptedQty: e.target.value })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          type="number"
                          min={0}
                          className="w-24 text-right tabular-nums"
                          value={l.rejectedQty}
                          onChange={(e) =>
                            updateLine(l.tempId, { rejectedQty: e.target.value })
                          }
                        />
                      </td>
                      <td className="px-3 py-2">
                        <Select
                          value={l.qcStatus}
                          onChange={(e) =>
                            updateLine(l.tempId, {
                              qcStatus: e.target.value as QcStatus,
                            })
                          }
                          className="w-32"
                        >
                          {QC_OPTIONS.map((o) => (
                            <option key={o.value} value={o.value}>
                              {o.label}
                            </option>
                          ))}
                        </Select>
                      </td>
                      <td className="px-3 py-2">
                        <Input
                          placeholder={
                            parseFloat(l.rejectedQty) > 0 ? "Required" : ""
                          }
                          value={l.rejectionReason}
                          onChange={(e) =>
                            updateLine(l.tempId, {
                              rejectionReason: e.target.value,
                            })
                          }
                          className="w-40"
                        />
                      </td>
                      <td className="px-3 py-2 text-right">
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={() => removeLine(l.tempId)}
                        >
                          Remove
                        </Button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </CardBody>
        </Card>
      )}

      {/* Actions */}
      <div className="flex items-center gap-3">
        <Button
          onClick={handleSave}
          disabled={isPending || draftLines.length === 0}
        >
          {isPending ? "Saving…" : "Save as Draft"}
        </Button>
        <Button
          variant="outline"
          onClick={() => router.push("/purchase/grn")}
          disabled={isPending}
        >
          Cancel
        </Button>
        {draftLines.length === 0 && (
          <span className="text-sm text-muted-foreground">
            Add at least one line to save
          </span>
        )}
      </div>
    </div>
  );
}
