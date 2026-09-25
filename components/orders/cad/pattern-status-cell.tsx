"use client";

/**
 * THE PATTERN QUEUE'S STATUS DROPDOWN (2026-09-25 spec §2: "the status dropdown
 * in the Pattern Queue … Garment Not Received · Acknowledged · Ready"; user:
 * "add on pattern status"). One cell per CAD Queue row, saving the moment it is
 * changed — the Pattern Master's whole job on a row is moving this word.
 *
 * Editable only while the version is assigned and not yet sent: 0638's trigger
 * freezes the status at dispatch, and a sent version was Ready by definition.
 * Everything else reads, never edits. The save goes through `updatePatternWork`
 * with the version's own component cuts, so the Order Sheet notes are left
 * exactly as they are.
 */

import { useTransition } from "react";
import { Select } from "@/components/ui/select";
import { StatusPill } from "@/components/ui/status-pill";
import { useToast } from "@/components/ui/toast";
import { updatePatternWork } from "@/lib/orders/cad-lifecycle/actions";
import {
  PATTERN_STATUSES,
  latestVersion,
  patternStatusMeta,
  type CadStyleRow,
  type PatternStatus,
} from "@/lib/orders/cad-lifecycle/types";

export function PatternStatusCell({ row, canEdit }: { row: CadStyleRow; canEdit: boolean }) {
  const toast = useToast();
  const [isPending, start] = useTransition();
  const v = latestVersion(row.versions);
  if (!v) return <span className="text-muted-foreground">—</span>;

  const meta = patternStatusMeta(v.pattern_status);
  if (!canEdit || v.dispatch || !row.on_order) {
    return <StatusPill tone={meta.tone}>{meta.label}</StatusPill>;
  }

  function change(next: PatternStatus) {
    if (!v || next === v.pattern_status) return;
    start(async () => {
      const r = await updatePatternWork(v.id, { pattern_status: next, component_cuts: v.component_cuts });
      if (!r.ok) toast.error(r.error);
      else toast.success(next === "ready" ? `${row.style_ref_no}: pattern Ready — it can be sent now` : `${row.style_ref_no}: ${patternStatusMeta(next).label}`);
    });
  }

  return (
    <Select
      aria-label={`Pattern Status — ${row.style_ref_no}`}
      value={v.pattern_status}
      disabled={isPending}
      onChange={(e) => change(e.target.value as PatternStatus)}
    >
      {PATTERN_STATUSES.map((p) => (
        <option key={p.value} value={p.value}>
          {p.label}
        </option>
      ))}
    </Select>
  );
}
