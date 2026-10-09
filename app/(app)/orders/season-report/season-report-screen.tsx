"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { BarChart3, Download, FileText, LayoutList, Printer } from "lucide-react";
import { fmtDate } from "@/lib/format";
import { usePref } from "@/lib/ui/use-pref";
import { PageHeader } from "@/components/ui/page-header";
import { Select } from "@/components/ui/select";
import { Toggle } from "@/components/ui/toggle";
import { ToggleGroup } from "@/components/ui/segmented";
import { Button } from "@/components/ui/button";
import { byStatus, seasonLabel } from "@/lib/orders/season-report/derive";
import { loadSeasonDetail } from "@/lib/orders/season-report/actions";
import { exportSeasonReportPdf } from "@/lib/orders/season-report/export";
import type { SeasonDetail, SeasonReport } from "@/lib/orders/season-report/types";
import { Attention, Buyers, Gallery, GlassGround, Hero, Ring, Timeline } from "./visuals";
import { TextDetailed, TextSummary } from "./report-text";

/**
 * Orders ▸ Order Management ▸ Season Report — the client half.
 *
 * Season and Year are the URL (a pair, never a date range — see the page), so
 * changing either is a navigation and the server re-reads. Everything else is
 * instant and local: the Shipped / Pending boxes, and which of three views to
 * read the season through.
 *
 *   Overview   the season as a picture — ring, deliveries, buyers, what to chase
 *   Summary    the text report, one row per order
 *   Detailed   the text report, every colour and the pieces under every size
 *
 * The Detailed breakdown costs a Garment Order Sheet per order, so it is fetched
 * the first time Detailed is opened, and kept for the visit.
 */

type View = "overview" | "summary" | "detailed";
const VIEWS = ["overview", "summary", "detailed"] as const;

export function SeasonReportScreen({ report, company }: { report: SeasonReport; company: string | null }) {
  const router = useRouter();
  const [navigating, startNav] = useTransition();
  const [loadingDetail, startDetail] = useTransition();
  const [exporting, setExporting] = useState(false);
  const [view, setView] = usePref<View>("season-report:view", VIEWS, "overview");
  const [showShipped, setShowShipped] = useState(true);
  const [showPending, setShowPending] = useState(true);

  const [details, setDetails] = useState<ReadonlyMap<string, SeasonDetail>>(new Map());
  const [failures, setFailures] = useState<ReadonlyMap<string, string>>(new Map());
  const [loadError, setLoadError] = useState<string | null>(null);

  const label = seasonLabel(report.season, report.year);
  const shown = useMemo(() => byStatus(report.orders, { shipped: showShipped, pending: showPending }), [report.orders, showShipped, showPending]);
  const shippedCount = report.orders.filter((o) => o.fulfilment === "shipped").length;
  const pendingCount = report.orders.length - shippedCount;

  const go = (season: string, year: number | null) => {
    const p = new URLSearchParams();
    if (season) p.set("season", season);
    if (year != null) p.set("year", String(year));
    startNav(() => router.replace(`/orders/season-report${p.size ? `?${p}` : ""}`));
  };

  // THE DETAILED BREAKDOWN, LAZILY — only the orders on screen that have not been fetched.
  const missing = view === "detailed" ? shown.filter((o) => !details.has(o.salesOrderId) && !failures.has(o.salesOrderId)).map((o) => o.salesOrderId) : [];
  const missingKey = missing.join(",");
  useEffect(() => {
    if (!missingKey) return;
    const ids = missingKey.split(",");
    let cancelled = false;
    startDetail(async () => {
      const r = await loadSeasonDetail(ids);
      if (cancelled) return;
      if (!r.ok) {
        setLoadError(r.error);
        // Mark them so a failure does not retry in a loop.
        setFailures((prev) => new Map([...prev, ...ids.map((id) => [id, r.error] as const)]));
        return;
      }
      setLoadError(null);
      const got = new Set(r.details.map((d) => d.salesOrderId));
      setDetails((prev) => new Map([...prev, ...r.details.map((d) => [d.salesOrderId, d] as const)]));
      setFailures(
        (prev) =>
          new Map([
            ...prev,
            ...r.failed.map((f) => [f.salesOrderId, f.reason] as const),
            ...ids.filter((id) => !got.has(id) && !r.failed.some((f) => f.salesOrderId === id)).map((id) => [id, "The breakdown could not be loaded."] as const),
          ]),
      );
    });
    return () => {
      cancelled = true;
    };
  }, [missingKey]);

  const pdf = async (output: "download" | "print") => {
    setExporting(true);
    try {
      await exportSeasonReportPdf({ mode: view === "detailed" ? "detailed" : "summary", label, company, today: report.today, orders: shown, details, output });
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="space-y-4">
      <PageHeader
        title="Season Report"
        back={false}
        description="What is committed to a season, and what is still to ship — pick the season and year, then read it as a picture or as a report."
        actions={
          <ToggleGroup
            role="tablist"
            label="Format"
            value={view}
            onChange={setView}
            options={[
              { value: "overview", label: "Overview", icon: BarChart3 },
              { value: "summary", label: "Summary", icon: LayoutList },
              { value: "detailed", label: "Detailed", icon: FileText },
            ]}
          />
        }
      />

      <div className="flex flex-wrap items-end gap-x-4 gap-y-3">
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Season</span>
          <Select value={report.season} onChange={(e) => go(e.target.value, report.year)} aria-label="Season" className="w-44">
            <option value="">All seasons</option>
            {report.options.seasons.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </Select>
        </label>
        <label className="grid gap-1">
          <span className="text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">Year</span>
          <Select value={report.year ?? ""} onChange={(e) => go(report.season, e.target.value ? Number(e.target.value) : null)} aria-label="Year" className="w-32">
            <option value="">All years</option>
            {report.options.years.map((y) => (
              <option key={y} value={y}>
                {y}
              </option>
            ))}
          </Select>
        </label>
        <div className="flex flex-wrap items-center gap-x-5 gap-y-2 pb-1.5">
          <Toggle id="sr-shipped" label={`Shipped orders (${shippedCount})`} checked={showShipped} onChange={setShowShipped} tone="success" />
          <Toggle id="sr-pending" label={`Pending / in-progress (${pendingCount})`} checked={showPending} onChange={setShowPending} />
        </div>
        {/* IN EVERY VIEW (client 2026-10-09: "I could not find the option to
            download"). It used to appear only under Summary and Detailed, and the
            report opens on Overview — so the first thing a reader saw had no
            download at all. Overview downloads the Summary; Detailed downloads
            the Detailed. */}
        <div className="ml-auto flex items-center gap-2 print:hidden" title={view === "detailed" ? "Colour and size breakdown" : "One row per order"}>
            <Button type="button" variant="primary" size="md" disabled={exporting || loadingDetail || shown.length === 0} onClick={() => void pdf("download")}>
              <Download className="h-4 w-4" />
              Download PDF
            </Button>
            <Button type="button" variant="outline" size="md" disabled={exporting || loadingDetail || shown.length === 0} onClick={() => void pdf("print")}>
              <Printer className="h-4 w-4" />
              Print
            </Button>
        </div>
      </div>

      {report.withoutYear > 0 && (
        <p className="rounded-lg border border-border px-3 py-2 text-sm" style={{ background: "color-mix(in oklab, var(--warning) 10%, transparent)" }}>
          {report.withoutYear} order{report.withoutYear === 1 ? "" : "s"} in this season {report.withoutYear === 1 ? "has" : "have"} no Year set, so {report.withoutYear === 1 ? "it is" : "they are"} left out of {label}. Set the Year on Order Entry ▸ Order Info, or choose “All years” to see {report.withoutYear === 1 ? "it" : "them"}.
        </p>
      )}

      <div className={navigating ? "opacity-60 transition-opacity" : "transition-opacity"} aria-busy={navigating}>
        {report.orders.length === 0 ? (
          <div className="rounded-2xl border border-dashed border-border px-6 py-14 text-center">
            <p className="text-lg font-semibold">No orders in {label}</p>
            <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
              Orders appear here once they are saved on Order Entry with this Season and Year. Try another season, or “All years”.
            </p>
          </div>
        ) : view === "overview" ? (
          shown.length === 0 ? (
            <p className="rounded-2xl border border-dashed border-border px-6 py-10 text-center text-sm text-muted-foreground">
              Both status boxes are unticked — tick Shipped orders or Pending / in-progress to see the season.
            </p>
          ) : (
            <GlassGround>
              <Hero title={label} orders={shown} today={report.today} />
              <div className="grid gap-3.5 lg:grid-cols-3">
                <Ring orders={shown} />
                <Timeline orders={shown} />
                <Buyers orders={shown} />
                <Attention orders={shown} today={report.today} />
              </div>
              <div>
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-[0.1em] text-muted-foreground">
                  Every order · {shown.length} · as of {fmtDate(report.today)}
                </p>
                <Gallery orders={shown} today={report.today} />
              </div>
            </GlassGround>
          )
        ) : view === "summary" ? (
          <TextSummary orders={shown} label={label} today={report.today} company={{ name: company }} />
        ) : (
          <TextDetailed
            orders={shown}
            details={details}
            loading={loadingDetail}
            failures={failures}
            loadError={loadError}
            label={label}
            today={report.today}
            company={{ name: company }}
          />
        )}
      </div>
    </div>
  );
}
