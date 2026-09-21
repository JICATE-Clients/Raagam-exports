"use client";

import { useEffect, useRef, useState } from "react";
import { FileText, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import { useModalGuard } from "@/lib/reload-guard";
import { BomQueuePill, bomCardStats } from "@/components/orders/bom-queue";
import { loadFabricBomEntryRegister } from "@/lib/orders/fabric-bom/actions";
import { isReportRefusal, type ReportRefusal } from "@/lib/orders/fabric-bom/report-refusal";
import type {
  EntryRegister,
  EntryRegisterComponentGroup,
} from "@/lib/orders/fabric-bom/reports";
import type { BomTaskRow } from "@/lib/orders/bom-order-basis";

/**
 * FABRIC BOM ▸ THE QUEUE CARD'S DETAIL DRAWER (2026-09-21).
 *
 * A tap on a Fabric BOM queue card slides this in from the right edge: the
 * order's facts, then the plan itself — every component set, its fabric, and
 * the net / gross requirement — grouped by assort colour. The editor is one
 * "Open BOM" press further on.
 *
 * THIS REVERSES 2026-09-18 FOR FABRIC BOM ONLY. The operator had a drawer on
 * this card removed that day ("a touch opens the BOM itself" —
 * `mobile-card-list.tsx`'s `queue` prop). It was asked for again, deliberately,
 * and scoped to this queue; Material BOM's tap still opens its editor.
 *
 * NO FIGURE IS COMPUTED HERE. The requirement is the Entry Register's
 * (`fabricBomEntryRegister`) read through its permission-gated loader — the
 * same numbers the printed register shows, so the drawer and the report can
 * never disagree about what an order needs.
 *
 * A HAND-ROLLED OVERLAY, SO IT DECLARES ITSELF (AGENTS.md "Auto-reload
 * guard"): `useModalGuard(open)` holds off the silent auto-update while it is
 * out. It stays MOUNTED when closed so it can slide out as well as in, and is
 * `inert` then — `hasOpenModalInDom` skips an inert subtree, so a closed drawer
 * is not mistaken for an open one. Escape is consumed on `document` with
 * `preventDefault`, so the window-level "leave the page" rung never also fires.
 */
export function FabricBomDrawer({
  task,
  open,
  onClose,
  onOpenBom,
  onReports,
}: {
  /** The card last tapped. Kept while closing so the panel slides out full. */
  task: BomTaskRow | null;
  open: boolean;
  onClose: () => void;
  /** Into the editor — the existing BOM, or a new one against a Pending order. */
  onOpenBom: (t: BomTaskRow) => void;
  onReports: (bomId: string) => void;
}) {
  useModalGuard(open);

  const panelRef = useRef<HTMLDivElement>(null);
  const bomId = task?.bom_id ?? null;

  /* "Loading" and "stale for a different BOM" are derived at render, never
     stamped from the effect — the reports sheet's shape. */
  const [register, setRegister] = useState<{
    forBom: string;
    data: EntryRegister | ReportRefusal;
  } | null>(null);

  useEffect(() => {
    if (!open || !bomId) return;
    let cancelled = false;
    loadFabricBomEntryRegister(bomId).then(
      (data) => {
        if (!cancelled) setRegister({ forBom: bomId, data });
      },
      () => {
        if (!cancelled) {
          setRegister({ forBom: bomId, data: { refused: "The fabric plan could not be loaded." } });
        }
      },
    );
    return () => {
      cancelled = true;
    };
  }, [open, bomId]);

  /* The parent's `onClose` is usually an inline arrow; reading it through a
     ref keeps the effect below from re-running (and re-grabbing focus) on
     every parent render. */
  const closeRef = useRef(onClose);
  useEffect(() => {
    closeRef.current = onClose;
  });

  useEffect(() => {
    if (!open) return;
    const back = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    panelRef.current?.focus();
    function onKey(e: KeyboardEvent) {
      if (e.key !== "Escape" || e.defaultPrevented) return;
      e.preventDefault();
      closeRef.current();
    }
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("keydown", onKey);
      back?.focus?.();
    };
  }, [open]);

  const data = register && bomId && register.forBom === bomId ? register.data : null;
  const loading = open && !!bomId && data == null;

  return (
    <div inert={!open} aria-hidden={!open || undefined}>
      <div
        aria-hidden
        onClick={onClose}
        className={cn(
          "fixed inset-0 z-50 bg-black/25 transition-opacity duration-300",
          open ? "opacity-100" : "pointer-events-none opacity-0",
        )}
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="fabric-bom-drawer-title"
        tabIndex={-1}
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[440px] max-w-full flex-col border-l border-slate-200 bg-white shadow-2xl outline-none",
          "dark:border-border dark:bg-surface",
          "transition-transform duration-300 ease-out motion-reduce:transition-none",
          open ? "translate-x-0" : "translate-x-full",
        )}
      >
        {task && (
          <>
            {/* HEADER — the card's identity, repeated in full: no truncation
                here, which is the point of opening it. */}
            <div className="flex items-start gap-3 border-b border-slate-200 px-5 py-4 dark:border-border">
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <h2
                    id="fabric-bom-drawer-title"
                    className="font-mono text-sm font-semibold text-foreground"
                  >
                    {task.sc_no ?? task.order_code ?? "—"}
                  </h2>
                  <BomQueuePill status={task.status} />
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  {task.customer_name ?? "—"}
                  {task.po_no ? <span className="font-mono"> · {task.po_no}</span> : null}
                </p>
                {task.bom_code && (
                  <p className="mt-0.5 text-[11px] text-muted-foreground">
                    BOM <span className="font-mono">{task.bom_code}</span>
                  </p>
                )}
              </div>
              <Button variant="ghost" size="icon" aria-label="Close" onClick={onClose}>
                <X />
              </Button>
            </div>

            {/* THE CARD'S THREE FIGURES — `bomCardStats`, so a refusal prints
                the same sentence here as on the card. */}
            <dl className="grid grid-cols-3 gap-3 border-b border-slate-200 px-5 py-3 dark:border-border">
              {bomCardStats(task, { label: "Lines", value: task.bom_line_count }).map((s) => (
                <div key={s.label} className="min-w-0">
                  <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                    {s.label}
                  </dt>
                  <dd className="mt-0.5 text-xs font-semibold tabular-nums text-foreground">
                    {s.value}
                  </dd>
                </div>
              ))}
            </dl>

            <div className="flex-1 overflow-y-auto px-5 py-4">
              {!bomId ? (
                <p className="rounded-md border border-dashed border-slate-200 px-4 py-6 text-center text-xs text-muted-foreground dark:border-border">
                  No fabric BOM yet for this order. Start one to plan fabric per
                  component and colour.
                </p>
              ) : loading ? (
                <p className="text-xs text-muted-foreground">Loading fabric requirement…</p>
              ) : data && isReportRefusal(data) ? (
                <p className="text-xs text-danger">{data.refused}</p>
              ) : data ? (
                <RequirementBody register={data} />
              ) : null}
            </div>

            <div className="flex items-center justify-end gap-2 border-t border-slate-200 px-5 py-3 dark:border-border">
              {bomId && (
                <Button variant="outline" size="md" onClick={() => onReports(bomId)}>
                  <FileText />
                  Reports
                </Button>
              )}
              <Button size="md" onClick={() => onOpenBom(task)}>
                {bomId ? "Open BOM" : "Start Fabric BOM"}
              </Button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

/** One unit for a group's figures, or null when its sizes disagree — a mixed
 *  total is printed bare rather than labelled with a unit half of it is not in. */
function unitOf(c: EntryRegisterComponentGroup): string | null {
  const units = new Set(c.sizes.map((s) => s.uomCode).filter(Boolean));
  return units.size === 1 ? [...units][0]! : null;
}

function Qty({ value, unit }: { value: number; unit?: string | null }) {
  return (
    <span className="tabular-nums">
      {fmtNumber(value)}
      {unit ? <span className="text-muted-foreground"> {unit}</span> : null}
    </span>
  );
}

function RequirementBody({ register }: { register: EntryRegister }) {
  const { groups, grandTotal } = register;

  if (groups.length === 0) {
    return (
      <p className="text-xs text-muted-foreground">
        No fabric lines on this BOM yet — open it to add components and fabrics.
      </p>
    );
  }

  const allUnits = new Set(groups.flatMap((g) => g.components.map(unitOf)));
  const totalUnit = allUnits.size === 1 ? [...allUnits][0] : null;

  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Fabric quantities
        </h3>
        <dl className="mt-2 grid grid-cols-3 gap-2">
          {[
            { label: "Cut Qty", node: <Qty value={grandTotal.sqQty} /> },
            { label: "Net Req", node: <Qty value={grandTotal.netReqWt} unit={totalUnit} /> },
            { label: "Gross", node: <Qty value={grandTotal.grossWt} unit={totalUnit} /> },
          ].map((f) => (
            <div
              key={f.label}
              className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 dark:border-border dark:bg-surface-muted"
            >
              <dt className="text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {f.label}
              </dt>
              <dd className="mt-0.5 text-xs font-semibold text-foreground">{f.node}</dd>
            </div>
          ))}
        </dl>
      </section>

      <section>
        <h3 className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
          Colour breakdown
        </h3>
        <div className="mt-2 space-y-3">
          {groups.map((g, gi) => (
            <div
              key={`${g.combo ?? ""}-${gi}`}
              className="rounded-md border border-slate-200 dark:border-border"
            >
              <div className="flex items-baseline justify-between gap-2 border-b border-slate-200 bg-slate-50 px-3 py-2 dark:border-border dark:bg-surface-muted">
                <span className="text-xs font-semibold text-foreground">
                  {g.combo || "No colourway"}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  Cut {fmtNumber(g.subtotal.sqQty)} · Gross {fmtNumber(g.subtotal.grossWt)}
                </span>
              </div>
              <ul className="divide-y divide-slate-200 dark:divide-border">
                {g.components.map((c) => (
                  <ComponentRow key={c.key} c={c} />
                ))}
              </ul>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

/** One component set: what it is made of, then its size rows. */
function ComponentRow({ c }: { c: EntryRegisterComponentGroup }) {
  const unit = unitOf(c);
  const facts = [c.gsm != null ? `${c.gsm} GSM` : null, c.itemForm].filter(Boolean);
  return (
    <li className="px-3 py-2.5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold text-foreground">
            {c.componentNames.length ? c.componentNames.join(" · ") : "Fabric line"}
          </p>
          <p className="mt-0.5 text-[11px] text-muted-foreground">
            {c.fabricName}
            {facts.length ? ` · ${facts.join(" · ")}` : ""}
          </p>
        </div>
        <div className="shrink-0 text-right text-xs font-semibold text-foreground">
          <Qty value={c.subtotal.grossWt} unit={unit} />
          <p className="text-[10px] font-normal text-muted-foreground">
            net {fmtNumber(c.subtotal.netReqWt)}
          </p>
        </div>
      </div>
      {c.sizes.length > 0 && (
        <table className="mt-2 w-full text-[11px] tabular-nums">
          <thead className="text-muted-foreground">
            <tr>
              <th className="py-0.5 text-left font-medium">Size</th>
              <th className="py-0.5 text-right font-medium">Cut</th>
              <th className="py-0.5 text-right font-medium">Net</th>
              <th className="py-0.5 text-right font-medium">Gross</th>
            </tr>
          </thead>
          <tbody className="text-foreground">
            {c.sizes.map((s, i) => (
              <tr key={`${s.sizeLabel}-${i}`}>
                <td className="py-0.5">{s.sizeLabel}</td>
                <td className="py-0.5 text-right">{fmtNumber(s.sqQty)}</td>
                <td className="py-0.5 text-right">{fmtNumber(s.netReqWt)}</td>
                <td className="py-0.5 text-right">{fmtNumber(s.grossWt)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </li>
  );
}
