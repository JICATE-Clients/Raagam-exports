"use client";

import { useState, useTransition } from "react";
import { useCreateIntent } from "@/lib/use-create-intent";
import { useRouter } from "next/navigation";
import { createPayable } from "@/lib/finance/ap-actions";
import type { PayableInput } from "@/lib/finance/types";
import type {
  VendorForPicker,
  PoForPicker,
  GrnForPicker,
} from "@/lib/finance/ap-service";
import type { LocationForPicker } from "@/lib/finance/gl-service";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

export function NewBillForm({
  vendors,
  pos,
  grns,
  locations,
}: {
  vendors: VendorForPicker[];
  pos: PoForPicker[];
  grns: GrnForPicker[];
  locations: LocationForPicker[];
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [show, setShow] = useState(false);
  useCreateIntent(() => setShow(true));

  const [vendorId, setVendorId] = useState("");
  const [poId, setPoId] = useState("");
  const [grnId, setGrnId] = useState("");
  const [billNo, setBillNo] = useState("");
  const [billDate, setBillDate] = useState(new Date().toISOString().slice(0, 10));
  const [dueDate, setDueDate] = useState("");
  const [currencyCode, setCurrencyCode] = useState("INR");
  const [amount, setAmount] = useState("");
  const [taxAmount, setTaxAmount] = useState("0");
  const [locationId, setLocationId] = useState("");
  const [notes, setNotes] = useState("");

  function reset() {
    setVendorId("");
    setPoId("");
    setGrnId("");
    setBillNo("");
    setBillDate(new Date().toISOString().slice(0, 10));
    setDueDate("");
    setCurrencyCode("INR");
    setAmount("");
    setTaxAmount("0");
    setLocationId("");
    setNotes("");
    setShow(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = parseFloat(amount) || 0;
    if (parsedAmount <= 0) {
      toastError("Amount must be greater than zero.");
      return;
    }

    const payload: PayableInput = {
      vendor_id: vendorId || null,
      purchase_order_id: poId || null,
      grn_id: grnId || null,
      bill_no: billNo.trim() || null,
      bill_date: billDate || null,
      due_date: dueDate || null,
      currency_code: currencyCode || null,
      amount: parsedAmount,
      tax_amount: parseFloat(taxAmount) || 0,
      location_id: locationId || null,
      notes: notes.trim() || null,
    };

    startTransition(async () => {
      const result = await createPayable(payload);
      if (result.ok) {
        success("Bill created.");
        router.push(`/finance/payables/${result.payableId}`);
        reset();
      } else {
        toastError(result.error);
      }
    });
  }

  if (!show) {
    return (
      <div className="flex justify-end">
        <Button size="sm" onClick={() => setShow(true)}>
          + New Bill
        </Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>New Vendor Bill</CardTitle>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 md:grid-cols-3">
            <div>
              <Label htmlFor="bill-vendor">Vendor</Label>
              <Select
                id="bill-vendor"
                value={vendorId}
                onChange={(e) => setVendorId(e.target.value)}
              >
                <option value="">— Select vendor —</option>
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </Select>
            </div>

            {pos.length > 0 && (
              <div>
                <Label htmlFor="bill-po">Purchase Order (optional)</Label>
                <Select
                  id="bill-po"
                  value={poId}
                  onChange={(e) => setPoId(e.target.value)}
                >
                  <option value="">— None —</option>
                  {pos.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.code ?? p.id}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            {grns.length > 0 && (
              <div>
                <Label htmlFor="bill-grn">GRN (optional)</Label>
                <Select
                  id="bill-grn"
                  value={grnId}
                  onChange={(e) => setGrnId(e.target.value)}
                >
                  <option value="">— None —</option>
                  {grns.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.code ?? g.id}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div>
              <Label htmlFor="bill-no">Bill / Invoice No.</Label>
              <Input
                id="bill-no"
                value={billNo}
                onChange={(e) => setBillNo(e.target.value)}
                placeholder="Vendor's invoice number"
              />
            </div>

            <div>
              <Label htmlFor="bill-date">Bill date *</Label>
              <Input
                id="bill-date"
                type="date"
                value={billDate}
                onChange={(e) => setBillDate(e.target.value)}
                required
              />
            </div>

            <div>
              <Label htmlFor="bill-due">Due date</Label>
              <Input
                id="bill-due"
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
              />
            </div>

            <div>
              <Label htmlFor="bill-currency">Currency</Label>
              <Input
                id="bill-currency"
                value={currencyCode}
                onChange={(e) => setCurrencyCode(e.target.value.toUpperCase())}
                placeholder="INR"
                maxLength={3}
              />
            </div>

            <div>
              <Label htmlFor="bill-amount">Amount *</Label>
              <Input
                id="bill-amount"
                type="number"
                min="0.01"
                step="0.01"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                required
              />
            </div>

            <div>
              <Label htmlFor="bill-tax">Tax amount</Label>
              <Input
                id="bill-tax"
                type="number"
                min="0"
                step="0.01"
                value={taxAmount}
                onChange={(e) => setTaxAmount(e.target.value)}
              />
            </div>

            {locations.length > 0 && (
              <div>
                <Label htmlFor="bill-location">Location</Label>
                <Select
                  id="bill-location"
                  value={locationId}
                  onChange={(e) => setLocationId(e.target.value)}
                >
                  <option value="">— All locations —</option>
                  {locations.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </Select>
              </div>
            )}

            <div className="sm:col-span-2 md:col-span-3">
              <Label htmlFor="bill-notes">Notes</Label>
              <Textarea
                id="bill-notes"
                rows={2}
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Internal notes…"
              />
            </div>
          </div>

          {amount && taxAmount && (
            <p className="text-xs text-muted-foreground">
              Total:{" "}
              <span className="font-semibold tabular-nums">
                {((parseFloat(amount) || 0) + (parseFloat(taxAmount) || 0)).toFixed(2)}{" "}
                {currencyCode}
              </span>
            </p>
          )}

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Creating…" : "Create Bill"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
