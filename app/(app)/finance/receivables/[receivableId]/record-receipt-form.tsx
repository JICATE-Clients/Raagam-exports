"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { recordReceipt } from "@/lib/finance/ar-actions";
import { forexToInr } from "@/lib/finance/calc";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { useToast } from "@/components/ui/toast";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";

interface Props {
  receivableId: string;
  currencyCode: string;
  outstandingFc: number;
}

export function RecordReceiptForm({
  receivableId,
  currencyCode,
  outstandingFc,
}: Props) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [open, setOpen] = useState(false);

  const [receiptDate, setReceiptDate] = useState("");
  const [amountFc, setAmountFc] = useState(String(outstandingFc));
  const [exchangeRate, setExchangeRate] = useState("");
  const [reference, setReference] = useState("");

  const parsedAmount = parseFloat(amountFc) || 0;
  const parsedRate = parseFloat(exchangeRate) || 0;
  const liveInr =
    parsedAmount > 0 && parsedRate > 0
      ? forexToInr(parsedAmount, parsedRate)
      : null;

  function reset() {
    setReceiptDate("");
    setAmountFc(String(outstandingFc));
    setExchangeRate("");
    setReference("");
  }

  function handleClose() {
    setOpen(false);
    reset();
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    startTransition(async () => {
      const result = await recordReceipt({
        receivable_id: receivableId,
        receipt_date: receiptDate,
        amount_fc: parseFloat(amountFc) || 0,
        exchange_rate: parseFloat(exchangeRate) || 1,
        reference: reference || null,
      });

      if (result.ok) {
        success("Receipt recorded");
        router.refresh();
        handleClose();
      } else {
        toastError(result.error);
      }
    });
  }

  if (!open) {
    return (
      <div className="flex justify-end">
        <Button onClick={() => setOpen(true)}>Record receipt</Button>
      </div>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record receipt</CardTitle>
      </CardHeader>

      <CardBody>
        <p className="mb-4 text-sm text-muted-foreground">
          Outstanding:{" "}
          <span className="font-semibold text-foreground">
            {currencyCode} {fmtNumber(outstandingFc)}
          </span>
        </p>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <div>
              <Label htmlFor="rr-date">Receipt date</Label>
              <Input
                id="rr-date"
                type="date"
                required
                value={receiptDate}
                onChange={(e) => setReceiptDate(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rr-amount">Amount ({currencyCode})</Label>
              <Input
                id="rr-amount"
                type="number"
                step="0.01"
                min="0.01"
                required
                value={amountFc}
                onChange={(e) => setAmountFc(e.target.value)}
              />
            </div>
            <div>
              <Label htmlFor="rr-rate">
                Exchange rate (1 {currencyCode} = ? INR)
              </Label>
              <Input
                id="rr-rate"
                type="number"
                step="0.0001"
                min="0"
                required
                placeholder="e.g. 106.50"
                value={exchangeRate}
                onChange={(e) => setExchangeRate(e.target.value)}
              />
            </div>
          </div>

          {liveInr != null && (
            <p className="text-sm text-muted-foreground">
              INR equivalent:{" "}
              <span className="font-semibold text-foreground">
                {fmtMoney(liveInr)}
              </span>
            </p>
          )}

          <div>
            <Label htmlFor="rr-ref">Reference (SWIFT / UTR)</Label>
            <Input
              id="rr-ref"
              placeholder="Optional"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={handleClose}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving…" : "Record receipt"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
