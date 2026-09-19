"use client";

/**
 * Orders ▸ Advised Items ▸ one order — its Material BOM lines that are, or
 * were, "To be advised", and the door that converts each one.
 *
 * READ-ONLY EXCEPT FOR THE CONVERSION. A line's quantity, material and rate
 * belong to the Material BOM (and, on an approved RE, are locked with it); what
 * the buyer's confirmation adds — brand, artwork, colour, size, specification —
 * is what `ConvertAdvisedSheet` writes, and nothing else (plan, "Conversion
 * through the lock").
 *
 * A FIXED-WIDTH TABLE FROM ITS FIRST COMMIT (raagam-screen-layout, "Build it
 * compact the first time"): every column one of the seven `FIELD_WIDTH_CSS`
 * steps, in a named array `check:grid-budget` measures, `tableFrom="5xl"`.
 */

import { useState } from "react";
import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { FIELD_WIDTH_CSS, Field, FieldGrid } from "@/components/ui/field";
import { PageHeader } from "@/components/ui/page-header";
import { StatusPill } from "@/components/ui/status-pill";
import { Truncated } from "@/components/ui/truncated";
import type { PickerItem } from "@/components/masters/record-picker";
import { fmtDateTime, fmtNumber } from "@/lib/format";
import type { AdvisedLine } from "@/lib/orders/advised/types";
import { ConvertAdvisedSheet } from "./convert-advised-sheet";

type Row = AdvisedLine & { key: string };

/** Two facts in one cell, the second muted beneath — so a pair that belongs
 *  together (Colour / Size, Brand / Artwork) costs one column, not two. */
function twoTier(top: string | null | undefined, bottom: string | null | undefined) {
  return (
    <div className="min-w-0 leading-tight">
      <Truncated className="text-sm">{top ?? ""}</Truncated>
      <Truncated className="text-xs text-muted-foreground">{bottom ?? ""}</Truncated>
    </div>
  );
}

export function AdvisedLinesScreen({
  order,
  lines,
  coloursByItem,
  canConvert,
}: {
  order: { id: string; re_no: string | null; customer_name: string | null };
  lines: AdvisedLine[];
  /** Each material's colours, for the Convert sheet's Colour picker. */
  coloursByItem: Record<string, PickerItem[]>;
  canConvert: boolean;
}) {
  const [converting, setConverting] = useState<AdvisedLine | null>(null);
  const [origin, setOrigin] = useState<DOMRect | null>(null);

  const rows: Row[] = lines.map((l) => ({ ...l, key: l.id }));

  /*
   * 176 + 144 + 112 + 112 + 144 + 88 + 88 + 144 + 88 = 1096, + 40 chrome (the
   * `#`; no ✕ — `hideRemove`) = 1136 <= 1155 -> tableFrom="5xl".
   *
   * Ten facts in nine columns: Colour / Size and Brand / Artwork Code each share
   * one two-tier cell, the CMT grid's pattern — as separate columns the row was
   * 1,472px and could only have been cards.
   */
  const advisedLineColumns: ChildGridColumn<Row>[] = [
    {
      header: "Item",
      width: FIELD_WIDTH_CSS.term,
      cell: (r) => <Truncated className="text-sm">{r.item_name ?? ""}</Truncated>,
    },
    {
      header: "Colour / Size",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => twoTier(r.item_color_name, r.size),
    },
    {
      header: "Spec",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => <Truncated className="text-sm">{r.specification ?? ""}</Truncated>,
    },
    {
      header: "Brand / Artwork",
      width: FIELD_WIDTH_CSS.range,
      cell: (r) => twoTier(r.brand, r.artwork_code),
    },
    {
      header: "Pending Reason",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) => <Truncated className="text-sm">{r.pending_reason ?? ""}</Truncated>,
    },
    {
      header: "Est. Rate",
      width: FIELD_WIDTH_CSS.hug,
      align: "right",
      cell: (r) => (
        <span className="tabular-nums text-sm">
          {r.estimated_rate == null ? "" : fmtNumber(r.estimated_rate)}
        </span>
      ),
    },
    {
      header: "PO",
      width: FIELD_WIDTH_CSS.hug,
      // DERIVED, never stored: a line blocks its PO for exactly as long as it
      // is "To be advised" (plan, "no stored is_po_locked").
      cell: (r) =>
        r.po_blocked ? (
          <StatusPill tone="danger">Blocked</StatusPill>
        ) : (
          <StatusPill tone="success">Open</StatusPill>
        ),
    },
    {
      header: "Converted",
      width: FIELD_WIDTH_CSS.code,
      cell: (r) =>
        r.converted_at
          ? twoTier(r.converted_by_name, fmtDateTime(r.converted_at))
          : null,
    },
    {
      header: "Convert",
      width: FIELD_WIDTH_CSS.hug,
      cell: (r) =>
        r.po_blocked && canConvert ? (
          <Button
            type="button"
            variant="outline"
            size="sm"
            className="h-8 w-full"
            // ON THE ROW'S KEYBOARD AXIS — the Fabric BOM Components [Click]
            // precedent: a button that opens something the keyboard cannot
            // otherwise reach. A marker, never a handler.
            data-row-open
            aria-label={`Convert ${r.item_name ?? "this material"} to Available`}
            onClick={(e) => {
              // `currentTarget`, never `target` — the click can land on the text.
              setOrigin(e.currentTarget.getBoundingClientRect());
              setConverting(r);
            }}
          >
            Convert
          </Button>
        ) : null,
    },
  ];

  return (
    <div className="space-y-4">
      <PageHeader
        title={`Advised Items · ${order.re_no ?? "Order"}`}
        description={order.customer_name ?? undefined}
        actions={
          <Link href="/orders/advised-items">
            <Button variant="outline" size="md">
              ← Advised Items
            </Button>
          </Link>
        }
      />

      {/* default-row: exempt -- the rows are the order's advised Material BOM lines, a view; nothing is added here */}
      <ChildGrid<Row>
        columns={advisedLineColumns}
        rows={rows}
        tableFrom="5xl"
        flatRows
        hideAdd
        hideRemove
        keepOne={false}
        onAdd={() => false}
        onRemove={() => {}}
        renderMobileRow={(row, i) => (
          <FieldGrid>
            {advisedLineColumns.map((c, ci) => (
              <Field key={ci} label={c.header} required={c.required} size="sm">
                {c.cell(row, i)}
              </Field>
            ))}
          </FieldGrid>
        )}
      />

      {converting && (
        <ConvertAdvisedSheet
          line={converting}
          colours={converting.item_id ? (coloursByItem[converting.item_id] ?? []) : []}
          origin={origin}
          onClose={() => setConverting(null)}
        />
      )}
    </div>
  );
}
