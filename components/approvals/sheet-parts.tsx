"use client";

import type { ReactNode } from "react";
import { FileText, ImageIcon } from "lucide-react";
import { StatusPill, type StatusTone } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import { fmtDate, fmtDateTime, fmtNumber } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { EventAction, TimelineRow } from "@/lib/approvals/types";
import type { PdSample } from "@/lib/sales/pd-requests/types";

/**
 * THE APPROVAL SHEET'S PARTS, ONE SHAPE FOR EVERY DOCUMENT (user 2026-11-04, approved
 * plan "Approval Sheet Mobile Layout"): who and what first, then ONE fact grid — label
 * ABOVE value, left-aligned, two to a row when short and a full row when long — then a
 * compact one-line-per-step trail. Today's label-left / value-RIGHT rows wrapped a long
 * value (a composition, two fabrics) into a ragged right edge, and three different
 * layouts sat in one sheet. Every sheet draws these: PD, PO, Budget, Leave, Fine.
 */

/** Who and what first: a tile, the document's number, a line under it, the state as pills. */
export function SheetIdentity({
  tile,
  number,
  sub,
  pills,
}: {
  tile: string;
  number: ReactNode;
  sub?: ReactNode;
  pills?: ReactNode;
}) {
  return (
    <div className="grid grid-cols-[2.75rem_1fr] items-center gap-3">
      <span className="grid size-11 place-items-center rounded-xl bg-primary/10 text-[13px] font-bold text-primary">{tile}</span>
      <div className="min-w-0">
        <div className="font-mono text-base font-semibold">{number}</div>
        {sub ? <div className="text-[13px] text-muted-foreground">{sub}</div> : null}
        {pills ? <div className="mt-1 flex flex-wrap gap-1.5">{pills}</div> : null}
      </div>
    </div>
  );
}

/** A titled block in the sheet — the small caps heading every section shares. */
export function SheetSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="space-y-1.5">
      <h3 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</h3>
      {children}
    </section>
  );
}

export type Fact = {
  label: string;
  value: ReactNode;
  /** A long value — a composition, a list — takes the whole row. */
  full?: boolean;
  mono?: boolean;
};

/**
 * THE FACT GRID — label above value, two to a row, a long value across both. Short
 * facts are paired in the order given; a `full` one closes the row it lands on. One
 * bordered grid with hairlines between cells, so a sheet is one block, not three.
 */
export function FactGrid({ facts }: { facts: Fact[] }) {
  // Lay out the cells so a lone short fact before a full one still fills its row.
  const cells: (Fact & { span: boolean })[] = [];
  let open = 0;
  facts.forEach((f, i) => {
    if (f.full) {
      if (open === 1) cells[cells.length - 1].span = true;
      cells.push({ ...f, span: true });
      open = 0;
    } else {
      const lastShort = i === facts.length - 1 || facts[i + 1]?.full;
      cells.push({ ...f, span: open === 0 && !!lastShort });
      open = open === 0 && !lastShort ? 1 : 0;
    }
  });
  return (
    <dl className="grid grid-cols-2 overflow-hidden rounded-xl border border-border">
      {cells.map((f, i) => (
        <div
          key={`${f.label}-${i}`}
          className={cn(
            "-mt-px -ml-px min-w-0 border-l border-t border-border px-3 py-2",
            f.span && "col-span-2",
          )}
        >
          <dt className="text-[11px] text-muted-foreground">{f.label}</dt>
          <dd className={cn("text-sm font-medium [overflow-wrap:anywhere]", f.mono && "font-mono")}>{f.value}</dd>
        </div>
      ))}
    </dl>
  );
}

const WORD: Partial<Record<EventAction, { word: string; tone: StatusTone }>> = {
  approve: { word: "Approved", tone: "success" },
  reject: { word: "Rejected", tone: "danger" },
  return: { word: "Returned", tone: "warning" },
  cancel: { word: "Cancelled", tone: "neutral" },
  delegate: { word: "Delegated", tone: "neutral" },
  sla_breach: { word: "Overdue", tone: "danger" },
  forward: { word: "Sent on", tone: "neutral" },
};

/**
 * THE TRAIL, ONE LINE A STEP — a dot, "1 · Managing Director" and its pill on ONE line,
 * a quiet meta line under it. It replaces, in the sheet, `ApprovalTimeline`'s wider
 * rows, where "1." sat alone, the date floated right on its own line and "by the system"
 * hung beneath (screenshot 4047). Submitted leads: who raised it, and when.
 */
export function CompactTrail({
  rows,
  names,
  submittedBy,
  submittedAt,
}: {
  rows: TimelineRow[];
  names: Record<string, string>;
  submittedBy: string | null;
  submittedAt: string;
}) {
  return (
    <ol className="overflow-hidden rounded-xl border border-border">
      <li className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-2.5 px-3 py-2">
        <span className="size-3 justify-self-center rounded-full bg-success" aria-hidden />
        <span className="text-sm font-semibold">Submitted</span>
        <span />
        <span className="col-start-2 col-end-4 text-xs text-muted-foreground">
          {fmtDateTime(submittedAt)}
          {submittedBy ? ` · ${submittedBy}` : ""}
        </span>
      </li>
      {rows.map((r, i) => {
        const word = r.action ? WORD[r.action] : null;
        /* A stage "Send to …" jumped over (0821) — a later stage has acted or holds it. */
        const skipped = !r.action && !r.is_current && rows.slice(i + 1).some((x) => x.action || x.is_current);
        const done = r.action === "approve";
        const bad = r.action === "reject" || r.action === "sla_breach";
        const who = r.actor_id ? names[r.actor_id] : null;
        return (
          <li key={r.step_order} className="grid grid-cols-[1.25rem_1fr_auto] items-center gap-x-2.5 border-t border-border px-3 py-2">
            <span
              aria-hidden
              className={cn(
                "size-3 justify-self-center rounded-full border-2",
                done
                  ? "border-success bg-success"
                  : r.is_current
                    ? bad
                      ? "border-danger bg-danger"
                      : "border-warning bg-warning ring-2 ring-warning/25"
                    : "border-border bg-surface",
              )}
            />
            <span className="min-w-0 text-sm font-semibold">
              <span className="font-medium text-muted-foreground">{r.step_order} · </span>
              <Truncated>{r.step_label}</Truncated>
            </span>
            {word ? (
              <StatusPill tone={word.tone}>{word.word}</StatusPill>
            ) : r.is_current ? (
              <StatusPill tone="warning">Waiting</StatusPill>
            ) : (
              <span />
            )}
            <span className="col-start-2 col-end-4 text-xs text-muted-foreground">
              {r.action && r.action !== "sla_breach"
                ? `${fmtDateTime(r.acted_at)}${who ? ` · ${who}` : ""}${r.is_override ? " · override" : ""}`
                : r.is_current
                  ? /* Only step 1 started at submit; a later step's start is not on the row. */
                    r.step_order === 1
                    ? `Waiting since ${fmtDateTime(submittedAt)}`
                    : "Waiting now"
                  : skipped
                    ? "Skipped — sent past this stage"
                    : "Still to come"}
            </span>
            {r.comment && r.action !== "sla_breach" ? (
              <span className="col-start-2 col-end-4 mt-1 rounded-md bg-surface-muted px-2 py-1 text-xs">&ldquo;{r.comment}&rdquo;</span>
            ) : null}
          </li>
        );
      })}
    </ol>
  );
}

export type LineCard = {
  item: string;
  amount: string;
  /** qty · rate · budget — the small grey line under the item. */
  meta: string[];
  /** Above its budget rate: the meta line reads red. */
  over?: boolean;
};

/**
 * DOCUMENT LINES AS SMALL CARDS (approved plan "My Approvals Phone Full Page"): the item
 * and its amount on one line, qty · rate · budget under it — never a table squeezed to a
 * phone's width, which is where the earlier misalignment came from.
 */
export function LineCards({ lines }: { lines: LineCard[] }) {
  return (
    <div className="grid gap-1.5">
      {lines.map((l, i) => (
        <div key={i} className="grid gap-0.5 rounded-xl border border-border px-3 py-2 text-[13px]">
          <div className="flex min-w-0 items-baseline justify-between gap-2">
            <span className="min-w-0 font-semibold [overflow-wrap:anywhere]">{l.item}</span>
            <span className="shrink-0 font-mono tabular-nums">{l.amount}</span>
          </div>
          <div className={cn("flex flex-wrap gap-x-3 text-xs", l.over ? "text-danger" : "text-muted-foreground")}>
            {l.meta.map((m, j) => (
              <span key={j}>{m}</span>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * A PD REQUEST, PHONE-SHAPED — the same facts `PdRequestDetails` prints (its style
 * lines are a wide table, cramped in a sheet), as the fact grid: one grid per style
 * line, the two fabrics as two lines, then the tech pack on one line.
 */
export function PdSheetBody({ sample }: { sample: PdSample }) {
  return (
    <div className="space-y-3.5">
      <FactGrid
        facts={[
          { label: "Customer", value: sample.customer ?? "—" },
          { label: "Season", value: sample.season ?? "—" },
          { label: "Total qty", value: `${fmtNumber(sample.total_pieces)} pcs` },
        ]}
      />
      {sample.styles.map((l) => (
        <SheetSection key={l.id} title={sample.styles.length > 1 ? `Sample · ${l.smp_no ?? l.name}` : "Sample"}>
          <FactGrid
            facts={[
              { label: "Style", value: l.name || "—", full: true },
              { label: "Sample type", value: l.sample_type || "Not set" },
              { label: "Required qty", value: `${fmtNumber(l.sample_qty)} ${l.unit === "Set" ? "sets" : "pcs"}` },
              { label: "Target delivery", value: l.delivery_date ? fmtDate(l.delivery_date) : "—" },
              { label: "Article No", value: l.article_no || "—" },
              {
                label: "Fabric · GSM",
                full: true,
                value: l.fabrics.length ? (
                  <span className="grid gap-0.5">
                    {l.fabrics.map((f, i) => (
                      <span key={i}>
                        {f.structure}
                        {f.gsm != null ? <span className="font-normal text-muted-foreground">{` · ${fmtNumber(f.gsm)} GSM`}</span> : null}
                      </span>
                    ))}
                  </span>
                ) : (
                  "—"
                ),
              },
              { label: "Composition", value: l.composition ?? "Not costed yet", full: true },
              {
                label: "Combo breakdown",
                full: true,
                value: l.combos.length ? (
                  <span className="grid gap-0.5">
                    {l.combos.map((c, i) => (
                      <span key={i}>
                        {c.combo || "—"}
                        <span className="font-normal text-muted-foreground">{` — ${c.sizes.map((z) => `${z.size}: ${fmtNumber(z.qty)}`).join(", ")}`}</span>
                      </span>
                    ))}
                  </span>
                ) : (
                  "—"
                ),
              },
            ]}
          />
        </SheetSection>
      ))}
      {/* The tech pack on ONE line: what it is, and its status as a pill. */}
      <div className="flex items-center gap-2 rounded-xl border border-border px-3 py-2 text-[13px]">
        <FileText className="size-4 shrink-0 text-muted-foreground" aria-hidden />
        <span className="min-w-0 flex-1">
          <span className="font-semibold">Tech pack</span>
          <span className="text-muted-foreground">
            {sample.files.length ? ` · ${sample.files.length} file${sample.files.length === 1 ? "" : "s"}` : " · none attached on Sample Entry"}
          </span>
        </span>
        {sample.tech_pack ? <StatusPill tone="neutral">{sample.tech_pack}</StatusPill> : null}
      </div>
      {sample.files.length ? (
        <ul className="grid gap-1.5">
          {sample.files.map((f, i) => {
            const Icon = f.kind === "Tech Pack" ? FileText : ImageIcon;
            const body = (
              <>
                <Icon className="size-4 shrink-0 text-muted-foreground" aria-hidden />
                <Truncated text={f.file_name} className="block min-w-0 flex-1 text-sm" />
                <span className="shrink-0 text-[11px] text-muted-foreground">{f.kind}</span>
              </>
            );
            return (
              <li key={i}>
                {f.url ? (
                  <a href={f.url} target="_blank" rel="noreferrer" className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">
                    {body}
                  </a>
                ) : (
                  <span className="flex items-center gap-2 rounded-lg border border-border px-3 py-1.5">{body}</span>
                )}
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
