"use client";

import { useState, type CSSProperties, type ReactNode } from "react";
import { CardAction as CardActionTile, DUO, type CardTone } from "@/components/ui/card-action";
import { Truncated } from "@/components/ui/truncated";
import { buyerInitials, buyerTint, GLOW_AVATAR, GLOW_CARD, GLOW_RULE } from "@/lib/ui/buyer-glow";
import { cn } from "@/lib/utils";
import { fmtDate } from "@/lib/format";
import { STATUS_LABEL, isDeletableStatus, type CostingListRow } from "@/lib/sales/sample-costing/types";

/**
 * A SAMPLE COSTING CARD (user 2026-10-21, "Card Glow Styles" option 1 with the
 * duotone action row — screenshot 2026-10-21 095215: "apply this").
 *
 * White card, and the only colour is the BUYER'S (`buyerTint`): a soft shadow
 * of it under the card that deepens and lifts on hover, a hint of it in the
 * border, the avatar's wash and the "Start costing →" link. Top line: the
 * number in a chip, then what the card is waiting on. Then the buyer, the
 * style, the figures once there is a sheet, and the five actions in ONE fixed
 * row — Approve · Reject · Report · Revise · Delete — so every card's icons
 * line up down the grid. An action that does not apply to this card stays,
 * greyed, with its reason in the tooltip (AGENTS "Row actions"); only a
 * missing PERMISSION removes one (`del` null).
 *
 * EACH WORD ONCE (user 2026-10-23, artifact "Costing Card — Duplicates
 * Removed": "apply this artifact"). What every card on the page said alike is
 * said once, in `CostingCardLegend` above the grid: the CST/ and SMP/ series
 * prefixes, the QUOTED · MARGIN · DATE labels, the currency and the year. The
 * state mark at the top right went too — the tab the card sits under already
 * names it. The card keeps what differs: number, buyer, style, the figures.
 */

/** One footer action: what a click does, or why it cannot. */
export type CardAction = { onClick: () => void; reason?: string | null };

export function CostingCard({
  code,
  buyer,
  sub,
  start,
  figures,
  onOpen,
  approve,
  reject,
  report,
  revise,
  del,
  isPending = false,
}: {
  code: string;
  buyer: string | null;
  sub: string;
  /** A sample with no sheet yet: the top line offers "Start costing →". */
  start?: boolean;
  /** Quoted · Margin · Date, in that order — omitted while there is nothing to
   *  show. The labels are read by screen readers only; the legend shows them once. */
  figures?: { label: string; value: string }[];
  onOpen?: () => void;
  approve: CardAction;
  reject: CardAction;
  report: CardAction;
  revise: CardAction;
  /** null = no delete permission, so no bin. */
  del: (CardAction & { onClick: () => void }) | null;
  isPending?: boolean;
}) {
  const [confirming, setConfirming] = useState(false);
  const tint = buyerTint(buyer);
  return (
    <div style={{ "--ink": tint.ink, "--glow": tint.glow } as CSSProperties} className={GLOW_CARD}>
      <button
        type="button"
        onClick={onOpen}
        disabled={!onOpen}
        className="flex w-full flex-1 flex-col gap-2 rounded-t-2xl px-3 pb-2 pt-2.5 text-left focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:cursor-default"
      >
        <div className="flex w-full items-center gap-2">
          <span className="shrink-0 rounded-md border border-border bg-surface px-1.5 py-px font-mono text-xs font-medium text-foreground">
            {code}
          </span>
          {start && (
            <span className="ml-auto flex items-center gap-1.5 whitespace-nowrap text-[12.5px] font-semibold text-[var(--ink)] transition-[gap] group-hover:gap-2.5 dark:text-[color-mix(in_srgb,var(--ink)_55%,white)]">
              Start costing <span aria-hidden="true">→</span>
            </span>
          )}
        </div>
        <div className="flex w-full min-w-0 items-center gap-2.5">
          <span
            aria-hidden="true"
            className={GLOW_AVATAR}
          >
            {buyerInitials(buyer)}
          </span>
          <span className="grid min-w-0 flex-1">
            <Truncated className="text-sm font-semibold leading-tight text-foreground" touch={false}>
              {buyer ?? "—"}
            </Truncated>
            <Truncated className="font-mono text-xs leading-snug text-muted-foreground" touch={false}>
              {sub}
            </Truncated>
          </span>
        </div>
        {figures && figures.length > 0 && (
          <dl className="flex w-full items-baseline justify-between gap-2 tabular-nums">
            {figures.map((f, i) => (
              <div key={f.label} className="min-w-0">
                <dt className="sr-only">{f.label}</dt>
                {/* truncate-reveal: exempt -- a figure (money, %, a date) fits a 15rem card; a tap opens the costing */}
                <dd className={cn("truncate font-bold leading-tight text-foreground", i === 0 ? "text-lg" : "text-[15px]")}>{f.value}</dd>
              </div>
            ))}
          </dl>
        )}
      </button>
      <div className={cn("mx-3 flex min-h-10 items-center justify-between gap-1 py-1", GLOW_RULE)}>
        {confirming && del ? (
          <>
            <span className="text-xs text-muted-foreground">Delete this costing?</span>
            <span className="flex gap-1">
              <button type="button" className="h-7 rounded-control px-2 text-xs font-semibold text-muted-foreground hover:bg-surface-muted" onClick={() => setConfirming(false)}>
                Cancel
              </button>
              <button
                type="button"
                disabled={isPending}
                className="h-7 rounded-control bg-danger px-2 text-xs font-semibold text-white disabled:opacity-60"
                onClick={() => {
                  setConfirming(false);
                  del.onClick();
                }}
              >
                {isPending ? "…" : "Delete"}
              </button>
            </span>
          </>
        ) : (
          <>
            {/* REPORT FIRST, THEN APPROVE, THEN REJECT (user 2026-10-22, screenshot 3661):
                the quote is read before the buyer's answer is recorded against it.
                Every icon carries its own colour (user 2026-10-21, screenshot 152304):
                Reports was ink-black and Delete grey, the two the eye skipped. Violet
                is the one hue not already saying approve / reject / revise. */}
            <Act label="Reports" action={report} tone="violet" icon={DUO.doc} />
            <Act label="Customer Approved" action={approve} tone="success" icon={DUO.ok} />
            <Act label="Customer Rejected" action={reject} tone="danger" icon={DUO.no} />
            <Act label="Raise Revise" action={revise} tone="info" icon={DUO.redo} />
            {del && (
              <Act
                label="Delete"
                action={{ reason: del.reason, onClick: () => setConfirming(true) }}
                tone="danger"
                icon={DUO.bin}
              />
            )}
          </>
        )}
      </div>
    </div>
  );
}

/** The card's tile (`components/ui/card-action.tsx`, shared by every card since 2026-10-23). */
function Act({ label, action, tone, icon }: { label: string; action: CardAction; tone: CardTone; icon: ReactNode }) {
  return <CardActionTile label={label} tone={tone} icon={icon} reason={action.reason} onClick={action.onClick} />;
}

/**
 * What every card on the page shares, said ONCE above the grid — the other half
 * of "each word once". Each part is shown only when every card really shares it
 * (`sharedPrefix` / `sharedValue`); where they differ the card keeps saying it.
 */
export function CostingCardLegend({ costing, sample, currency, year }: { costing: string; sample: string; currency: string | null; year: string | null }) {
  return (
    <p className="text-[13px] text-muted-foreground">
      Costing {costing && <span className="font-mono text-foreground">{costing}…</span>} · Sample{" "}
      {sample && <span className="font-mono text-foreground">{sample}…</span>} · Style ·{" "}
      <strong className="font-semibold text-foreground">
        Quoted{currency ? ` (${currency})` : ""} · Margin · Date{year ? ` (${year})` : ""}
      </strong>
    </p>
  );
}

/** The series prefix ("CST/26-27/") every value shares, up to its last "/" — or "". */
export function sharedPrefix(values: (string | null | undefined)[]): string {
  const vs = values.filter((v): v is string => !!v);
  if (vs.length === 0) return "";
  const cut = (v: string) => v.slice(0, v.lastIndexOf("/") + 1);
  const p = cut(vs[0]);
  return p && vs.every((v) => cut(v) === p) ? p : "";
}

/** The one value every entry shares, or null when they differ (or there are none). */
export function sharedValue(values: (string | null | undefined)[]): string | null {
  const vs = values.filter((v): v is string => !!v);
  return vs.length > 0 && vs.every((v) => v === vs[0]) ? vs[0] : null;
}

/** Everything a pile of cards shares, worked out once for the legend and the strip. */
export type CostingCardShared = { costing: string; sample: string; currency: string | null; year: string | null };

export function costingCardShared(rows: CostingListRow[]): CostingCardShared {
  const costed = rows.filter((r) => !r.awaiting);
  return {
    costing: sharedPrefix(costed.map((r) => r.code)),
    sample: sharedPrefix(rows.map((r) => r.enquiry_no)),
    currency: sharedValue(costed.filter((r) => r.target_fob != null).map((r) => r.currency_code)),
    year: sharedValue(costed.map((r) => r.costing_date?.slice(0, 4))),
  };
}

const strip = (v: string | null | undefined, prefix: string) => (v && prefix && v.startsWith(prefix) ? v.slice(prefix.length) : v);
const money = (v: number) => v.toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/**
 * ONE COSTING CARD FOR EVERY COSTING PAGE (user 2026-10-23, screenshot 101313:
 * "intha page mariye ella costing page kku duplicate words aa remove
 * pannaitu"). Costing, Costing 3–6 and the Ledger each built the card from
 * the same row; this is that build, so the pages cannot drift apart again.
 * The page passes its own handlers — Raise Revise opens a route on one page
 * and a revision in place on another — and nothing else.
 */
export function CostingQueueCard({
  r,
  live,
  shared,
  canCreate,
  canEdit,
  canDelete,
  isPending = false,
  onStart,
  onOpen,
  onDecide,
  onReports,
  onRevise,
  onDelete,
}: {
  r: CostingListRow;
  /** Under Progress — the only pile that takes the buyer's answer or a revision. */
  live: boolean;
  shared: CostingCardShared;
  canCreate: boolean;
  canEdit: boolean;
  canDelete: boolean;
  isPending?: boolean;
  onStart: () => void;
  onOpen: () => void;
  onDecide: (decision: "approved" | "rejected") => void;
  onReports: () => void;
  onRevise: () => void;
  onDelete: () => void;
}) {
  const sampleNo = strip(r.enquiry_no, shared.sample);
  const decideWhy = r.awaiting
    ? "Not costed yet"
    : !live
      ? "Only an Under Progress costing takes the buyer's answer"
      : canEdit
        ? null
        : "Needs the edit permission";
  return (
    <CostingCard
      code={(r.awaiting ? sampleNo : strip(r.code, shared.costing)) ?? "—"}
      buyer={r.customer_name}
      sub={[r.awaiting ? null : sampleNo, r.style_name].filter(Boolean).join(" · ") || "—"}
      start={!!r.awaiting && canCreate}
      figures={
        r.awaiting
          ? undefined
          : [
              {
                label: "Quoted",
                value: r.target_fob != null ? `${shared.currency ? "" : (r.currency_code ?? "")} ${money(r.target_fob)}`.trim() : "—",
              },
              { label: "Margin", value: r.profit_loss_pct != null ? `${r.profit_loss_pct.toFixed(1)}%` : "—" },
              // DD/MM from fmtDate, its year in the legend when every card shares it.
              { label: "Date", value: shared.year && r.costing_date ? fmtDate(r.costing_date).slice(0, 5) : fmtDate(r.costing_date) },
            ]
      }
      onOpen={r.awaiting ? (canCreate ? onStart : undefined) : onOpen}
      approve={{ reason: decideWhy, onClick: () => onDecide("approved") }}
      reject={{ reason: decideWhy, onClick: () => onDecide("rejected") }}
      report={{ reason: r.awaiting ? "Nothing to report on yet" : null, onClick: onReports }}
      revise={{
        reason: r.awaiting ? "Not costed yet" : !live ? "Only an Under Progress costing can be revised" : canEdit ? null : "Needs the edit permission",
        onClick: onRevise,
      }}
      del={
        canDelete
          ? {
              reason: r.awaiting
                ? "Not costed — nothing to delete"
                : isDeletableStatus(r.status)
                  ? null
                  : `${STATUS_LABEL[r.status]} — only a Draft can be deleted; revise it instead.`,
              onClick: onDelete,
            }
          : null
      }
      isPending={isPending}
    />
  );
}
