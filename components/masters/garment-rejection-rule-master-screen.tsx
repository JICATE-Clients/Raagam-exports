"use client";

import { fmtDate } from "@/lib/format";
import { useMemo, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ChildGrid } from "@/components/masters/child-grid";
import { Field, FieldGrid } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { DataTable, type Column } from "@/components/ui/data-table";
import { RowActions } from "@/components/ui/row-actions";
import { rowActionsColumn } from "@/components/ui/row-actions-column";
import { StatusPill } from "@/components/ui/status-pill";
import { Sheet } from "@/components/ui/sheet";
import { useToast } from "@/components/ui/toast";
import { deletedToast } from "@/lib/masters/delete-message";
import {
  createGarmentRejectionRule,
  updateGarmentRejectionRule,
  deleteGarmentRejectionRule,
} from "@/lib/masters/garment-rejection-rule-actions";
import type {
  GarmentRejectionRule,
  GarmentRejectionRuleInput,
} from "@/lib/masters/garment-rejection-rule-types";
import { createdMeta, withCreatedColumns } from "@/components/ui/created-columns";
import {
  RANGE_KINDS,
  REJECTION_ALLOWANCE_TYPES,
  rangeKindOf,
  rangeLabelOf,
  type RangeKind,
  type RejectionAllowanceType,
  type RejectionTier,
} from "@/lib/masters/rejection-rule";

type Perms = { canCreate: boolean; canEdit: boolean; canDelete: boolean };

const todayISO = () => new Date().toISOString().slice(0, 10);

type LineRow = {
  key: string;
  range_label: string;
  from_value: string;
  to_value: string;
  rejection_allowance: string;
  allowance_type: RejectionAllowanceType;
};
const blankLine = (key: string): LineRow => ({
  key,
  range_label: "",
  from_value: "",
  to_value: "",
  rejection_allowance: "",
  // Percent, matching the column default (0389) — two of the three tiers in the
  // client's own rule are percentages, and it is the one that is wrong loudly
  // (a "+8 PIECES" tier is obviously off) rather than quietly.
  allowance_type: "percent",
});

const numOrNull = (v: string) => (v.trim() === "" ? null : Number(v));

/** A screen row in the engine's shape, so `rangeKindOf` and `rangeLabelOf` read
 *  the same tier the server will store. */
const asTier = (l: LineRow): RejectionTier => ({
  from_value: numOrNull(l.from_value),
  to_value: numOrNull(l.to_value),
  rejection_allowance: numOrNull(l.rejection_allowance),
  allowance_type: l.allowance_type,
});

/**
 * Captions this screen writes, so it can tell them from ones an operator typed.
 *
 * Recognising its OWN output by shape is the whole trick: it means the caption
 * can keep following the bounds while a tier is being edited, and stop dead the
 * moment somebody writes their own wording. Matching `rangeLabelOf`, digit
 * grouping included — a stricter test than comparing against the caption for the
 * CURRENT bounds, which would stop recognising the row the instant a bound
 * changed, i.e. exactly when it needs to.
 */
const RANGE_LABEL_SHAPES = [
  /^UP TO [\d,]+$/i,
  /^[\d,]+ AND ABOVE$/i,
  /^[\d,]+ TO [\d,]+$/i,
];

/**
 * Legacy "Garment rejection rule" master (System). Master-detail: header (auto
 * Entry No · Effective From · Rule · Inactive) + a Details grid of tiers
 * (Range · From · To · Rejection Allowance).
 */
// dup-check: exempt -- auto Entry No plus an Effective From date. A rule re-issued
// at a later date is a revision, and refusing it would leave no way to change an
// allowance without destroying the history the old tiers belong to.
export function GarmentRejectionRuleMasterScreen({
  rows,
  perms,
}: {
  rows: GarmentRejectionRule[];
  perms: Perms;
}) {
  const router = useRouter();
  const { success, error } = useToast();
  const [isPending, startTransition] = useTransition();
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [editEntryNo, setEditEntryNo] = useState<number | null>(null);
  const [effectiveFrom, setEffectiveFrom] = useState(todayISO());
  const [rule, setRule] = useState("");
  const [inactive, setBlocked] = useState(false);
  const [lines, setLines] = useState<LineRow[]>([]);
  const keySeq = useRef(0);
  const newKey = () => `l${keySeq.current++}`;

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      [String(r.entry_no), r.rule, r.effective_from].filter(Boolean).join(" ").toLowerCase().includes(q),
    );
  }, [rows, query]);

  function openAdd() {
    setEditId(null);
    setEditEntryNo(null);
    setEffectiveFrom(todayISO());
    setRule("");
    setBlocked(false);
    setLines([blankLine(newKey())]);
    setOpen(true);
  }
  function openEdit(r: GarmentRejectionRule) {
    setEditId(r.id);
    setEditEntryNo(r.entry_no);
    setEffectiveFrom(r.effective_from);
    setRule(r.rule ?? "");
    setBlocked(r.inactive);
    setLines(
      r.lines.map((l) => ({
        key: newKey(),
        range_label: l.range_label ?? "",
        from_value: l.from_value != null ? String(l.from_value) : "",
        to_value: l.to_value != null ? String(l.to_value) : "",
        rejection_allowance: l.rejection_allowance != null ? String(l.rejection_allowance) : "",
        allowance_type: l.allowance_type,
      })),
    );
    setOpen(true);
  }

  function addLine() {
    setLines((ls) => [...ls, blankLine(newKey())]);
  }
  function setLineAt(key: string, patch: Partial<LineRow>) {
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  }
  function removeLine(key: string) {
    setLines((ls) => ls.filter((l) => l.key !== key));
  }

  /**
   * Change a tier's RANGE KIND, which means changing its bounds — the kind is
   * derived from them and is not stored (`rangeKindOf`).
   *
   * Legacy asks for both and lets them contradict each other: its top row reads
   * "Above / 1001 / 0", where the 0 means nothing and its own engine treats it
   * as unbounded. Here choosing the kind WRITES the bounds, so the two can never
   * disagree — "Up to" clears From, "Above" clears To.
   *
   * Going TO "Between" has to invent the missing bound, and it seeds rather than
   * blanks: a blank pair reads as an unfinished row everywhere else (the engine
   * refuses to match it, the ladder check skips it, the action drops it), so
   * leaving both empty would silently delete the row on save.
   */
  function setKind(key: string, kind: RangeKind) {
    setLines((ls) =>
      settleLabels(
      ls.map((l) => {
        if (l.key !== key) return l;
        const from = numOrNull(l.from_value);
        const to = numOrNull(l.to_value);
        const next =
          kind === "upto"
            ? { from_value: "", to_value: l.to_value || String(to ?? from ?? 10) }
            : kind === "above"
              ? { from_value: l.from_value || String(from ?? (to != null ? to + 1 : 1)), to_value: "" }
              : {
                  from_value: l.from_value || String(from ?? 1),
                  to_value: l.to_value || String(to ?? (from ?? 1) + 99),
                };
        return { ...l, ...next };
      }),
      ),
    );
  }

  /**
   * Fill in the caption from the bounds — but never OVER something typed.
   *
   * `range_label` is free text nobody parses, and the client's operators do
   * write their own wordings. So it composes only into an empty cell or one
   * still holding a caption this function produced, which is what lets an
   * operator edit a bound afterwards without their own wording being eaten.
   *
   * IT HAS NO COLUMN OF ITS OWN, deliberately. Range + From + To already say
   * exactly what the caption says, in editable form; a third cell repeating them
   * is the redundancy this screen just took OUT of the legacy layout, where the
   * kind and the bounds could contradict each other. The stored value still
   * matters — reports and the legacy import read it — so it is kept accurate
   * rather than kept visible.
   */
  function settleLabels(ls: LineRow[]): LineRow[] {
    return ls.map((l) => {
      const tier = asTier(l);
      const composed = rangeLabelOf(tier);
      const wasComposed =
        l.range_label.trim() === "" ||
        RANGE_LABEL_SHAPES.some((re) => re.test(l.range_label.trim()));
      return wasComposed && composed ? { ...l, range_label: composed } : l;
    });
  }

  function setBound(key: string, patch: Partial<LineRow>) {
    setLines((ls) => settleLabels(ls.map((l) => (l.key === key ? { ...l, ...patch } : l))));
  }

  function submit() {
    startTransition(async () => {
      const payload: GarmentRejectionRuleInput = {
        effective_from: effectiveFrom,
        rule: rule.trim(),
        inactive,
        lines: lines.map((l, i) => ({
          sno: i + 1,
          range_label: l.range_label.trim() || null,
          from_value: numOrNull(l.from_value),
          to_value: numOrNull(l.to_value),
          rejection_allowance: numOrNull(l.rejection_allowance),
          allowance_type: l.allowance_type,
        })),
      };
      const res = editId
        ? await updateGarmentRejectionRule(editId, payload)
        : await createGarmentRejectionRule(payload);
      if (res.ok) {
        success(editId ? "Rejection rule updated." : "Rejection rule added.");
        setOpen(false);
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  function remove(r: GarmentRejectionRule) {
    startTransition(async () => {
      const res = await deleteGarmentRejectionRule(r.id);
      if (res.ok) {
        success(deletedToast("Rejection rule", res));
        router.refresh();
      } else {
        error(res.error);
      }
    });
  }

  const columns: Column<GarmentRejectionRule>[] = [
    { header: "Entry", cell: (r) => <span className="font-mono text-xs">{r.entry_no}</span> },
    { header: "Rule", cell: (r) => <span className="text-sm">{r.rule ?? "—"}</span> },
    {
      header: "Effective From",
      cell: (r) => <span className="text-sm text-muted-foreground">{fmtDate(r.effective_from)}</span>,
    },
    {
      header: "Tiers",
      align: "right",
      cell: (r) => <span className="tabular-nums text-sm">{r.lines.length}</span>,
    },
    {
      header: "Status",
      cell: (r) => (
        <StatusPill tone={r.inactive ? "danger" : "success"}>{r.inactive ? "Inactive" : "Active"}</StatusPill>
      ),
    },
    rowActionsColumn((r) => (
      <RowActions
        label={String(r.entry_no)}
        onEdit={() => openEdit(r)}
        onDelete={() => remove(r)}
        canEdit={perms.canEdit}
        canDelete={perms.canDelete}
        isPending={isPending}
      />
    )),
  ];

  return (
    <div className="space-y-4">
      {/* toolbar */}
      <div className="flex flex-wrap items-center gap-2">
        {/* caps-input: exempt -- a search QUERY is not a stored value. */}
        <Input uppercase={false}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search rejection rule…"
          className="max-w-xs flex-1 basis-full sm:basis-auto"
        />
        <div className="flex-1" />
        {perms.canCreate && (
          <Button size="md" onClick={openAdd}>
            + Add Rule
          </Button>
        )}
      </div>

      {/* desktop table */}
      <div className="hidden md:block">
        <DataTable columns={withCreatedColumns(columns, filtered)} rows={filtered} getKey={(r) => r.id} empty="No rejection rules yet." />
      </div>

      {/* mobile cards */}
      <div className="space-y-2.5 md:hidden">
        {filtered.length === 0 ? (
          <div className="rounded-lg border border-border bg-surface px-4 py-10 text-center text-sm text-muted-foreground">
            No rejection rules yet.
          </div>
        ) : (
          filtered.map((r) => (
            <button
              key={r.id}
              type="button"
              onClick={() => perms.canEdit && openEdit(r)}
              className="block w-full rounded-xl border border-border bg-surface p-4 text-left active:bg-surface-muted"
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-semibold text-foreground">
                    {r.rule ?? `Rule #${r.entry_no}`}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">
                    #{r.entry_no} · {r.effective_from} · {r.lines.length} tier{r.lines.length === 1 ? "" : "s"}
                  </div>
                  <div className="mt-0.5 text-xs text-muted-foreground">{createdMeta(r)}</div>
                </div>
                <StatusPill tone={r.inactive ? "danger" : "success"}>
                  {r.inactive ? "Inactive" : "Active"}
                </StatusPill>
              </div>
            </button>
          ))
        )}
      </div>

      {/* editor */}
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title={editId ? `Edit Rejection Rule #${editEntryNo}` : "New Rejection Rule"}
        footer={
          <>
            <Button variant="outline" size="md" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button
              size="md"
              disabled={isPending || !rule.trim() || !effectiveFrom}
              onClick={submit}
            >
              {isPending ? "Saving…" : "Save"}
            </Button>
          </>
        }
      >
        {/*
          ONE COLUMN, FULL WIDTH (client 2026-08-04: "single screen instead of the
          splited screen").

          This was `lg:grid-cols-2` — header fields squeezed into the left half,
          the tier grid into the right — which is the layout LAYOUT.md §2/§3 exist
          to stop. Three short fields do not fill half a 1180px sheet, so the top
          of the screen read as two narrow columns with the whole lower two-thirds
          empty, while the tiers that actually need the room were the ones boxed
          into 560px and forced to stack Range above From/To/Allowance.

          Stacked full width instead: the three header fields sit four-across at
          the one standard ~280px, and the tiers become a real table whose columns
          line up down the page. Same rule the Applicant / Bank / Courier screens
          follow — "if a screen wants genuinely-flush fields on one row, stack its
          sections full width rather than splitting the sheet".
        */}
        <div className="space-y-4">
          {/* No bordered card: three fields identifying the record do not need
              chrome around them, and the original didn't draw any either.
              `FieldGrid` is `DetailSection`'s track without the frame. */}
          <FieldGrid>
            <Field label="Entry No" size="sm" htmlFor="grr-entry">
              <Input id="grr-entry" value={editEntryNo ?? "(auto)"} disabled />
            </Field>
            {/* `.min(1)` in `garmentRejectionRuleInput`, and Rule two fields
                below has always declared it — this one was simply missed. */}
            <Field label="Effective From" size="sm" required htmlFor="grr-eff">
              <Input
                id="grr-eff"
                type="date"
                value={effectiveFrom}
                onChange={(e) => setEffectiveFrom(e.target.value)}
              />
            </Field>
            <Field label="Rule" size="sm" required htmlFor="grr-rule">
              <Input
                uppercase
                id="grr-rule"
                value={rule}
                onChange={(e) => setRule(e.target.value)}
                required
              />
            </Field>
            {editId && (
              // The `&nbsp;` label is a spacer, not decoration: `Field` renders
              // its <Label> only when one is passed, so an unlabelled cell starts
              // a label's height higher than the fields beside it. Same pattern
              // as the Alternative-UOM box on the Material screen.
              <Field label={<>&nbsp;</>} size="sm">
                <label className="flex h-9 @2xl/editor:h-8 cursor-pointer items-center gap-2">
                  <input
                    type="checkbox"
                    className="h-4 w-4 cursor-pointer accent-primary"
                    checked={inactive}
                    onChange={(e) => setBlocked(e.target.checked)}
                  />
                  <span className="text-sm text-foreground">Inactive</span>
                </label>
              </Field>
            )}
          </FieldGrid>

          {/*
            A real `ChildGrid` rather than the hand-rolled card stack this was.
            Full width it can be what it always wanted to be — one row per tier,
            columns aligned down the page — and it stops being one of the ~22
            screens that hand-roll a grid row: the `#` column, the per-row ✕, the
            Excel-style Enter/↑/↓ cell walk, Ctrl+Del and the row markers all come
            from the component now instead of being re-typed here.
          */}
          <ChildGrid
            lockExisting
            label="Details"
            rows={lines}
            onAdd={addLine}
            onRemove={(l) => removeLine(l.key)}
            addLabel="+ Add tier"
            columns={[
              {
                // THE COLUMN LEGACY HAS AND WE DID NOT. Its Range is a dropdown
                // of three kinds; ours was a free-text caption nothing reads, so
                // an operator coming off that screen typed "UPTO" into a box
                // that ignored it.
                //
                // It writes From and To rather than sitting beside them — see
                // `setKind`. The kind itself is never stored: `rangeKindOf`
                // derives it back from the bounds, so there is one home for the
                // fact and no way for a caption to contradict it.
                header: "Range",
                width: "8.5rem",
                cell: (l) => (
                  <Select
                    aria-label="Range"
                    value={rangeKindOf(asTier(l))}
                    onChange={(e) => setKind(l.key, e.target.value as RangeKind)}
                  >
                    {RANGE_KINDS.map((k) => (
                      <option key={k.value} value={k.value}>
                        {k.label}
                      </option>
                    ))}
                  </Select>
                ),
              },
              {
                header: "From",
                width: "7rem",
                align: "right",
                cell: (l) => {
                  const kind = rangeKindOf(asTier(l));
                  return (
                    <Input
                      type="number"
                      aria-label="From"
                      // Disabled, not hidden: the column has to keep its width
                      // down the page or the ladder stops reading as a ladder.
                      // The placeholder says WHY it is off — legacy stores a
                      // literal 0 here and means "no lower bound", which our
                      // engine would read as a real bound of zero.
                      disabled={kind === "upto"}
                      placeholder={kind === "upto" ? "—" : ""}
                      // Right-aligned to match the column header, and
                      // `tabular-nums` so the digits line up DOWN the
                      // column — a tier ladder is read vertically.
                      className="text-right tabular-nums"
                      value={l.from_value}
                      onChange={(e) => setBound(l.key, { from_value: e.target.value })}
                    />
                  );
                },
              },
              {
                header: "To",
                width: "7rem",
                align: "right",
                cell: (l) => {
                  const kind = rangeKindOf(asTier(l));
                  return (
                    <Input
                      type="number"
                      aria-label="To"
                      disabled={kind === "above"}
                      // "∞" rather than "—": blank here is not missing, it is
                      // the only way to say unbounded, and every ladder needs
                      // exactly one row that does.
                      placeholder={kind === "above" ? "∞" : ""}
                      className="text-right tabular-nums"
                      value={l.to_value}
                      onChange={(e) => setBound(l.key, { to_value: e.target.value })}
                    />
                  );
                },
              },
              {
                /*
                 * FOUR COLUMNS, AND THE BASIS LIVES INSIDE THIS ONE (client
                 * 2026-08-26: "maintain the same fields legacy have, only 4 —
                 * Range, From, To, Rejection Allowance").
                 *
                 * It is not dropped, because it cannot be: `allowance_type`
                 * (0389) is what says whether a tier's "3" means three PIECES or
                 * three PERCENT, and on a ten-piece size run those are 3 and
                 * ceil(0.3) = 1. The screen hard-coded it to "percent" until
                 * today, which is exactly why the client's own "up to 10 → 3
                 * Flat" could not be entered and why no rule has ever been saved.
                 *
                 * Legacy does not drop it either — it puts the selector in a
                 * narrow UNNAMED column between To and Rejection Allowance, so
                 * their screen shows four column NAMES and five controls. This
                 * keeps the four names and pairs the selector with the number it
                 * qualifies, which says the same thing without an unlabelled
                 * column: "3 Flat" and "5 %" read as one value, and a screen
                 * reader gets a name for both halves rather than a blank header.
                 */
                header: "Rejection Allowance",
                width: "12rem",
                align: "right",
                cell: (l) => (
                  <div className="flex items-center gap-1">
                    <Input
                      type="number"
                      aria-label="Rejection allowance"
                      className="text-right tabular-nums"
                      value={l.rejection_allowance}
                      onChange={(e) => setLineAt(l.key, { rejection_allowance: e.target.value })}
                    />
                    {/* Two controls in ONE cell is safe on the keyboard
                        contract: Tab and the arrows both find fields by control
                        (`ROW_FIELDS` / `ownDescendants`), not by cell, so this
                        is two stops on the row's own axis and nothing special
                        is needed. */}
                    <Select
                      aria-label="Allowance basis"
                      className="w-[5.5rem] shrink-0"
                      value={l.allowance_type}
                      onChange={(e) =>
                        setLineAt(l.key, {
                          allowance_type: e.target.value as RejectionAllowanceType,
                        })
                      }
                    >
                      {REJECTION_ALLOWANCE_TYPES.map((t) => (
                        <option key={t.value} value={t.value}>
                          {t.label}
                        </option>
                      ))}
                    </Select>
                  </div>
                ),
              },
            ]}
          />
        </div>
      </Sheet>
    </div>
  );
}
