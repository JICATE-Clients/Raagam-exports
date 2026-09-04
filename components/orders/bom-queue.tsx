"use client";

import { useMemo, useState, type ReactNode } from "react";
import { Check, Clock3, HelpCircle, Pencil, RotateCcw } from "lucide-react";
import { today as todayAtFactory } from "@/lib/calendar";
import { fmtDate, fmtNumber } from "@/lib/format";
import { Label } from "@/components/ui/label";
import { Select } from "@/components/ui/select";
import { FilterBar } from "@/components/ui/filter-bar";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { MobileCardList, type CardStat } from "@/components/masters/mobile-card-list";
import { createdMeta, hasCreatedInfo } from "@/components/ui/created-columns";
import {
  BOM_STATUSES,
  BOM_STATUS_RANK,
  bomStatusHint,
  bomStatusText,
  bomStatusTone,
  type BomStatus,
} from "@/lib/orders/bom-status";
import type { BomTaskRow } from "@/lib/orders/bom-order-basis";

/**
 * THE WORK QUEUE EVERY BOM SCREEN OPENS ON — one declaration, two readers.
 *
 * Material BOM and Fabric BOM are the same question asked about two different
 * documents: "which confirmed orders still need planning?". They already share
 * the row (`BomTaskRow`), the status vocabulary, the freshness pairing and the
 * sort — all `bom-order-basis.ts`'s, deliberately, so the two cannot come to
 * disagree about what "Recalculate" means. What they did NOT share was the way
 * that answer is DRAWN, and so they drifted: Material BOM's queue became a
 * six-across card grid with a counted Status facet and a summary sentence
 * (client 2026-08-17 · 08-19 · 08-21), while Fabric BOM stayed the `DataTable`
 * both started as (client screenshot 2590, 2026-09-01: "this screen also like
 * the material bom listing … not like this list").
 *
 * SO THE FIX IS THE COMPONENT, NOT THE SCREEN. AGENTS.md's repeated lesson is
 * that the fan-out is always on the hand-rolled half — a per-screen answer to a
 * shared rule always leaves a remainder, and here the remainder was every BOM
 * screen that was not the one being worked on that week. Everything below
 * arrived as an instruction about Material BOM's queue and is now true of both,
 * and of the third BOM queue when it is written.
 *
 * WHAT STAYS AT THE CALL SITE is what genuinely differs: the `PageHeader` (the
 * screen's own title, description and "+ New" button), what opening a row does,
 * what deleting one does, and the ONE figure in the middle of a card. Everything
 * else — the search, the counted facet, the summary, the card, the Created pair
 * — is here.
 */

/**
 * "· 12d" beside a delivery date, and "· 12d late" when it has passed.
 *
 * THE DATE SAYS WHEN AND THE SUFFIX SAYS HOW SOON, which are different
 * questions: a merchandiser scanning a queue is deciding what to plan THIS
 * WEEK, and arithmetic against thirty dates is what they were doing by eye.
 *
 * SILENT BEYOND 60 DAYS. A "· 109d" on an order shipping in December is noise
 * on every card, and noise on every card is what stops the two that say "· 4d"
 * from being seen. Late is never silent and is the only one that takes a
 * colour.
 *
 * NO HYDRATION GUARD IS NEEDED, and that is `todayAtFactory`'s doing rather
 * than luck. It formats in Asia/Kolkata, so the server (UTC) and the operator's
 * browser (IST) agree on what day it is — including during the 5.5 hours every
 * morning when `new Date()` does not. Do not reach for the UTC `today()` that
 * `lib/dashboard/range.ts` exports here.
 */
export function DaysOut({ iso }: { iso: string }) {
  const at = Date.parse(`${iso.slice(0, 10)}T00:00:00`);
  const now = Date.parse(`${todayAtFactory()}T00:00:00`);
  if (Number.isNaN(at) || Number.isNaN(now)) return null;
  const days = Math.round((at - now) / 86_400_000);

  if (days < 0) {
    return <span className="font-normal text-danger"> · {-days}d late</span>;
  }
  if (days === 0) return <span className="font-normal text-danger"> · today</span>;
  if (days > 60) return null;
  return <span className="font-normal text-muted-foreground"> · {days}d</span>;
}

/**
 * THE THREE FIGURES A QUEUE CARD CARRIES, and the order of them is the point.
 *
 * It was Styles · Production · Delivery at one weight, so nothing was
 * emphasised and nothing was scannable (client 2026-08-21, screenshot 2440). A
 * BOM multiplies the production quantity — it is the number the document is FOR
 * — and a merchandiser going down the queue is going down the quantities.
 * Delivery is the urgency and holds the right edge, where dates line up down
 * the grid; the count in the middle is the least of the three and no longer
 * leads.
 *
 * A REFUSAL STILL PRINTS ITS SENTENCE, never a dash and never 0 — "no
 * production quantity yet" and "nothing entered" look identical as a dash and
 * only one of them is actionable. `CardStat.value` is a node for this reason;
 * the strip truncates it and reveals it on hover, so an unanswerable card
 * cannot set the height of its whole row. A missing delivery date IS still a
 * dash: "the system tried and cannot answer" and "nobody has entered one" are
 * different facts, and only the first is a sentence.
 *
 * THE MIDDLE FIGURE IS THE CALLER'S, because it is the one thing about this
 * card that is genuinely about WHICH BOM this is. Material BOM counts the
 * order's styles; Fabric BOM counts the fabric lines already planned, which is
 * what its table showed and what an operator picking up a half-done BOM looks
 * for. Both come off the same `BomTaskRow`, so neither costs a query.
 */
export function bomCardStats(t: BomTaskRow, middle: CardStat): CardStat[] {
  return [
    {
      label: "Production",
      value:
        t.production_qty != null
          ? fmtNumber(t.production_qty)
          : (t.production_refusal ?? "—"),
    },
    middle,
    {
      label: "Delivery",
      value: t.delivery_date ? (
        <>
          {fmtDate(t.delivery_date)}
          <DaysOut iso={t.delivery_date} />
        </>
      ) : (
        "—"
      ),
    },
  ];
}

/**
 * ONE GLYPH PER STATUS, FOR THE CARD'S BADGE — a verb, not a category (client
 * 2026-09-04, from a reference card whose badge held an app icon: "design for
 * us"). `bomStatusTone` already says the COLOUR; this says what the row is
 * waiting on, the same five states `bom-status.ts` names and nothing more:
 * a clock before anything is planned, a pencil mid-draft, a check once the
 * plan matches the order, a re-plan arrow once it no longer does, and a
 * question mark when the order itself cannot be read. Not exported — the
 * badge is `BomQueue`'s own decoration, not a fact another screen reads.
 */
function bomStatusIcon(s: BomStatus) {
  switch (s) {
    case "pending":
      return <Clock3 className="h-4 w-4" />;
    case "draft":
      return <Pencil className="h-4 w-4" />;
    case "updated":
      return <Check className="h-4 w-4" />;
    case "recalculate":
      return <RotateCcw className="h-4 w-4" />;
    default:
      return <HelpCircle className="h-4 w-4" />;
  }
}

export function BomQueue({
  tasks,
  noun,
  stat,
  onOpen,
  canDelete = false,
  onDelete,
  isPending = false,
}: {
  tasks: BomTaskRow[];
  /**
   * The word this queue's document is made of — "material", "fabric".
   *
   * It is the ONLY string the two screens differ by, so it is one prop rather
   * than three: the summary sentence, the "nothing left to do" line and the
   * empty state are all built from it below. A screen passing its own three
   * strings is how the pair drifts apart again, one sentence at a time.
   */
  noun: string;
  /** The card's middle figure — see `bomCardStats`. */
  stat: (t: BomTaskRow) => CardStat;
  onOpen: (t: BomTaskRow) => void;
  canDelete?: boolean;
  onDelete?: (t: BomTaskRow) => void;
  isPending?: boolean;
}) {
  const [query, setQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState<"" | BomStatus>("");

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    return tasks.filter((t) => {
      if (statusFilter && t.status !== statusFilter) return false;
      if (!needle) return true;
      return [t.sc_no, t.order_code, t.po_no, t.customer_name].some((v) =>
        (v ?? "").toLowerCase().includes(needle),
      );
    });
  }, [tasks, query, statusFilter]);

  /**
   * HOW MANY ORDERS SIT IN EACH STATE, IN THE ORDER THE WORK SHOULD BE DONE —
   * not in `BOM_STATUSES` declaration order and never sorted by count.
   *
   * `BOM_STATUS_RANK` has said "order of work for the dashboard: what needs
   * doing, first" since the statuses were extracted, and until this list read it
   * nothing on screen did: the queue was sorted by it invisibly, and the filter
   * offered the five states in declaration order. Sorting by count would bury
   * Recalculate — the one state that means a plan is silently wrong — beneath
   * Updated on any healthy queue.
   */
  const statusCounts = useMemo(
    () =>
      [...BOM_STATUSES]
        .sort((a, b) => BOM_STATUS_RANK[a] - BOM_STATUS_RANK[b])
        .map((status) => ({
          status,
          count: tasks.filter((t) => t.status === status).length,
        })),
    [tasks],
  );

  /**
   * WHAT THE QUEUE AMOUNTS TO — the one figure a merchandiser wants before
   * reading any card, and the one the cards cannot show.
   *
   * FOUR BRANCHES, BECAUSE THREE OF THEM ARE TRUE AT DIFFERENT TIMES and only
   * the first is the happy one. An order whose production quantity is refused
   * (`production_qty` null — no Approval Qty rows) cannot be added to a total,
   * so it is counted SEPARATELY rather than silently dropped: a sentence that
   * says "7,150 pieces across 3 orders" while a fourth order sits unplanned and
   * untotalled is exactly the kind of number that gets believed.
   */
  const queueSummary = useMemo(() => {
    const open = tasks.filter((t) => t.status !== "updated");
    const totalled = open.filter((t) => t.production_qty != null);
    const untotalled = open.length - totalled.length;
    const pieces = totalled.reduce((n, t) => n + (t.production_qty ?? 0), 0);

    if (totalled.length > 0) {
      return `${fmtNumber(pieces)} pieces across ${totalled.length} order${totalled.length === 1 ? "" : "s"} waiting on a ${noun} plan${
        untotalled > 0 ? ` · ${untotalled} more cannot be totalled yet` : ""
      }`;
    }
    if (untotalled > 0) {
      return `${untotalled} order${untotalled === 1 ? "" : "s"} waiting on a ${noun} plan · none can be totalled yet`;
    }
    return tasks.length > 0 ? `Every confirmed order has a current ${noun} plan.` : null;
  }, [tasks, noun]);

  /** False when the service does not select `created_at` — then the card shows
   *  no Created line at all, rather than a dangling date. `hasCreatedInfo` is the
   *  same guard `withCreatedColumns` applies to a table. */
  const showCreated = hasCreatedInfo(tasks);

  /**
   * THE SENTENCE THAT SAYS WHAT TO DO, on the two states where doing something
   * is the point.
   *
   * `bomStatusHint()` has always answered for all five, and both screens spent
   * it on a `title=` tooltip — invisible on touch, invisible while scanning. It
   * is not printed on Pending or Draft because there it only re-words the pill:
   * three "No material plan yet." lines beside three Pending pills teach the
   * operator to stop reading the line, and then the one card that says something
   * else is not read either.
   */
  const cardHint = (t: BomTaskRow): ReactNode =>
    t.status === "recalculate" || t.status === "unresolved" ? (
      <span className="text-danger">{bomStatusHint(t.status, t.production_qty)}</span>
    ) : null;

  return (
    <>
      {/* THE STATUS FACET IS THE ONE EVERY OTHER LIST SCREEN HAS — a <Label>
          and a <Select> in one cell of the Filters panel (`master-list-shell.tsx`
          is the reference) — WITH THE COUNTS IN ITS OPTIONS.

          Two shapes were tried and both were wrong, and the reason is the same
          in each: they were new controls rather than the app's control. First a
          rail of chips in a band above the list, then the same chips in the
          panel, then a dropdown of my own on the toolbar row. The client's
          answer was "i meant inside that filter add this ... check the previous
          filter from our other child" (2026-08-21). The ask was never a new
          control; it was the COUNTS, in the facet that was already there.

          What the counts buy is the whole point: a state list that says nothing
          about whether any rows are in it cannot answer "is anything stale?" —
          the question a work queue exists to answer — except by choosing
          Recalculate and looking at an empty list.

          A state with no rows is SHOWN AND NOT CHOOSABLE, never hidden: zero
          Recalculate is information, and a list that drops its empty states
          reshuffles itself every time work moves, so the option an operator
          reaches for is never in the same place twice. The one exception is the
          option currently SELECTED — disabling that would leave the control
          showing a value it refuses to offer.

          Order is `BOM_STATUS_RANK`, "what needs doing, first" — the same order
          the list itself is sorted in, and never by count. */}
      <FilterBar
        search={query}
        onSearch={setQuery}
        searchPlaceholder="Search RE No, PO or customer…"
        activeCount={statusFilter ? 1 : 0}
        onReset={statusFilter ? () => setStatusFilter("") : undefined}
        right={
          queueSummary ? (
            <>
              {queueSummary} · {filtered.length} of {tasks.length}
            </>
          ) : (
            `${filtered.length} of ${tasks.length}`
          )
        }
      >
        <div>
          <Label htmlFor="bom-status">Status</Label>
          <Select
            id="bom-status"
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value as "" | BomStatus)}
          >
            <option value="">All ({tasks.length})</option>
            {statusCounts.map((c) => (
              <option
                key={c.status}
                value={c.status}
                disabled={c.count === 0 && c.status !== statusFilter}
              >
                {bomStatusText(c.status)} ({c.count})
              </option>
            ))}
          </Select>
        </div>
      </FilterBar>

      {/* ONE CARD PER GARMENT ORDER (operator request, 2026-08-17). This list is
          a work QUEUE — "which confirmed orders still need planning?" — and it
          was a `DataTable` of one row per order. The cards carry the same facts
          and the same click.

          `MobileCardList` rather than a card hand-rolled here. It already owns
          the tap-to-edit body, the pill slot and the footer that keeps delete a
          SIBLING of the tap target rather than a button inside a button. Its
          `md:hidden` has always been the caller's, so using it at every width
          needed one optional prop and changed no other screen.

          THE RE NO IS NO LONGER A BUTTON. It was one as a table cell, because
          that is where the click lived. The card body IS the button, so keeping
          it would nest one inside the other — the exact invalid markup that
          shaped this component. */}
      <MobileCardList<BomTaskRow>
        /* SIX ACROSS, NOW A FIXED COUNT (client 2026-08-19, then reversed
           2026-09-04: "make it static as 6 card per row"). `columns={6}` used
           to mean "auto-fit down to a 15rem floor", which stretched a short
           Fabric BOM queue's two cards past 30rem apiece — the opposite
           complaint from the one `auto-fit` was written to fix. `TRACK[6]` is
           the one place that changed; see its own note on `mobile-card-list.tsx`. */
        columns={6}
        rows={filtered}
        getKey={(t) => t.id}
        /* THE RE NO GETS ITS OWN FULL-WIDTH LINE, which is the point of the
           dense layout: it is the identity the operator scans by, ~125px of
           mono, and it used to share a row with a pill that could be 88px of
           "Recalculate". */
        title={(t) => <span className="font-mono">{t.sc_no ?? t.order_code ?? "—"}</span>}
        /* CUSTOMER AND PO ON ONE SECONDARY LINE, with the status pill to their
           right (the component places it). Mono on the PO only — a customer name
           in mono reads as a code. Truncated because this is the line that gives
           up width to the pill, and a card is not a `DataTable` cell: nothing
           here scrolls sideways to reveal the rest. */
        subtitle={(t) => (
          <Truncated>
            {t.customer_name ?? "—"}
            {t.po_no ? <span className="font-mono"> · {t.po_no}</span> : null}
          </Truncated>
        )}
        pill={(t) => (
          <StatusPill tone={bomStatusTone(t.status)}>{bomStatusText(t.status)}</StatusPill>
        )}
        stats={(t) => bomCardStats(t, stat(t))}
        hint={cardHint}
        /* THE SAME TONE AS THE PILL — this list is already SORTED by
           `BOM_STATUS_RANK` ("what needs doing, first") and nothing on screen
           showed it, colour locates the work and the word names it. Still
           passed even though `badge` below now carries the same tone more
           visibly: `MobileCardList` suppresses the stripe automatically once a
           badge is present (see its own note), so this is the fallback for
           the day a badge is dropped rather than a second thing to keep in
           sync by hand. */
        tone={(t) => bomStatusTone(t.status)}
        /* THE BADGE (client 2026-09-04, from a reference project-tracker
           card): the row's tone, painted, and an icon naming what it is
           WAITING ON rather than what kind of thing it is — see
           `bomStatusIcon`'s own note. */
        badge={(t) => ({ tone: bomStatusTone(t.status), icon: bomStatusIcon(t.status) })}
        /* THE CREATED PAIR SHARES THE FOOTER WITH THE ✕ instead of adding a
           second bordered row — AGENTS.md wants it APPENDED to the screen's own
           meta, not substituted for it, and the customer and the figures above
           are that meta, untouched. Still gated on `hasCreatedInfo`, so a
           service that stops selecting `created_at` shows nothing rather than a
           dangling date. */
        footerNote={showCreated ? (t) => createdMeta(t) : undefined}
        onEdit={onOpen}
        canDelete={canDelete}
        /* Only an order that HAS a BOM has anything to delete — that is the
           "Pending" case, and it is the whole reason the queue lists ORDERS.
           Without it the button renders on every card and does nothing when
           pressed. */
        canDeleteRow={(t) => !!t.bom_id}
        onDelete={onDelete}
        isPending={isPending}
        empty={`No confirmed garment orders yet. A ${noun} BOM is planned against an order.`}
      />
    </>
  );
}
