"use client";

import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";

/**
 * WHY A BALANCE IS CLOSED (user 2026-11-06, the Close Balance spec). The four quick reasons
 * the spec names, plus OTHER for the operator's own words. The reason stays MANDATORY (0799
 * refuses a blank one) — the list only saves typing for the common cases.
 *
 * Shared by the editor's per-row Close balance and the list's Close balances sheet, so both
 * offer the same words and store the same text.
 */
export const CLOSE_REASONS = ["MOQ FULFILLED", "SUPPLIER SHORTAGE WAIVED", "BOM EXCESS WAIVED", "ORDER PLAN COMPLETED"] as const;

/** The picker's state: a listed reason, or OTHER with typed words. */
export type CloseReasonState = { pick: string; other: string };
export const EMPTY_REASON: CloseReasonState = { pick: "", other: "" };

/** The text stored with the close: the listed reason, or the typed words. Blank = not given. */
export function reasonText(s: CloseReasonState): string {
  return s.pick === "OTHER" ? s.other.trim() : s.pick;
}

export function CloseReasonField({ id, value, onChange }: { id: string; value: CloseReasonState; onChange: (v: CloseReasonState) => void }) {
  return (
    <div className="space-y-2">
      <Field label="Reason for closing" required htmlFor={id}>
        <Select id={id} value={value.pick} onChange={(e) => onChange({ pick: e.target.value, other: e.target.value === "OTHER" ? value.other : "" })}>
          <option value="">Pick a reason</option>
          {CLOSE_REASONS.map((r) => (
            <option key={r} value={r}>
              {r}
            </option>
          ))}
          <option value="OTHER">OTHER (TYPE IT)</option>
        </Select>
      </Field>
      {value.pick === "OTHER" ? (
        <Field label="Your reason" required htmlFor={`${id}-other`}>
          <Input
            id={`${id}-other`}
            maxLength={200}
            value={value.other}
            autoFocus
            onChange={(e) => onChange({ pick: "OTHER", other: e.target.value })}
          />
        </Field>
      ) : null}
    </div>
  );
}
