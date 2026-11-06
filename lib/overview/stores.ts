import type { Mood, NeedCell, StripCell } from "@/components/viz/kit";
import { count, outOf, type SayLine } from "./words";

/**
 * STORES ▸ OVERVIEW — "Where is the stock, and what is waiting on the store?" (wave 3,
 * 2026-11-06; plan https://claude.ai/artifact/5e8SGWe8DPHC7Ua2fQyaiW, option A: "a map of the
 * stores that opens Store Overview" — nothing is drawn twice).
 *
 * Read from the same stock layers Store Overview reads (`inventoryDashboard`), for the top-bar
 * unit. ON THE FLOOR = a lot in a store that has bins but is in none of them — the same rule as
 * Store Overview's floor tray. A store without bins (rejection, processing, transit) has no floor.
 */

export type StoreTile = {
  id: string;
  name: string;
  type: string;
  bins: number;
  binsUsed: number;
  lots: number;
  floor: number;
  oldest: number | null;
  value: number | null;
};

const IDLE_DAYS = 90;

export const tileMood = (t: StoreTile): Mood => (t.floor ? "look" : t.oldest != null && t.oldest > IDLE_DAYS ? "problem" : t.lots ? "good" : "quiet");

export function storesOverview(tiles: readonly StoreTile[], pendingQc: number | null) {
  const withStock = tiles.filter((t) => t.lots > 0);
  const bins = tiles.reduce((a, t) => a + t.bins, 0);
  const used = tiles.reduce((a, t) => a + t.binsUsed, 0);
  const floor = tiles.reduce((a, t) => a + t.floor, 0);
  const idle = tiles.filter((t) => t.oldest != null && t.oldest > IDLE_DAYS);
  const lots = tiles.reduce((a, t) => a + t.lots, 0);

  const say: SayLine[] = [];
  if (!tiles.length) say.push({ text: "This unit has no store set up yet.", mood: "quiet", href: "/masters", linkText: "Master Data" });
  else
    say.push({
      text: `${count(lots, "lot")} of stock ${lots === 1 ? "sits" : "sit"} in ${outOf(withStock.length, tiles.length)} stores, using ${outOf(used, bins)} bins.`,
      mood: "normal",
    });
  if (floor)
    say.push({
      text: `${count(floor, "lot")} ${floor === 1 ? "is" : "are"} on the floor, received without a bin: ${tiles.filter((t) => t.floor).map((t) => `${t.name} ${t.floor}`).join(", ")}.`,
      mood: "look",
      href: `/purchase/inventory?store=${tiles.find((t) => t.floor)!.id}`,
      linkText: "Assign a bin",
    });
  if (pendingQc)
    say.push({ text: `${count(pendingQc, "lot")} ${pendingQc === 1 ? "is" : "are"} waiting for a quality check before ${pendingQc === 1 ? "it" : "they"} can be used.`, mood: "look", href: "/stores/qc-pending", linkText: "Pending QC" });
  if (idle.length)
    say.push({ text: `Stock older than ${IDLE_DAYS} days is lying in ${idle.map((t) => t.name).join(", ")}.`, mood: "problem", href: `/purchase/inventory?store=${idle[0].id}`, linkText: "Open the store" });
  if (tiles.length && !floor && !pendingQc && !idle.length) say.push({ text: "Every lot is in a bin, nothing waits for QC, and nothing is older than 90 days.", mood: "good" });

  const strip: StripCell[] = [
    { label: "Stores holding stock", value: outOf(withStock.length, tiles.length), hint: `${count(lots, "lot")}`, mood: "normal", href: "/purchase/inventory" },
    { label: "Bins in use", value: outOf(used, bins), hint: bins ? `${Math.round((used / bins) * 100)}% full` : "no bins set up", mood: "normal" },
    { label: "On the floor", value: count(floor, "lot"), hint: floor ? "no bin yet" : "every lot is in a bin", mood: floor ? "look" : "good" },
    { label: "Waiting for QC", value: pendingQc == null ? "—" : count(pendingQc, "lot"), hint: pendingQc == null ? "needs Reports access" : pendingQc ? "can't be used yet" : "none", mood: pendingQc ? "look" : pendingQc == null ? "quiet" : "good", href: "/stores/qc-pending" },
  ];

  const needs: NeedCell[] = [
    { title: "Put stock away", mood: floor ? "look" : "good", count: floor ? count(floor, "lot") : "None", text: floor ? "received into a store with bins, but in no bin" : "Every lot is in a bin", href: floor ? `/purchase/inventory?store=${tiles.find((t) => t.floor)!.id}` : undefined, linkText: "Assign a bin" },
    { title: "Check quality", mood: pendingQc ? "look" : "good", count: pendingQc ? count(pendingQc, "lot") : "None", text: pendingQc ? "received and waiting for QC" : "Nothing waits for QC", href: pendingQc ? "/stores/qc-pending" : undefined, linkText: "Pending QC" },
    { title: "Old stock", mood: idle.length ? "problem" : "good", count: idle.length ? count(idle.length, "store") : "None", text: idle.length ? `older than ${IDLE_DAYS} days in ${idle.map((t) => t.name).join(", ")}` : `Nothing older than ${IDLE_DAYS} days`, href: idle.length ? `/purchase/inventory?store=${idle[0].id}` : undefined, linkText: "Open the store" },
  ];

  return { say, strip, needs };
}
