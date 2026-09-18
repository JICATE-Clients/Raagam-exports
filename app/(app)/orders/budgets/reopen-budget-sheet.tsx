"use client";

/**
 * Budget ▸ Reopen (Amendment) — the Amendment Protocol's door (doc/order/budget.md
 * §4.4). An APPROVED budget is the document purchase acts on and the reason
 * its orders are locked; reopening it unlocks them, so it is never a bare
 * button. It asks three things and records them as a revision, beside the
 * approved figures as they stood (the baseline the General section compares
 * against):
 *
 *  - **Source** — who asked: By Customer / By Us. The order module's own words
 *    (`AMENDMENT_SOURCES` reuses `INITIATED_OPTIONS`).
 *  - **Amendment Type** — what kind of change (`AMENDMENT_TYPES`).
 *  - **Reason** — MANDATORY. A reopen with no reason is an approval quietly
 *    undone; the revision history is only worth keeping if every row says why.
 *
 * A sub-detail of an open editor, so AGENTS.md "A sub-detail Sheet's size":
 * `size="sm"`, `alignToPane`, `origin` from the button. Unlike most such sheets
 * it HAS an action of its own — the reopen is written when it is confirmed, not
 * by the budget's Save — so its footer is Cancel / Reopen, not SubSheetFooter.
 */

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Field, FieldGrid } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { Textarea } from "@/components/ui/textarea";
import {
  AMENDMENT_SOURCES,
  AMENDMENT_TYPES,
  type AmendmentSource,
  type AmendmentType,
} from "@/lib/orders/budget/amendment";

export type ReopenAnswers = {
  source: AmendmentSource;
  amendment_type: AmendmentType;
  reason: string;
};

/**
 * MOUNT IT ONLY WHILE OPEN (`{open && <ReopenBudgetSheet … />}`): the answers
 * are this component's own state, so each reopen starts blank rather than
 * carrying the last one's reason — without an effect resetting state behind
 * the operator's back.
 */
export function ReopenBudgetSheet({
  onClose,
  origin,
  isPending,
  budgetLabel,
  onReopen,
}: {
  onClose: () => void;
  origin?: SheetOrigin | null;
  isPending: boolean;
  /** "BDG-0012" or the group — named in the title so the approver knows which
   *  approval they are undoing. */
  budgetLabel: string;
  onReopen: (answers: ReopenAnswers) => void;
}) {
  const [source, setSource] = useState<AmendmentSource>(AMENDMENT_SOURCES[0].value);
  const [type, setType] = useState<AmendmentType>(AMENDMENT_TYPES[0].value);
  const [reason, setReason] = useState("");
  const ready = reason.trim().length > 0;

  return (
    <Sheet
      open
      onClose={onClose}
      title={`Reopen ${budgetLabel} (Amendment)`}
      size="sm"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button
            size="md"
            disabled={!ready || isPending}
            onClick={() => onReopen({ source, amendment_type: type, reason: reason.trim() })}
          >
            {isPending ? "Reopening…" : "Reopen budget"}
          </Button>
        </>
      }
    >
      <FieldGrid>
        <Field label="Source" size="full" htmlFor="ro-source">
          <Select
            id="ro-source"
            value={source}
            onChange={(e) => setSource(e.target.value as AmendmentSource)}
          >
            {AMENDMENT_SOURCES.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Amendment Type" size="full" htmlFor="ro-type">
          <Select id="ro-type" value={type} onChange={(e) => setType(e.target.value as AmendmentType)}>
            {AMENDMENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Reason" required size="full" htmlFor="ro-reason">
          <Textarea
            id="ro-reason"
            rows={3}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
        </Field>
      </FieldGrid>
    </Sheet>
  );
}
