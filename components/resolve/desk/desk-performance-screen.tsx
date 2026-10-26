"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Download, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Field, FieldRow } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { ToggleGroup } from "@/components/ui/segmented";
import { Truncated } from "@/components/ui/truncated";
import { HBar } from "@/components/resolve/analytics/analytics-view";
import { fmtDate } from "@/lib/format";
import { toCsv } from "@/lib/resolve/csv";
import { cn } from "@/lib/utils";
import type { DeskPerformanceRow } from "@/lib/resolve/desk-types";
import { minutesWords } from "./desk-columns";

const isTotal = (r: DeskPerformanceRow) => !r.profile_id;

/** The CSV carries raw numbers (minutes, percent) so a spreadsheet can sum
 *  and chart them; the screen shows them as words. */
function performanceCsv(rows: DeskPerformanceRow[]): string {
  return toCsv(
    [
      "Technician",
      "Resolved",
      "Avg First Response (min)",
      "Avg Resolution (min)",
      "Response Met %",
      "Resolution Met %",
      "CSAT",
      "CSAT Ratings",
      "Reopened",
      "KB Written",
    ],
    rows.map((r) => [
      isTotal(r) ? "DESK TOTAL" : r.name,
      r.resolved,
      r.avg_first_response_min,
      r.avg_resolution_min,
      r.response_met_pct,
      r.resolution_met_pct,
      r.csat_avg,
      r.csat_count,
      r.reopened,
      r.kb_authored,
    ]),
  );
}

export type PerformancePreset = "week" | "month" | "custom";
export type PerformancePresets = { week: { from: string; to: string }; month: { from: string; to: string } };

const PRESET_OPTIONS: { value: PerformancePreset; label: string }[] = [
  { value: "week", label: "This week" },
  { value: "month", label: "This month" },
  { value: "custom", label: "Custom" },
];

/** A met-rate bar: green at 90 % and above, amber under it, a dash with none. */
function MetBar({ label, pct }: { label: string; pct: number | null }) {
  if (pct == null) {
    return <HBar label={label} value={0} max={100} tone="muted" text={<span className="text-muted-foreground">—</span>} />;
  }
  return <HBar label={label} value={pct} max={100} tone={pct >= 90 ? "success" : "warning"} text={`${Math.round(pct)}%`} />;
}

function PersonCard({ r }: { r: DeskPerformanceRow }) {
  const total = isTotal(r);
  const facts = [
    r.avg_first_response_min != null ? `First reply ${minutesWords(r.avg_first_response_min)}` : null,
    r.avg_resolution_min != null ? `Fix ${minutesWords(r.avg_resolution_min)}` : null,
    `${r.reopened} reopened`,
    `${r.kb_authored} KB written`,
  ].filter(Boolean);
  return (
    <Card className={cn("flex min-w-0 flex-col gap-2 p-3", total && "border-transparent bg-primary-soft")}>
      <div className="flex items-baseline justify-between gap-2">
        <Truncated text={total ? "Desk total" : r.name} className="min-w-0 text-sm font-semibold" />
        <span className="shrink-0 text-xs tabular-nums text-muted-foreground">{r.resolved} resolved</span>
      </div>
      <MetBar label="Response met" pct={r.response_met_pct} />
      <MetBar label="Fixed in time" pct={r.resolution_met_pct} />
      <div className="flex items-center justify-between gap-2 text-xs">
        <span className="text-muted-foreground">Rating</span>
        {r.csat_avg == null ? (
          <span className="text-muted-foreground">No ratings</span>
        ) : (
          <span className="inline-flex items-center gap-1 font-semibold tabular-nums text-warning">
            <Star className="size-3.5 fill-current" aria-hidden />
            {r.csat_avg.toFixed(1)}
            <span className="font-normal text-muted-foreground">({r.csat_count})</span>
          </span>
        )}
      </div>
      <p className="text-[11px] tabular-nums text-muted-foreground">{facts.join(" · ")}</p>
    </Card>
  );
}

/**
 * Service Desk ▸ Performance (plan §6, spec §6.2) — the "increment
 * evaluations" record: per technician, over the tickets RESOLVED in the range,
 * with the desk total first and tinted (`rh_sd_performance`; resolution time
 * excludes paused time). A ticket resolved by nobody in particular counts in
 * the total only, so the cards may sum to less than it.
 *
 * Redrawn phone-first (resolve-mobile mockup, 2026-10-26): period chips in
 * place of From / To / Show, one card per technician. The range still lives in
 * the URL (`?from=&to=`), so a month's figures are a link a manager can send;
 * the preset dates are the server's business-local today, never a client
 * clock. Custom brings back the two dates, and Show is still the only thing
 * that navigates, so a date typed a segment at a time does not refetch.
 */
export function DeskPerformanceScreen({
  from,
  to,
  rows,
  presets,
}: {
  from: string;
  to: string;
  rows: DeskPerformanceRow[];
  presets: PerformancePresets;
}) {
  const router = useRouter();
  const current: PerformancePreset =
    from === presets.week.from && to === presets.week.to
      ? "week"
      : from === presets.month.from && to === presets.month.to
        ? "month"
        : "custom";
  const [preset, setPreset] = useState<PerformancePreset>(current);
  const [draft, setDraft] = useState({ from, to });
  const changed = draft.from !== from || draft.to !== to;
  const valid = !!draft.from && !!draft.to && draft.from <= draft.to;
  const total = rows.find(isTotal);
  const technicians = rows.filter((r) => !isTotal(r));

  function go(range: { from: string; to: string }) {
    router.push(`/resolve/desk/performance?from=${range.from}&to=${range.to}`);
  }

  function pick(next: PerformancePreset) {
    setPreset(next);
    if (next === "week" || next === "month") go(presets[next]);
  }

  function show() {
    if (valid) go(draft);
  }

  function download() {
    const url = URL.createObjectURL(new Blob([performanceCsv(rows)], { type: "text/csv;charset=utf-8" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = `desk-performance-${from}-to-${to}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <ToggleGroup label="Period" value={preset} onChange={pick} options={PRESET_OPTIONS} />
        <Button variant="outline" disabled={!rows.length} onClick={download}>
          <Download aria-hidden />
          Download CSV
        </Button>
      </div>
      {preset === "custom" && (
        // Two 144px dates + the Show button + 2 × 12px gap ≈ 400px → 26rem.
        <FieldRow className="max-w-[26rem] items-end">
          <Field label="From" w="code" htmlFor="sd-perf-from">
            <Input id="sd-perf-from" type="date" value={draft.from} onChange={(e) => setDraft((d) => ({ ...d, from: e.target.value }))} />
          </Field>
          <Field
            label="To"
            w="code"
            htmlFor="sd-perf-to"
            error={draft.from && draft.to && draft.from > draft.to ? "Before From" : undefined}
          >
            <Input id="sd-perf-to" type="date" value={draft.to} onChange={(e) => setDraft((d) => ({ ...d, to: e.target.value }))} />
          </Field>
          <Button variant="outline" disabled={!changed || !valid} onClick={show}>
            Show
          </Button>
        </FieldRow>
      )}
      <p className="text-xs tabular-nums text-muted-foreground">
        Requests resolved {fmtDate(from)} – {fmtDate(to)}
        {technicians.length ? ` · ${technicians.length} technician${technicians.length === 1 ? "" : "s"}` : ""}
      </p>
      {rows.length === 0 ? (
        <Card className="p-6 text-center text-sm text-muted-foreground">No request was resolved in this range.</Card>
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
          {total && <PersonCard r={total} />}
          {technicians.map((r) => (
            <PersonCard key={r.profile_id} r={r} />
          ))}
        </div>
      )}
    </div>
  );
}
