"use client";

import { Field } from "@/components/ui/field";
import { Toggle } from "@/components/ui/toggle";
import type { FieldSize, FieldWidth } from "@/lib/ui/sizes";

/**
 * THE RECORD'S ACTIVE / INACTIVE SWITCH ON AN EDITOR — and it is always the
 * FIRST field of the form (2026-10-15, AGENTS.md "Active leads the form").
 *
 * Before this, 19 editors drew the flag by hand — a bare tick box worded
 * "Inactive" on one, "Blocked" on the next, "Active" on a third — and every one
 * of them put it LAST, under the fields, where the operator learns a record is
 * switched off only after scrolling past everything they came to change. The
 * status is a fact about the whole record, so it is read before the record.
 *
 * Three rules this owns so no call site re-derives them:
 *
 * - **Positive state.** `active` is true when the record is ON, whichever of the
 *   three schema spellings sits underneath (`inactive` / `blocked` / `is_active`,
 *   `lib/masters/inactive.ts`). The call site inverts once, at its own state;
 *   the wording on screen is always the same word.
 * - **Edit only.** `isNew` renders nothing: a new record is born active, and a
 *   create form asking whether it should be is the 2026-07-23 masters rule
 *   ("Inactive only on edit") — unchanged.
 * - **It does not steal the opening cursor.** It is a checkbox underneath, and
 *   `focusFirstField` skips checkboxes, so leading the form costs the operator
 *   nothing: the editor still opens with the caret in its first TEXT field.
 *   Tab still reaches it — it is a field, on the field path.
 *
 * Green, like every Active pill and the listing's `StatusToggle`, so the same
 * fact reads the same colour in the list and in the editor.
 */
export function ActiveField({
  active,
  onChange,
  isNew = false,
  id,
  size,
  w,
  disabled,
}: {
  active: boolean;
  onChange: (active: boolean) => void;
  /** A record being created — renders nothing (born active). */
  isNew?: boolean;
  id?: string;
  size?: FieldSize;
  w?: FieldWidth;
  disabled?: boolean;
}) {
  if (isNew) return null;
  return (
    <Field label="Status" size={size} w={w} htmlFor={id}>
      <span data-active-field className="inline-flex min-h-9 items-center gap-2">
        <Toggle
          id={id}
          checked={active}
          onChange={onChange}
          tone="success"
          ariaLabel="Active"
          disabled={disabled}
        />
        <span className={active ? "text-sm text-success" : "text-sm text-danger"}>
          {active ? "Active" : "Inactive"}
        </span>
      </span>
    </Field>
  );
}
