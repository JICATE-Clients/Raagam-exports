"use client";

import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Truncated } from "@/components/ui/truncated";
import type { BinMove } from "@/lib/stores/bin-history-actions";
import { fmtDate, fmtMoney, fmtNumber } from "@/lib/format";
import type { Row } from "./inventory-table";
import { AGE_TONE, classColour, Dot, titleCase, VizCard } from "./inventory-visuals";

/**
 * THE BIN PANEL — Purchase Store ▸ Overview's inspector (phase 1, user 2026-11-04: "maintain bin
 * details"; plan claude.ai/artifact/CXG8BjwjqJLEGzaMsKfqMt). Whatever bin is picked on the rack or
 * in the list: where it is, what is in it, whether it is MIXED (and the one-click fix), every
 * movement it has seen. (Bin details / description removed 2026-11-05, user.) The panel never moves stock itself — every move
 * button hands the lots to the dashboard's one Move flow (pick → bin → confirm, 0809).
 */

export type PanelBin = { id: string; bin_code: string | null; store_id: string; inactive: boolean; description: string | null };

export function BinPanel({
  bin,
  storeName,
  place,
  lots,
  history,
  withValue,
  canMove,
  mixed,
  suggestion,
  floorCount,
  onMove,
  onFixMixed,
  onPutHere,
}: {
  bin: PanelBin | null;
  storeName: string;
  /** "shelf 01 · position 1", or "not in the numbering". */
  place: string;
  lots: Row[];
  /** null while it loads. */
  history: BinMove[] | null;
  withValue: boolean;
  canMove: boolean;
  mixed: { classes: string[]; orders: string[]; minority: string } | null;
  /** The nearest empty bin in the same store — where a Mixed bin's minority should go. */
  suggestion: string | null;
  floorCount: number;
  onMove: (keys: string[]) => void;
  onFixMixed: () => void;
  onPutHere: () => void;
}) {
  if (!bin) {
    return (
      <VizCard title="Bin" question="Pick a bin on the rack or in the list">
        <p className="px-3.5 py-3 text-sm text-muted-foreground">
          {storeName ? `${storeName} has no bins — a Rejection, Processing or In Transit store keeps its stock without them.` : "No store is picked."}
        </p>
      </VizCard>
    );
  }
  return (
    <BinPanelBody
      bin={bin}
      storeName={storeName}
      place={place}
      lots={lots}
      history={history}
      withValue={withValue}
      canMove={canMove}
      mixed={mixed}
      suggestion={suggestion}
      floorCount={floorCount}
      onMove={onMove}
      onFixMixed={onFixMixed}
      onPutHere={onPutHere}
    />
  );
}

function BinPanelBody({
  bin,
  place,
  lots,
  history,
  withValue,
  canMove,
  mixed,
  suggestion,
  floorCount,
  onMove,
  onFixMixed,
  onPutHere,
}: Parameters<typeof BinPanel>[0] & { bin: PanelBin }) {
  const value = lots.reduce((a, r) => a + (r.value ?? 0), 0);
  const oldest = lots.length ? Math.max(...lots.map((r) => r.age_days)) : null;

  const fact = (label: string, v: string) => (
    <div className="flex items-baseline gap-1.5 whitespace-nowrap">
      <dt className="text-[10.5px] tracking-wide text-muted-foreground uppercase">{label}</dt>
      <dd className="text-sm font-bold tabular-nums">{v}</dd>
    </div>
  );
  const section = "border-t border-border px-3.5 py-2.5";
  const heading = "mb-1.5 flex items-center justify-between text-[10.5px] font-semibold tracking-wide text-muted-foreground uppercase";

  return (
    <section className="min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_-16px_rgba(3,123,184,.25)] xl:flex xl:min-h-0 xl:flex-1 xl:flex-col">
      {/* identity — ONE STATEMENT OF EACH FACT (user 2026-11-04, screenshot 4056). The header used
          to repeat what the panel already says below it: a Mixed chip over the mixed warning, an
          In use / Empty chip over the lot list (or its "nothing is booked" line), an Active chip on
          every bin, the store name the store tab already shows, a Lots count of the cards beneath,
          and a Last move that is History's first row. What is left is the bin, where it is, and the
          two figures no row below adds up for you. Only the EXCEPTION is a chip: Inactive.
          All of it on ONE ROW (user, same day): the bin and where it is on the left, its figures on
          the right. It NEVER wraps (screenshot 193801 showed the figures dropping to a second line):
          the place shortens to an ellipsis instead, and its whole text shows on hover. */}
      <div className="flex items-baseline gap-x-2.5 px-3.5 py-2">
        <span className="shrink-0 font-mono text-xl font-bold">{bin.bin_code}</span>
        <Truncated className="min-w-0 flex-1 text-xs text-muted-foreground">{place}</Truncated>
        {bin.inactive ? <span className="shrink-0 rounded-full bg-surface-muted px-2 py-0.5 text-[11px] font-semibold text-muted-foreground">Inactive</span> : null}
        {lots.length ? (
          <dl className="flex shrink-0 items-baseline gap-x-3">
            {fact(withValue ? "Value" : "Qty", withValue ? fmtMoney(value) : fmtNumber(lots.reduce((a, r) => a + r.qty, 0)))}
            {fact("Oldest", oldest != null ? `${oldest} d` : "—")}
          </dl>
        ) : null}
      </div>

      {/* EVERYTHING UNDER THE FACTS SCROLLS INSIDE THE PANEL on a wide screen (screen-fit layout,
          screenshot 4051): the bin's name and figures stay put while its lots and history scroll. */}
      <div className="xl:min-h-0 xl:flex-1 xl:overflow-y-auto">
      {/* keep it clean */}
      {mixed ? (
        <div className={section}>
          <div className="flex items-start gap-2 rounded-lg border border-warning/50 bg-warning-soft/50 px-2.5 py-2 text-[12px] shadow-[0_0_16px_-8px_rgba(250,178,25,.8)]">
            <Dot colour="var(--warning)" className="mt-1" />
            <div className="min-w-0">
              <b>
                {mixed.classes.length > 1 ? mixed.classes.map(titleCase).join(" and ") : `${mixed.orders.length} orders`} share {bin.bin_code}
              </b>
              {mixed.orders.length > 1 ? ` — ${mixed.orders.join(", ")}.` : "."}{" "}
              {suggestion
                ? `Move the ${titleCase(mixed.minority).toLowerCase()} to the nearest free bin, ${suggestion}, so each bin holds one thing.`
                : "There is no free bin in this store to move it to."}
              {canMove && suggestion ? (
                <div className="mt-1.5">
                  <Button size="sm" onClick={onFixMixed}>
                    <ArrowRightLeft className="size-3.5" aria-hidden />
                    Move {titleCase(mixed.minority).toLowerCase()} to {suggestion}
                  </Button>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}

      {/* contents */}
      <div className={section}>
        <div className={heading}>
          <span>What is in it{lots.length ? ` (${fmtNumber(lots.length)})` : ""}</span>
          {canMove && lots.length > 1 ? (
            <button type="button" onClick={() => onMove(lots.map((r) => r.key))} className="text-[11.5px] font-semibold tracking-normal text-primary normal-case hover:underline">
              Move whole bin →
            </button>
          ) : null}
        </div>
        {lots.length ? (
          <ul className="grid gap-1.5">
            {lots.map((r) => (
              <li key={r.key} className="grid grid-cols-[6px_minmax(0,1fr)_auto] items-center gap-2.5 rounded-lg border border-border px-2.5 py-1.5">
                <span className="self-stretch rounded-[3px]" style={{ background: classColour(r.item_class), boxShadow: `0 0 8px 0 ${classColour(r.item_class)}` }} />
                <span className="min-w-0">
                  <Truncated className="block text-[12.5px] font-semibold">{r.item}</Truncated>
                  <Truncated className="block text-[11.5px] text-muted-foreground">
                    {`${r.reference} · lot ${r.lot} · ${r.order_no === "—" ? "General Stock" : r.order_no}`}
                  </Truncated>
                  <span className="inline-flex items-center gap-1.5 text-[11.5px] text-muted-foreground">
                    <Dot colour={AGE_TONE[r.band].colour} className="size-1.5" />
                    {r.age_days} days · in {fmtDate(r.in_date)}
                  </span>
                </span>
                <span className="text-right text-[12.5px] font-semibold tabular-nums">
                  {fmtNumber(r.qty)} {r.uom}
                  {withValue ? <small className="block font-normal text-muted-foreground">{fmtMoney(r.value ?? 0)}</small> : null}
                  {canMove ? (
                    <button type="button" onClick={() => onMove([r.key])} className="block w-full text-right text-[11.5px] font-semibold text-primary hover:underline">
                      Move →
                    </button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <>
            <p className="text-sm text-muted-foreground">Nothing is booked to {bin.bin_code}. It is free to put stock into.</p>
            {canMove && floorCount ? (
              <Button size="sm" className="mt-1.5" onClick={onPutHere}>
                <ArrowRightLeft className="size-3.5" aria-hidden />
                Put away here — {floorCount} lot{floorCount === 1 ? "" : "s"} on the floor
              </Button>
            ) : null}
          </>
        )}
      </div>

      {/* history */}
      <div className={section}>
        <div className={heading}>History</div>
        {history === null ? (
          <p className="text-sm text-muted-foreground">Loading…</p>
        ) : history.length ? (
          <ol className="max-h-64 overflow-y-auto xl:max-h-none xl:overflow-visible">
            {history.map((m, i) => (
              <li key={m.id} className="relative pb-2 pl-5 text-[12px]">
                <span
                  aria-hidden
                  className="absolute top-1 left-1 size-[7px] rounded-full"
                  style={{ background: m.sign > 0 ? classColour(m.item_class) : "var(--muted-foreground)", boxShadow: "0 0 6px 1px currentColor", color: m.sign > 0 ? classColour(m.item_class) : "var(--muted-foreground)" }}
                />
                {i < history.length - 1 ? <span aria-hidden className="absolute top-3.5 bottom-0 left-[7px] w-px bg-border" /> : null}
                <div>
                  <b>{m.word}</b> · <span className="font-mono">{m.ref}</span>
                </div>
                <Truncated className="block">{`${m.sign > 0 ? "+" : "−"}${fmtNumber(m.qty)} ${m.uom} ${m.item}${m.lot ? ` · lot ${m.lot}` : ""}`}</Truncated>
                <div className="text-[11px] text-muted-foreground">{fmtDate(m.date)}</div>
              </li>
            ))}
          </ol>
        ) : (
          <p className="text-sm text-muted-foreground">No movement has ever been booked to {bin.bin_code}.</p>
        )}
      </div>

      </div>
    </section>
  );
}
