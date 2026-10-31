"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { useToast } from "@/components/ui/toast";
import { setGrnLineRejection } from "@/lib/purchase/grn-actions";
import { useUnsavedGuard } from "@/lib/reload-guard";
import { fmtNumber } from "@/lib/format";

/**
 * A DRAFT LINE THE QUALITY CHECK FAILED, WITH NOTHING REJECTED (grn-plan.md Phase 4).
 * The check's verdict reaches the line on its own; the qty is the keeper's to say — here,
 * on the GRN, before it is posted. Accepted is re-derived on the server (Received −
 * Rejected). A replacement GRN's rejection is always still owed, so it gets no choice.
 */
export function LineRejectionFix({
  lineId,
  description,
  received,
  isReplacement,
}: {
  lineId: string;
  description: string;
  received: number;
  isReplacement: boolean;
}) {
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [isPending, startTransition] = useTransition();
  const [rejected, setRejected] = useState("");
  const [reason, setReason] = useState("QC FAILED");
  const [action, setAction] = useState<"replace" | "return">("return");
  const dirty = rejected !== "";
  useUnsavedGuard(dirty || isPending);

  const qty = parseFloat(rejected);
  const valid = Number.isFinite(qty) && qty > 0 && qty <= received && !!reason.trim();

  return (
    <div data-focus-scope className="space-y-1 px-4 py-2">
      <p className="text-xs font-medium text-foreground">
        {description} <span className="text-muted-foreground">— received {fmtNumber(received)}</span>
      </p>
      <FieldRow>
        <Field label="Rejected" required w="hug" htmlFor={`rej-${lineId}`}>
          <Input
            id={`rej-${lineId}`}
            type="number"
            min={0}
            max={received}
            inputMode="decimal"
            className="text-right tabular-nums"
            value={rejected}
            onChange={(e) => setRejected(e.target.value)}
          />
        </Field>
        <Field label="Reason" required w="term" htmlFor={`rej-reason-${lineId}`}>
          <Input id={`rej-reason-${lineId}`} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
        {isReplacement ? null : (
          <Field label="QC Failed →" w="term" htmlFor={`rej-action-${lineId}`}>
            <Select
              id={`rej-action-${lineId}`}
              value={action}
              onChange={(e) => setAction(e.target.value === "return" ? "return" : "replace")}
            >
              {/* 0781: Rejection = debit note + requirement reopens; Replacement = no debit, vendor resends. */}
              <option value="return">Rejection (debit note)</option>
              <option value="replace">Replacement (vendor resends)</option>
            </Select>
          </Field>
        )}
        <Field label="">
          <Button
            type="button"
            disabled={!valid || isPending}
            onClick={() =>
              startTransition(async () => {
                const r = await setGrnLineRejection(lineId, {
                  rejected_qty: qty,
                  rejection_reason: reason,
                  rejection_action: action,
                });
                if (r.ok) {
                  setRejected("");
                  success("Rejection saved");
                  router.refresh();
                } else toastError(r.error);
              })
            }
          >
            {isPending ? "Saving…" : "Save rejection"}
          </Button>
        </Field>
      </FieldRow>
    </div>
  );
}
