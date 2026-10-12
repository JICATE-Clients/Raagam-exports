"use client";

/**
 * Sample ▸ Fabric Plan ▸ Fabric Consumption ▸ [Dia & weight] — the dias of ONE
 * sample's fabric row (user 2026-10-12, plan "SMP-wise Fabric Consumption" v3:
 * "dia and weight will come with a separate popup").
 *
 * One row per Finish Dia, each naming the PART of the garment it is for — the
 * Order module's Manual shape (Front + Back 60 dia · Sleeve 52 · Rib Neck 28),
 * where a second dia always says why it is there. The rows' weights sum to the
 * fabric row's Req Wt, which is read-only on the sample's list.
 *
 * NO SAVE OF ITS OWN, like the Shades popup beside it: the rows live in the
 * screen's state and the plan's own Save writes them, so the footer is
 * `SubSheetFooter` (Done).
 *
 * "md", NOT "sm": a `ChildGrid`, whose table only switches in from a ~512px
 * container (AGENTS.md "A sub-detail Sheet's size").
 *
 * Finish Dia is PICKED from the Dia / Size Width Details panel, only the dias
 * of the fabric's own knit family (`familyDias`), and filled in when the
 * family lists exactly one — `diaKnitProblem` refuses any other at Save.
 */

import { Sheet, type SheetOrigin } from "@/components/ui/sheet";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { FIELD_WIDTH_CSS } from "@/components/ui/field";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { SubSheetFooter } from "@/components/orders/sub-sheet-footer";
import { diaKey } from "@/lib/orders/fabric-bom/dia-knit";

/** One dia as the popup edits it — weight held as the TEXT typed. */
export type SmpDiaRow = { key: string; part: string; finish_dia: string; req_kgs: string };

export function SmpDiaSheet({
  open,
  onClose,
  origin,
  title,
  rows,
  dias,
  diaRequired,
  onPatch,
  onAdd,
  onRemove,
}: {
  open: boolean;
  onClose: () => void;
  /** The [Dia & weight] button's rect, so the box grows out of it. */
  origin?: SheetOrigin | null;
  /** "SMP/26-27/0001 · 2X2 LYCRA RIB · NAVY" — whose dias these are. */
  title: string;
  rows: SmpDiaRow[];
  /** The dias declared for this fabric's knit family. */
  dias: readonly string[];
  /** A dyed or printed fabric owes its Finish Dia (`lines.ts`). */
  diaRequired: boolean;
  onPatch: (key: string, patch: Partial<Omit<SmpDiaRow, "key">>) => void;
  onAdd: () => void;
  onRemove: (key: string) => void;
}) {
  const kg = (n: number) => n.toLocaleString("en-IN", { minimumFractionDigits: 3, maximumFractionDigits: 3 });
  const num = (v: string) => {
    const t = v.trim().replace(/,/g, "");
    return t === "" ? null : Number(t);
  };

  /**
   * WIDTHS (check:grid-budget): term 176 (Part) + hug 88 (Finish Dia) + range
   * 112 (Weight) = 376, and 448 with the grid's chrome <= 1155.
   */
  const columns: ChildGridColumn<SmpDiaRow>[] = [
    {
      header: "Part",
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => (
        <Input
          className="h-8"
          aria-label="Part"
          placeholder="e.g. FRONT + BACK"
          value={r.part}
          onChange={(e) => onPatch(r.key, { part: e.target.value })}
        />
      ),
    },
    {
      header: "Finish Dia",
      width: FIELD_WIDTH_CSS.hug,
      required: diaRequired,
      cell: (r) => {
        // A dia the panel no longer lists stays on the row as itself, tagged —
        // never shown blank while the row still stores it ("Disabled rows").
        const held = r.finish_dia.trim() && !dias.some((d) => diaKey(d) === diaKey(r.finish_dia)) ? r.finish_dia : "";
        return (
          <Select
            compact
            aria-label="Finish Dia"
            required={diaRequired}
            value={held || dias.find((d) => diaKey(d) === diaKey(r.finish_dia)) || ""}
            onChange={(e) => onPatch(r.key, { finish_dia: e.target.value })}
            className={held ? "text-danger" : undefined}
          >
            <option value="" />
            {dias.map((d) => (
              <option key={d} value={d}>
                {d}
              </option>
            ))}
            {held && <option value={held}>{held} (not declared)</option>}
          </Select>
        );
      },
    },
    {
      header: "Weight (KGS)",
      align: "right",
      required: true,
      width: FIELD_WIDTH_CSS.range,
      total: { kind: "sum", of: (r) => num(r.req_kgs) || 0, format: kg },
      cell: (r) => (
        <Input
          className="h-8 text-right"
          inputMode="decimal"
          required
          aria-label={`Weight (KGS)${r.part.trim() ? ` — ${r.part.trim()}` : ""}`}
          value={r.req_kgs}
          onChange={(e) => onPatch(r.key, { req_kgs: e.target.value })}
        />
      ),
    },
  ];

  return (
    <Sheet
      open={open}
      onClose={onClose}
      size="md"
      alignToPane
      origin={origin ?? undefined}
      title={`Dia & weight — ${title}`}
      footer={<SubSheetFooter onDone={onClose} parent="the Fabric Plan" />}
    >
      {dias.length === 0 && (
        <p className="mb-3 text-sm text-muted-foreground">
          No dia is declared for this fabric&apos;s knit type yet — add one on the Dia / Size Width Details panel (Fabric Plan section).
        </p>
      )}
      <ChildGrid<SmpDiaRow>
        columns={columns}
        rows={rows}
        flatRows
        addLabel="+ Add dia"
        onAdd={onAdd}
        onRemove={(r) => onRemove(r.key)}
        totalsLabel="Req Wt"
      />
    </Sheet>
  );
}
