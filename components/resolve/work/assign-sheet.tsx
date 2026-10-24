"use client";

import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Combobox } from "@/components/ui/combobox";
import { Field } from "@/components/ui/field";
import { Sheet } from "@/components/ui/sheet";
import { useUnsavedGuard } from "@/lib/reload-guard";

export type Person = { id: string; name: string };

/**
 * "Assign to…" — one person for one job or a ticked batch. The server checks
 * each job on its own (`rh_assign`: the person must be an active team member at
 * that unit, or the owner), so the caller reports per-job refusals; this only
 * collects the name. Remounted per open by the caller's `key`.
 */
export function AssignSheet({
  open,
  count,
  people,
  isPending,
  onConfirm,
  onClose,
}: {
  open: boolean;
  /** How many jobs the choice applies to — worded into the title. */
  count: number;
  people: Person[];
  isPending: boolean;
  onConfirm: (assigneeId: string) => void;
  onClose: () => void;
}) {
  const [assignee, setAssignee] = useState("");
  useUnsavedGuard(open && isPending);
  const options = useMemo(() => people.map((p) => ({ value: p.id, label: p.name })), [people]);

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="sm"
      title={count === 1 ? "Assign job" : `Assign ${count} jobs`}
      footer={
        <>
          <Button variant="outline" onClick={onClose}>
            Cancel
          </Button>
          <Button disabled={!assignee || isPending} onClick={() => onConfirm(assignee)}>
            {isPending ? "Assigning…" : "Assign"}
          </Button>
        </>
      }
    >
      <Field label="Assign to" required w="name" htmlFor="rh-assignee">
        <Combobox id="rh-assignee" options={options} value={assignee} onChange={setAssignee} />
      </Field>
    </Sheet>
  );
}
