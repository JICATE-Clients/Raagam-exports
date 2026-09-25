"use client";

/**
 * Order Entry ▸ CAD — this order's CAD lifecycle, per style (user 2026-09-24:
 * "Both" — the CAD team keeps the cross-order list on Orders ▸ CAD ▸ CAD
 * Lifecycle; the merchandiser reads and acts on ONE order here without
 * leaving it).
 *
 * THE SAME STEPS, NOT A COPY. The step forms (shown in place here, as sheets on
 * the list — cad-form-frame.tsx), the corrections menu and the history come
 * from `useCadActions` and `cad-sheets.tsx`, which the listing uses too — so a
 * style can never be offered one step here and another there.
 *
 * ITS OWN COMPONENT, READING ITS OWN ROWS (`getOrderCad`). The order editor
 * returns early above ~19,000 lines and must not grow a hook below that return
 * (AGENTS.md "Hooks above every early return"); a component rendered in a
 * section owns its hooks. Same shape as the Fabric BOM's T&A tab.
 *
 * A SEPARATE DOCUMENT INSIDE THE ORDER (`SeparateDocumentScope`). CAD records
 * are outside the order lock (0576 left them out, 0628 kept it so): a buyer's
 * rework arrives after approval too. So on an approved order this tab still
 * works — but only through its own actions, never the order's Save. The Eye's
 * read-only view passes `canEdit={false}` and the tab shows, never acts.
 */

import { useCallback, useEffect, useState } from "react";
import { RowActions } from "@/components/ui/row-actions";
import { StatusPill } from "@/components/ui/status-pill";
import { Field, FieldRow, SeparateDocumentScope } from "@/components/ui/field";
import { Select } from "@/components/ui/select";
import { fmtDate } from "@/lib/format";
import { readOrderCad, recallOrderCad } from "@/lib/orders/order-tab-reads";
import {
  CAD_STATE_META,
  cadNextStep,
  latestVersion,
  type CadStyleRow,
  type PatternMakerRow,
} from "@/lib/orders/cad-lifecycle/types";
import { useCadActions } from "./use-cad-actions";
import { SectionBody } from "@/components/masters/master-full-screen";
import { DetailSection } from "@/components/masters/detail-section";
import { AllocationSheet, DecisionSheet, DispatchSheet } from "./cad-sheets";

export function OrderCadTab({ orderId, canEdit }: { orderId: string | null; canEdit: boolean }) {
  const [data, setData] = useState<{
    forOrder: string;
    rows: CadStyleRow[];
    employees: PatternMakerRow[];
    canEdit: boolean;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const reload = useCallback(() => setTick((t) => t + 1), []);

  useEffect(() => {
    if (!orderId) return;
    let cancelled = false;
    // A GET route, usually already in flight or answered — the order screen
    // starts it when the order opens (`lib/orders/order-tab-reads.ts`).
    void readOrderCad(orderId).then((r) => {
      if (cancelled) return;
      if (r.ok) {
        setError(null);
        setData({ forOrder: orderId, rows: r.rows, employees: r.employees, canEdit: r.canEdit });
      } else setError(r.error);
    });
    return () => {
      cancelled = true;
    };
  }, [orderId, tick]);

  // Until this mount's own read lands, paint the last answer remembered for
  // the order, so a return to the tab (it remounts each time) is immediate.
  const remembered = orderId ? recallOrderCad(orderId) : undefined;
  const current =
    data && data.forOrder === orderId
      ? data
      : remembered?.ok && orderId
        ? { forOrder: orderId, rows: remembered.rows, employees: remembered.employees, canEdit: remembered.canEdit }
        : null;
  const editable = canEdit && !!current?.canEdit;
  const cad = useCadActions({ employees: current?.employees ?? [], canEdit: editable, onChanged: reload });
  // THE STYLE WHOSE FORM IS SHOWN IN PLACE (user 2026-09-25, screenshot 3059).
  // Declared ABOVE the early returns (AGENTS.md "Hooks above every early
  // return"). Null = the first style that still has a step to take.
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  // Bumped after each saved step so the form remounts from the fresh record —
  // Assign → Send → Approval follow one another without a click in between.
  const [formNonce, setFormNonce] = useState(0);

  if (!orderId) {
    return (
      <p className="text-sm text-muted-foreground">
        Save the order first — the CAD is allocated per style of a saved order.
      </p>
    );
  }
  if (error) {
    return (
      <p role="alert" className="text-sm text-danger">
        {error}
      </p>
    );
  }
  if (!current) return <p className="text-sm text-muted-foreground">Loading the CAD…</p>;

  const onOrder = current.rows.filter((r) => r.on_order);
  const selected =
    onOrder.find((r) => r.key === selectedKey) ??
    onOrder.find((r) => cadNextStep(r.state) !== null) ??
    onOrder[0] ??
    null;

  return (
    <SeparateDocumentScope>
      {/* SectionBody like every other Order Entry section (raagam-screen-layout),
          so the tab's title, spacing and full-width body match Order Info. */}
      <SectionBody title="CAD">
        {onOrder.length === 0 && (
          <p className="text-sm text-muted-foreground">
            This order has no styles yet — add them on Order Info ▸ Style(s), then assign each one&apos;s CAD.
          </p>
        )}
        {/* NO BANNER, NO STATUS LINE (user 2026-09-25: "no need the top located
            two first row"). The form's own title names the style and the step;
            the Fabric BOM editor explains its own refusal when it is opened. The
            Style picker appears only when there is a choice to make. */}
        {selected && onOrder.length > 1 && (
          <FieldRow>
            <Field label="Style" w="term" htmlFor="cad-style">
              <Select id="cad-style" value={selected.key} onChange={(e) => setSelectedKey(e.target.value)}>
                {onOrder.map((r) => (
                  <option key={r.key} value={r.key}>
                    {r.style_ref_no} — {CAD_STATE_META[r.state].label}
                  </option>
                ))}
              </Select>
            </Field>
          </FieldRow>
        )}
        {/* The corrections menu (edit / delete an assignment, undo a send, reopen
            a decision) sits at the right end of the form's title line — a
            corner, not a row. No eye: the user dropped it (2026-09-25); the
            version history stays on Orders ▸ CAD ▸ CAD Lifecycle. */}
        {selected && (
          <div className="relative">
            <div className="absolute right-0 top-0 z-10">
              <RowActions
                label={selected.style_ref_no}
                view={false}
                menu={cad.menuFor(selected)}
                isPending={cad.isPending}
              />
            </div>
            <InlineStep
              key={`${selected.key}|${formNonce}`}
              row={selected}
              employees={current.employees}
              editable={editable}
              onDone={() => {
                setFormNonce((n) => n + 1);
                reload();
              }}
            />
          </div>
        )}
      </SectionBody>
      {cad.sheets}
    </SeparateDocumentScope>
  );
}

/**
 * The selected style's NEXT STEP, as a form in place (user 2026-09-25). The
 * same forms the CAD Lifecycle list opens as sheets — `inline` swaps the frame
 * only (cad-form-frame.tsx) — so the rules and actions are the list's exactly.
 */
function InlineStep({
  row,
  employees,
  editable,
  onDone,
}: {
  row: CadStyleRow;
  employees: PatternMakerRow[];
  editable: boolean;
  onDone: () => void;
}) {
  const step = cadNextStep(row.state);
  const v = latestVersion(row.versions);
  if (!editable || !step) {
    // Nothing to fill: say where the style stands instead of leaving a blank.
    const meta = CAD_STATE_META[row.state];
    return (
      <DetailSection label="CAD Status">
        <div className="flex items-center gap-2 text-sm">
          <span className="font-semibold">{row.style_ref_no}</span>
          <StatusPill tone={meta.tone}>{v ? `${meta.label} (V${v.version_no})` : meta.label}</StatusPill>
        </div>
        {v?.decision?.decided_on && (
          <p className="text-sm text-muted-foreground">Decided {fmtDate(v.decision.decided_on)} · full history under the eye icon.</p>
        )}
        {!editable && step && (
          <p className="text-sm text-muted-foreground">You can view this CAD but not change it.</p>
        )}
      </DetailSection>
    );
  }
  if (step === "allocate" || step === "reallocate") {
    return (
      <AllocationSheet
        inline
        row={row}
        mode={step === "allocate" ? "new" : "reallocate"}
        employees={employees}
        onClose={onDone}
      />
    );
  }
  if (step === "dispatch") return <DispatchSheet inline row={row} onClose={onDone} />;
  return <DecisionSheet inline row={row} onClose={onDone} />;
}
