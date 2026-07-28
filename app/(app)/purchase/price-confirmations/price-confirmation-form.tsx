"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { createPriceConfirmation } from "@/lib/purchase/price-confirmation-actions";
import { APPLICABILITY_TYPES, APPLICABILITY_LABELS } from "@/lib/purchase/price-confirmation-types";
import type { ApplicabilityType } from "@/lib/purchase/price-confirmation-types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { Textarea } from "@/components/ui/textarea";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { useUnsavedGuard } from "@/lib/reload-guard";

type VendorPicker = { id: string; name: string };

export function PriceConfirmationForm({ vendors }: { vendors: VendorPicker[] }) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);
  const [vendorId, setVendorId] = useState("");
  const [poType, setPoType] = useState("all");
  const [applicability, setApplicability] = useState<ApplicabilityType>("U");
  const [effectiveUntil, setEffectiveUntil] = useState("");
  const [notes, setNotes] = useState("");

  const dirty = !!vendorId;
  useUnsavedGuard(open && (dirty || isPending));

  function reset() {
    setVendorId("");
    setPoType("all");
    setApplicability("U");
    setEffectiveUntil("");
    setNotes("");
    setOpen(false);
  }

  function handleSubmit() {
    if (!vendorId) return;
    startTransition(async () => {
      const result = await createPriceConfirmation({
        vendor_id: vendorId,
        po_type: poType || null,
        applicability,
        effective_until: applicability === "E" ? effectiveUntil || null : null,
        notes: notes.trim() || null,
      });
      if (result.ok) {
        success("Price confirmation created.");
        reset();
        router.push(`/purchase/price-confirmations/${result.pcId}`);
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <>
      <Button onClick={() => setOpen(true)}>+ New Confirmation</Button>
      <Sheet open={open} onClose={() => setOpen(false)} title="New Price Confirmation">
        <div className="space-y-4 p-4">
          <div>
            <Label>Vendor *</Label>
            <Select value={vendorId} onChange={(e) => setVendorId(e.target.value)}>
              <option value="">-- Select --</option>
              {vendors.map((v) => (
                <option key={v.id} value={v.id}>{v.name}</option>
              ))}
            </Select>
          </div>
          <div>
            <Label>PO Type</Label>
            <Select value={poType} onChange={(e) => setPoType(e.target.value)}>
              <option value="all">All</option>
              <option value="local">Local</option>
              <option value="import">Import</option>
            </Select>
          </div>
          <div>
            <Label>Applicability</Label>
            <Select value={applicability} onChange={(e) => setApplicability(e.target.value as ApplicabilityType)}>
              {APPLICABILITY_TYPES.map((t) => (
                <option key={t} value={t}>{APPLICABILITY_LABELS[t]}</option>
              ))}
            </Select>
          </div>
          {applicability === "E" && (
            <div>
              <Label>Effective Until</Label>
              <Input type="date" value={effectiveUntil} onChange={(e) => setEffectiveUntil(e.target.value)} />
            </div>
          )}
          <div>
            <Label>Notes</Label>
            <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={reset}>Cancel</Button>
            <Button disabled={isPending || !vendorId} onClick={handleSubmit}>
              {isPending ? "Creating..." : "Create"}
            </Button>
          </div>
        </div>
      </Sheet>
    </>
  );
}
