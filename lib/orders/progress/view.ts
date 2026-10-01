/**
 * Order Progress — the SCREEN's vocabulary over `buildProgress` results
 * (doc/order/digitalisation-plan.md §1; layout approved 2026-10-01 as the
 * "Order Progress Metro" artifact: Overview charts + Orders list).
 *
 * Pure and client-safe. Everything here is derived from `ProgressRow`; nothing
 * re-judges risk — `orderRisk` in engine.ts stays the one rule.
 */

import { addDays, daysBetween } from "@/lib/calendar";
import type { ProgressStage, RiskLevel, StageGroup } from "./engine";
import type { ProgressRow } from "./service";

/** The five buckets the screen colours by. `done` = shipped, closed or cancelled. */
export type Bucket = "late" | "risk" | "ok" | "none" | "done";

export const BUCKETS_OPEN = ["late", "risk", "none", "ok"] as const;
export type OpenBucket = (typeof BUCKETS_OPEN)[number];

export const BUCKET_LABEL: Record<Bucket, string> = {
  late: "Late",
  risk: "At risk",
  ok: "On track",
  none: "No T&A plan",
  done: "Shipped / closed",
};

/** CSS colour per bucket — the app's status tokens, so both themes follow. */
export const BUCKET_COLOR: Record<Bucket, string> = {
  late: "var(--danger)",
  risk: "var(--warning)",
  ok: "var(--success)",
  none: "var(--muted-foreground)",
  done: "var(--info)",
};

export function bucketOf(level: RiskLevel): Bucket {
  switch (level) {
    case "late":
      return "late";
    case "at_risk":
      return "risk";
    case "on_track":
      return "ok";
    case "no_plan":
      return "none";
    default:
      return "done";
  }
}

const OPEN_STATES = new Set(["pending", "in_progress", "overdue"]);

/** Index of the first stage not yet finished — "where the order is now". -1 when all are done. */
export function currentStageIndex(stages: readonly ProgressStage[]): number {
  return stages.findIndex((s) => OPEN_STATES.has(s.view.state));
}

/** Calendar days from today to delivery; negative once it has passed. */
export function daysToDelivery(delivery: string | null, today: string): number | null {
  return delivery ? daysBetween(today, delivery) : null;
}

/** Delivery buckets for the weekly chart: 0 = already past, 1–13 = the week it falls in, 99 = later, -1 = no date. */
export const WEEKS = 13;
export function weekOf(days: number | null): number {
  if (days == null) return -1;
  if (days < 0) return 0;
  if (days >= WEEKS * 7) return 99;
  return 1 + Math.floor(days / 7);
}
export function weekStart(today: string, week: number): string {
  return addDays(today, (week - 1) * 7);
}

/** One flattened, screen-ready order. */
export type ProgressItem = {
  row: ProgressRow;
  bucket: Bucket;
  /** Index into `row.progress.stages` of the stage the order is on; -1 when finished. */
  cur: number;
  days: number | null;
  week: number;
  /** Calendar days late (past delivery, or the projected slip). 0 when not late. */
  lateBy: number;
  qty: number;
  shipped: number;
};

export function toItem(row: ProgressRow, today: string): ProgressItem {
  const days = daysToDelivery(row.deliveryDate, today);
  return {
    row,
    bucket: bucketOf(row.progress.risk.level),
    cur: currentStageIndex(row.progress.stages),
    days,
    week: weekOf(days),
    lateBy: row.progress.risk.daysLate,
    qty: row.orderQty ?? 0,
    shipped: row.progress.shippedQty,
  };
}

const RANK: Record<Bucket, number> = { late: 0, risk: 1, ok: 2, none: 3, done: 4 };

/** Most urgent first: late (most days first), then at risk (most days first), then by delivery date. */
export function byUrgency(a: ProgressItem, b: ProgressItem): number {
  return (
    RANK[a.bucket] - RANK[b.bucket] ||
    b.lateBy - a.lateBy ||
    (a.row.deliveryDate ?? "9999").localeCompare(b.row.deliveryDate ?? "9999") ||
    (a.row.orderNumber ?? "").localeCompare(b.row.orderNumber ?? "")
  );
}

export const GROUP_ORDER: StageGroup[] = ["office", "material", "production", "shipment"];

/** "Holding it up" in words: the stage, and whether delivery has already passed. */
export function holdingText(item: ProgressItem): string {
  const stage = item.cur >= 0 ? item.row.progress.stages[item.cur]?.label : null;
  if (item.bucket === "late") return stage ? `${stage} · past delivery` : "Past delivery";
  if (item.bucket === "risk") return stage ? `${stage} behind` : "Behind plan";
  return stage ?? "Complete";
}

/** Indian short form for piece totals: 1.2L, 45k. */
export function shortQty(n: number): string {
  if (n >= 100000) return `${(n / 100000).toFixed(1).replace(/\.0$/, "")}L`;
  if (n >= 10000) return `${Math.round(n / 1000)}k`;
  if (n >= 1000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}k`;
  return String(n);
}

/** A round step ≥ v, for one dot = N pieces. */
export function niceStep(v: number): number {
  if (v <= 1) return 1;
  const p = Math.pow(10, Math.floor(Math.log10(v)));
  const m = v / p;
  const s = [1, 1.2, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10].find((x) => x >= m) ?? 10;
  return Math.round(s * p);
}
