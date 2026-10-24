"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldRow } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import { useUnsavedGuard } from "@/lib/reload-guard";

/**
 * The one-question dialog a transition that needs a WHY opens — Block today.
 * The reason is mandatory (plan §4: blocking pauses the SLA clock, and a pause
 * nobody explained is the escalation ladder silently switched off), so the
 * field carries `required` and the confirm button waits for it.
 *
 * Remounted per open (the caller keys it), so a reason typed for one job never
 * appears on the next.
 */
export function ReasonSheet({
  open,
  title,
  label,
  confirmLabel,
  isPending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  title: string;
  label: string;
  confirmLabel: string;
  isPending: boolean;
  onConfirm: (reason: string) => void;
  onClose: () => void;
}) {
  const [reason, setReason] = useState("");
  useUnsavedGuard(open && (!!reason.trim() || isPending));
  const ready = !!reason.trim() && !isPending;

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      title={title}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!ready} onClick={() => onConfirm(reason.trim())}>
            {isPending ? "Saving…" : confirmLabel}
          </Button>
        </>
      }
    >
      <FieldRow>
        <Field label={label} required w="name" htmlFor="rh-reason">
          <Textarea id="rh-reason" rows={3} value={reason} onChange={(e) => setReason(e.target.value)} />
        </Field>
      </FieldRow>
    </Sheet>
  );
}
