"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { approvePayable, recordPayment } from "@/lib/finance/ap-actions";
import type { PayablePaymentInput } from "@/lib/finance/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Label } from "@/components/ui/label";
import { Card, CardHeader, CardTitle, CardBody } from "@/components/ui/card";
import { useToast } from "@/components/ui/toast";

export function ApproveButton({ payableId }: { payableId: string }) {
  const [isPending, startTransition] = useTransition();
  const { success, error: toastError } = useToast();
  const router = useRouter();

  function handleApprove() {
    startTransition(async () => {
      const result = await approvePayable(payableId);
      if (result.ok) {
        success("Bill approved.");
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  return (
    <Button size="sm" onClick={handleApprove} disabled={isPending}>
      {isPending ? "Approving…" : "Approve"}
    </Button>
  );
}

const PAYMENT_METHODS = ["bank_transfer", "cheque", "cash", "upi", "other"];

export function RecordPaymentForm({
  payableId,
  outstanding,
}: {
  payableId: string;
  outstanding: number;
}) {
  const [isPending, startTransition] = useTransition();
  const { success, error: toastError } = useToast();
  const router = useRouter();
  const [show, setShow] = useState(false);

  const [paymentDate, setPaymentDate] = useState(new Date().toISOString().slice(0, 10));
  const [amount, setAmount] = useState(outstanding.toFixed(2));
  const [method, setMethod] = useState("bank_transfer");
  const [reference, setReference] = useState("");

  function reset() {
    setPaymentDate(new Date().toISOString().slice(0, 10));
    setAmount(outstanding.toFixed(2));
    setMethod("bank_transfer");
    setReference("");
    setShow(false);
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const parsedAmount = parseFloat(amount) || 0;
    if (parsedAmount <= 0) {
      toastError("Amount must be greater than zero.");
      return;
    }

    const payload: PayablePaymentInput = {
      payable_id: payableId,
      payment_date: paymentDate,
      amount: parsedAmount,
      method: method || null,
      reference: reference.trim() || null,
    };

    startTransition(async () => {
      const result = await recordPayment(payload);
      if (result.ok) {
        success("Payment recorded.");
        reset();
        router.refresh();
      } else {
        toastError(result.error);
      }
    });
  }

  if (!show) {
    return (
      <Button size="sm" variant="outline" onClick={() => setShow(true)}>
        Record Payment
      </Button>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Record Payment</CardTitle>
        <span className="text-xs text-muted-foreground">
          Outstanding: {outstanding.toFixed(2)}
        </span>
      </CardHeader>
      <CardBody>
        <form onSubmit={handleSubmit} className="grid grid-cols-2 gap-3">
          <div>
            <Label htmlFor="pmt-date">Payment date *</Label>
            <Input
              id="pmt-date"
              type="date"
              value={paymentDate}
              onChange={(e) => setPaymentDate(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="pmt-amount">Amount *</Label>
            <Input
              id="pmt-amount"
              type="number"
              min="0.01"
              step="0.01"
              max={outstanding}
              value={amount}
              onChange={(e) => setAmount(e.target.value)}
              required
            />
          </div>

          <div>
            <Label htmlFor="pmt-method">Method</Label>
            <Select
              id="pmt-method"
              value={method}
              onChange={(e) => setMethod(e.target.value)}
            >
              {PAYMENT_METHODS.map((m) => (
                <option key={m} value={m}>
                  {m.replace("_", " ").replace(/\b\w/g, (c) => c.toUpperCase())}
                </option>
              ))}
            </Select>
          </div>

          <div>
            <Label htmlFor="pmt-ref">Reference / Cheque No.</Label>
            <Input
              id="pmt-ref"
              value={reference}
              onChange={(e) => setReference(e.target.value)}
              placeholder="UTR / cheque number…"
            />
          </div>

          <div className="col-span-2 flex justify-end gap-2 pt-1">
            <Button type="button" variant="outline" size="sm" onClick={reset}>
              Cancel
            </Button>
            <Button type="submit" size="sm" disabled={isPending}>
              {isPending ? "Recording…" : "Record Payment"}
            </Button>
          </div>
        </form>
      </CardBody>
    </Card>
  );
}
