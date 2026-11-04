"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import { Truncated } from "@/components/ui/truncated";
import { fmtMoney, fmtNumber } from "@/lib/format";
import { AGE_BANDS, type AgeBand } from "@/lib/reports/stock-statement-types";
import { cn } from "@/lib/utils";
import { isAsset, type Row } from "./inventory-table";

/**
 * THE INVENTORY DASHBOARD'S VISUALS (approved mockup 2026-11-04,
 * claude.ai/artifact/T5MtSqBScF3SfXqDvdhSQm). Each card is titled with the question it answers
 * and draws only from the stock layers the page was handed — nothing here is a second figure.
 */

/* ITEM CLASS → COLOUR, FIXED BY THE CLASS, never by its rank on screen (a filter that drops Yarn
   must not repaint Sewing). Blue is the app's primary; the rest are the dataviz reference
   palette's categorical slots, validated against white (all checks pass, 2026-11-04). */
const CLASS_COLOURS: [prefix: string, colour: string][] = [
  ["YARN", "#037bb8"],
  ["FABRIC", "#1baf7a"],
  ["SEWING", "#eb6834"],
  ["PACK", "#6250d6"],
];
export function classColour(itemClass: string): string {
  const u = itemClass.toUpperCase();
  return CLASS_COLOURS.find(([p]) => u.startsWith(p))?.[1] ?? "#8a94a3";
}
export const titleCase = (s: string) => s.toLowerCase().replace(/(^|\s)\S/g, (c) => c.toUpperCase());

/* AGE IS A STATE, so it wears the status tokens — always with a word beside it, never colour alone. */
export const AGE_TONE: Record<AgeBand, { colour: string; word: string }> = {
  "0-30": { colour: "var(--success)", word: "Under 30 days" },
  "31-60": { colour: "var(--muted-foreground)", word: "31–60 days" },
  "61-90": { colour: "var(--warning)", word: "61–90 days" },
  "90+": { colour: "var(--danger)", word: "90+ idle" },
};
const BAND_ORDER = (b: AgeBand) => AGE_BANDS.indexOf(b);
export const oldestBand = (rows: Row[]): AgeBand =>
  rows.reduce<AgeBand>((a, r) => (BAND_ORDER(r.band) > BAND_ORDER(a) ? r.band : a), "0-30");

/** A glowing status dot — the colour lights its own halo (`currentColor`). */
export function Dot({ colour, className }: { colour: string; className?: string }) {
  return (
    <i
      aria-hidden
      className={cn("inline-block size-2 shrink-0 rounded-full shadow-[0_0_6px_1px_currentColor]", className)}
      style={{ background: colour, color: colour }}
    />
  );
}

/** One card: a white ground, a hairline head saying the question. */
export function VizCard({ title, question, right, children, className }: { title: string; question?: string; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={cn("min-w-0 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_-16px_rgba(3,123,184,.25)]", className)}>
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-3.5 py-2">
        <div className="min-w-0">
          <h2 className="text-[13px] font-semibold">{title}</h2>
          {question ? <p className="text-xs text-muted-foreground">{question}</p> : null}
        </div>
        {right}
      </div>
      {children}
    </section>
  );
}

/* --------------------------------------------------------------------------- headline */

export type Headline = {
  value: number | null;
  yarnKg: number;
  yarnValue: number | null;
  yarnCounts: number;
  binsUsed: number;
  binsTotal: number;
  binsUsedHint: string;
  floorLots: number;
  floorQty: number;
  idleLots: number;
  idleValue: number | null;
  idleQty: number;
  oldestDays: number;
  lots: number;
};

export function HeadlineStrip({ h }: { h: Headline }) {
  const tiles: { label: string; value: ReactNode; hint: ReactNode; accent: string }[] = [
    ...(h.value != null
      ? [{ label: "Stock value", value: fmtMoney(h.value), hint: `At the approved PO rate · ${fmtNumber(h.lots)} lots`, accent: "var(--primary)" }]
      : []),
    {
      label: "Yarn on hand",
      value: h.yarnKg ? `${fmtNumber(h.yarnKg)} kg` : "No yarn",
      hint: h.yarnKg ? `${h.yarnCounts} count${h.yarnCounts === 1 ? "" : "s"}${h.yarnValue != null ? ` · ${fmtMoney(h.yarnValue)}` : ""}` : "Nothing in stock",
      accent: classColour("YARN"),
    },
    {
      label: "Bins in use",
      value: (
        <>
          {fmtNumber(h.binsUsed)} <span className="text-sm font-medium text-muted-foreground">of {fmtNumber(h.binsTotal)}</span>
        </>
      ),
      hint: h.binsUsedHint,
      accent: "var(--primary)",
    },
    {
      label: "Not in a bin",
      value: `${fmtNumber(h.floorLots)} lot${h.floorLots === 1 ? "" : "s"}`,
      hint: h.floorLots ? (
        <span className="inline-flex items-center gap-1.5">
          <Dot colour="var(--warning)" />
          Put away · {fmtNumber(h.floorQty)} qty
        </span>
      ) : (
        "Everything is in a bin"
      ),
      accent: h.floorLots ? "var(--warning)" : "var(--success)",
    },
    {
      label: "Idle 90+ days",
      value: h.idleValue != null ? fmtMoney(h.idleValue) : `${fmtNumber(h.idleQty)} qty`,
      hint: (
        <span className="inline-flex items-center gap-1.5">
          <Dot colour={h.idleLots ? "var(--danger)" : "var(--success)"} />
          {h.idleLots ? `${fmtNumber(h.idleLots)} lots — use before buying more` : `Nothing idle · oldest ${fmtNumber(h.oldestDays)} days`}
        </span>
      ),
      accent: h.idleLots ? "var(--danger)" : "var(--success)",
    },
  ];
  return (
    <dl className="grid grid-cols-2 rounded-xl border border-border bg-surface shadow-[0_1px_2px_rgba(16,24,40,.04),0_8px_24px_-16px_rgba(3,123,184,.25)] md:grid-cols-5">
      {tiles.map((t, i) => (
        <div key={t.label} className={cn("relative min-w-0 px-3.5 py-2.5", i > 0 && "md:border-l md:border-border")}>
          <span
            aria-hidden
            className="absolute inset-x-3.5 top-0 h-0.5 rounded-b-sm"
            style={{ background: t.accent, boxShadow: `0 0 10px 1px ${t.accent}` }}
          />
          <dt className="text-xs text-muted-foreground">{t.label}</dt>
          <dd className="mt-0.5 text-xl font-bold tabular-nums tracking-tight">{t.value}</dd>
          <div className="mt-0.5 text-[11.5px] text-muted-foreground">{t.hint}</div>
        </div>
      ))}
    </dl>
  );
}

/* --------------------------------------------------------------------------- yarn cones */

/** A yarn cone: a tapered body on its tube, the wound yarn filling from the base up to `frac`. */
function Cone({ frac, colour, ghost = false, id }: { frac: number; colour: string; ghost?: boolean; id: string }) {
  const top = 20;
  const bot = 112;
  const left = (y: number) => 30 - ((y - top) / (bot - top)) * 18;
  const right = (y: number) => 70 + ((y - top) / (bot - top)) * 18;
  const body = `M${left(top)} ${top} L${right(top)} ${top} L${right(bot)} ${bot} L${left(bot)} ${bot} Z`;
  const fillTop = bot - (bot - top) * Math.max(0, Math.min(1, frac));
  return (
    <svg
      width="92"
      height="122"
      viewBox="0 0 100 128"
      aria-hidden
      className={ghost ? "opacity-40" : undefined}
      style={ghost ? undefined : { filter: "drop-shadow(0 6px 10px rgba(3,123,184,.35))" }}
    >
      <defs>
        <clipPath id={id}>
          <path d={body} />
        </clipPath>
      </defs>
      <path d={body} fill="#f2f5f8" stroke="var(--border)" />
      <g clipPath={`url(#${id})`}>
        <rect x="0" y={fillTop} width="100" height={bot - fillTop} fill={colour} />
        {Array.from({ length: 14 }, (_, i) => (
          <line key={i} x1="0" x2="100" y1={fillTop + i * 7 + 3} y2={fillTop + i * 7} stroke="#fff" strokeOpacity=".28" strokeWidth="1" />
        ))}
      </g>
      <rect x="44" y="6" width="12" height={bot - 2} rx="2" fill="#c9d3dd" />
      <ellipse cx="50" cy={bot + 2} rx={right(bot) - 50} ry="4" fill="#e3e9ef" />
    </svg>
  );
}

export function YarnCones({ rows, withValue }: { rows: Row[]; withValue: boolean }) {
  const yarn = new Map<string, { kg: number; value: number; lots: number; orders: Set<string>; bins: Set<string> }>();
  for (const r of rows) {
    if (!r.item_class.toUpperCase().startsWith("YARN") || !isAsset(r)) continue;
    const y = yarn.get(r.item) ?? { kg: 0, value: 0, lots: 0, orders: new Set(), bins: new Set() };
    y.kg += r.qty;
    y.value += r.value ?? 0;
    y.lots++;
    if (r.order_no !== "—") y.orders.add(r.order_no);
    y.bins.add(r.bin === "—" ? "no bin" : r.bin);
    yarn.set(r.item, y);
  }
  const list = [...yarn.entries()].sort((a, b) => b[1].kg - a[1].kg);
  const max = list[0]?.[1].kg ?? 0;
  return (
    <VizCard title="How much yarn, for which order?" question="One cone per yarn count — the cone fills to its kg">
      <div className="flex items-end gap-5 overflow-x-auto px-3.5 py-3">
        {list.map(([item, y], i) => (
          <div key={item} className="w-36 shrink-0 text-center" title={`${item} · ${fmtNumber(y.kg)} kg · in ${[...y.bins].join(", ")}`}>
            <div className="flex justify-center">
              <Cone frac={max ? y.kg / max : 0} colour={classColour("YARN")} id={`cone-${i}`} />
            </div>
            <Truncated className="mt-1 block text-[13px] font-semibold">{item}</Truncated>
            <div className="text-[11.5px] text-muted-foreground tabular-nums">
              {fmtNumber(y.kg)} kg{withValue ? ` · ${fmtMoney(y.value)}` : ""}
            </div>
            <Truncated className="block text-[11.5px] text-muted-foreground">
              {`${y.lots} lot${y.lots === 1 ? "" : "s"}${y.orders.size ? ` · ${[...y.orders].join(", ")}` : " · General Stock"}`}
            </Truncated>
          </div>
        ))}
        <div className="w-32 shrink-0 text-center">
          <div className="flex justify-center">
            <Cone frac={0} colour={classColour("YARN")} ghost id="cone-next" />
          </div>
          <div className="mt-1 text-[13px] font-semibold text-muted-foreground">{list.length ? "Next yarn count" : "No yarn in stock"}</div>
          <div className="text-[11.5px] text-muted-foreground">appears here when received</div>
        </div>
      </div>
    </VizCard>
  );
}

/* --------------------------------------------------------------------------- value by class */

export function ValueByClass({ rows, withValue }: { rows: Row[]; withValue: boolean }) {
  const by = new Map<string, number>();
  for (const r of rows) if (isAsset(r)) by.set(r.item_class, (by.get(r.item_class) ?? 0) + (withValue ? (r.value ?? 0) : 1));
  const list = [...by.entries()].sort((a, b) => b[1] - a[1]);
  const max = list[0]?.[1] ?? 0;
  const owed = rows.filter((r) => !isAsset(r)).reduce((a, r) => a + (r.value ?? 0), 0);
  return (
    <VizCard title={withValue ? "Where is the money?" : "What is the stock?"} question={withValue ? "Stock value by item class" : "Lots by item class"}>
      <div className="space-y-2.5 px-3.5 py-3">
        {list.map(([cls, v]) => (
          <div key={cls} className="grid grid-cols-[minmax(0,9rem)_minmax(0,1fr)_6.5rem] items-center gap-2.5" title={`${titleCase(cls)} · ${withValue ? fmtMoney(v) : `${v} lots`}`}>
            <Truncated className="text-[12.5px]">{titleCase(cls)}</Truncated>
            <div className="h-3 rounded-r bg-surface-muted">
              <div
                className="h-full rounded-r"
                style={{ width: `${Math.max(1.5, max ? (v / max) * 100 : 0)}%`, background: classColour(cls), boxShadow: `0 0 10px -1px ${classColour(cls)}` }}
              />
            </div>
            <span className="text-right text-[12.5px] font-semibold tabular-nums">{withValue ? fmtMoney(v) : `${fmtNumber(v)} lots`}</span>
          </div>
        ))}
        {list.length === 0 ? <p className="text-sm text-muted-foreground">No stock matches.</p> : null}
        {withValue && owed > 0 ? (
          <p className="text-[11.5px] text-muted-foreground">Rejected / replacement stock ({fmtMoney(owed)}, owed by the vendor) is left out.</p>
        ) : null}
      </div>
    </VizCard>
  );
}

/* --------------------------------------------------------------------------- age tape */

export function AgeTape({ rows, withValue }: { rows: Row[]; withValue: boolean }) {
  const assets = rows.filter(isAsset);
  const of = (b: AgeBand) => assets.filter((r) => r.band === b).reduce((a, r) => a + (withValue ? (r.value ?? 0) : r.qty), 0);
  const parts = AGE_BANDS.map((b) => ({ b, v: of(b) }));
  const total = parts.reduce((a, p) => a + p.v, 0);
  const show = (v: number) => (withValue ? fmtMoney(v) : `${fmtNumber(v)} qty`);
  const idle = parts.find((p) => p.b === "90+")?.v ?? 0;
  return (
    <VizCard title="What is getting old?" question={`${withValue ? "Value" : "Qty"} by days since the receipt came in`}>
      <div className="px-3.5 py-3">
        <div className="flex h-4 gap-0.5">
          {total > 0 ? (
            parts
              .filter((p) => p.v > 0)
              .map((p) => (
                <div
                  key={p.b}
                  className="rounded"
                  title={`${AGE_TONE[p.b].word} · ${show(p.v)}`}
                  style={{ flex: p.v, background: AGE_TONE[p.b].colour, color: AGE_TONE[p.b].colour, boxShadow: "0 0 12px -2px currentColor" }}
                />
              ))
          ) : (
            <div className="flex-1 rounded bg-surface-muted" />
          )}
        </div>
        <div className="mt-2 grid grid-cols-4 gap-2">
          {parts.map((p) => (
            <div key={p.b} className="min-w-0 text-[11.5px] text-muted-foreground">
              <span className="inline-flex items-center gap-1.5">
                <Dot colour={AGE_TONE[p.b].colour} />
                {p.b} days
              </span>
              <b className="block text-sm text-foreground tabular-nums">{show(p.v)}</b>
            </div>
          ))}
        </div>
        <p className="mt-2 text-[11.5px] text-muted-foreground">
          {total === 0
            ? "No stock matches."
            : idle > 0
              ? `${show(idle)} has sat 90+ days — it is red here and on its bin.`
              : "Nothing is older than 90 days. A lot crossing 90 days turns red here and on its bin."}
        </p>
      </div>
    </VizCard>
  );
}

/* --------------------------------------------------------------------------- what needs doing */

export function NeedsDoing({
  floorLots,
  floorText,
  onPutAway,
  canMove,
  owedQty,
  owedText,
  idleLots,
  idleText,
}: {
  floorLots: number;
  floorText: string;
  onPutAway: () => void;
  canMove: boolean;
  owedQty: string | null;
  owedText: string;
  idleLots: number;
  idleText: string;
}) {
  const cell = "min-w-0 border-border px-3.5 py-2.5 md:border-l md:first:border-l-0";
  return (
    <VizCard title="What needs doing?" question="Each line opens the screen that clears it">
      <div className="grid md:grid-cols-3">
        <div className={cell}>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-warning">
            <Dot colour="var(--warning)" />
            Put away
          </span>
          <div className="text-lg font-bold">{floorLots ? `${fmtNumber(floorLots)} lot${floorLots === 1 ? "" : "s"}` : "None"}</div>
          <Truncated className="block text-xs text-muted-foreground">{floorText}</Truncated>
          {floorLots && canMove ? (
            <button type="button" onClick={onPutAway} className="mt-1 text-xs font-semibold text-primary hover:underline">
              Assign a bin →
            </button>
          ) : null}
        </div>
        <div className={cell}>
          <span className="inline-flex items-center gap-1.5 text-[11.5px] font-semibold text-danger">
            <Dot colour="var(--danger)" />
            Owed by vendor
          </span>
          <div className="text-lg font-bold">{owedQty ?? "None"}</div>
          <Truncated className="block text-xs text-muted-foreground">{owedText}</Truncated>
          {owedQty ? (
            <Link href="/purchase/dc?type=replacement" className="mt-1 inline-block text-xs font-semibold text-primary hover:underline">
              Open Delivery Challans →
            </Link>
          ) : null}
        </div>
        <div className={cell}>
          <span className={cn("inline-flex items-center gap-1.5 text-[11.5px] font-semibold", idleLots ? "text-danger" : "text-success")}>
            <Dot colour={idleLots ? "var(--danger)" : "var(--success)"} />
            Idle stock
          </span>
          <div className="text-lg font-bold">{idleLots ? `${fmtNumber(idleLots)} lots` : "None"}</div>
          <Truncated className="block text-xs text-muted-foreground">{idleText}</Truncated>
        </div>
      </div>
    </VizCard>
  );
}
