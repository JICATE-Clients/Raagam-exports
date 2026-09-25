"use client";

/**
 * THE PATTERN MAKER'S SHEET (user 2026-09-25: "the pattern status form fields
 * … this for the pattern maker, he will update with this form"; 0638 + 0640).
 *
 *   header   PATTERN STATUS · DATE · BUYER · RE-NO / STYLE NAME · STYLE
 *   lines    FABRIC · GSM · TYPE of PARTS · COLOUR · SIZE · TABLE DIA ·
 *            TUBULAR & OPEN WIDTH · AVG CAD PCS WEIGHT · REMARK
 *
 * The lines open SEEDED from the order — one per style component, with its
 * part, fabric and GSM already in — so the pattern maker types only what the
 * pattern room measures. "+ Add line" repeats a part for another colour or
 * size. A line with nothing typed is not saved (the seeded values are the
 * order's, not the operator's).
 *
 * SEND REQUIRES READY (user 2026-09-25). The tab shows the Send form only once
 * this is saved as Ready, and `cad_dispatch` refuses otherwise.
 *
 * One form, two frames (`CadFormFrame`): in place on Order Entry ▸ CAD, a sheet
 * wherever the CAD Queue opens it — the same rule as the other steps.
 */

import { useState, useTransition } from "react";
import { Button } from "@/components/ui/button";
import { ChildGrid, type ChildGridColumn } from "@/components/masters/child-grid";
import { DetailSection } from "@/components/masters/detail-section";
import { FIELD_WIDTH_CSS, Field, FieldRow, fieldWidthStep } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Select } from "@/components/ui/select";
import { Truncated } from "@/components/ui/truncated";
import { useToast } from "@/components/ui/toast";
import type { SheetOrigin } from "@/components/ui/sheet";
import { today as istToday } from "@/lib/calendar";
import { savePatternSheet } from "@/lib/orders/cad-lifecycle/actions";
import {
  LAYOUT_TYPES,
  PATTERN_STATUSES,
  cutKey,
  latestVersion,
  type CadStyleRow,
  type LayoutType,
  type PatternStatus,
  type StyleComponent,
} from "@/lib/orders/cad-lifecycle/types";
import { CadFormFrame } from "./cad-form-frame";

/** A line as the form holds it — numbers as typed text until Save. */
type LineRow = {
  key: string;
  part: string; // cutKey of the style component, "" = not chosen
  coordinate_id: string | null;
  component_id: string | null;
  fabric_category_id: string | null;
  fabric_name: string | null;
  gsm: string;
  colour: string;
  size_id: string;
  table_dia: string;
  width_form: LayoutType | "";
  avg_pcs_weight_g: string;
  remark: string;
};

let seq = 0;
const newKey = () => `pl-${Date.now()}-${++seq}`;

/** The first plain number in "160" / "160 / 180" — a single GSM seeds, two do not. */
const singleGsm = (g: string | null) => (g && !g.includes("/") ? g.trim() : "");

function lineFromComponent(c: StyleComponent): LineRow {
  return {
    key: newKey(),
    part: cutKey(c),
    coordinate_id: c.coordinate_id,
    component_id: c.component_id,
    fabric_category_id: c.fabric_category_id ?? null,
    fabric_name: c.structure,
    gsm: singleGsm(c.gsm),
    colour: "",
    size_id: "",
    table_dia: "",
    width_form: "",
    avg_pcs_weight_g: "",
    remark: "",
  };
}

/** Something the pattern maker typed — the save side's blank-line test. */
const isTyped = (l: LineRow) =>
  !!(l.colour || l.size_id || l.table_dia.trim() || l.width_form || l.avg_pcs_weight_g.trim() || l.remark.trim());

export function PatternWorkForm({
  row,
  inline = false,
  origin,
  onClose,
}: {
  row: CadStyleRow;
  inline?: boolean;
  origin?: SheetOrigin | null;
  onClose: () => void;
}) {
  const toast = useToast();
  const [isPending, start] = useTransition();
  const version = latestVersion(row.versions)!;
  const today = istToday();
  const [status, setStatus] = useState<PatternStatus>(version.pattern_status);
  const [date, setDate] = useState<string>(version.pattern_date ?? today);
  // Saved lines when there are any; otherwise one per style component (AGENTS.md
  // "Editable sub-tables open with a row" — here, with the order's rows).
  const [lines, setLines] = useState<LineRow[]>(() =>
    version.pattern_lines.length > 0
      ? version.pattern_lines.map((l) => ({
          key: newKey(),
          part: cutKey({ coordinate_id: l.coordinate_id, component_id: l.component_id }),
          coordinate_id: l.coordinate_id,
          component_id: l.component_id,
          fabric_category_id: l.fabric_category_id,
          fabric_name: l.fabric_name,
          gsm: l.gsm != null ? String(l.gsm) : "",
          colour: l.colour ?? "",
          size_id: l.size_id ?? "",
          table_dia: l.table_dia != null ? String(l.table_dia) : "",
          width_form: l.width_form ?? "",
          avg_pcs_weight_g: l.avg_pcs_weight_g != null ? String(l.avg_pcs_weight_g) : "",
          remark: l.remark ?? "",
        }))
      : row.components.map(lineFromComponent),
  );
  const [serverError, setServerError] = useState<string | null>(null);

  const setLine = (key: string, patch: Partial<LineRow>) =>
    setLines((xs) => xs.map((x) => (x.key === key ? { ...x, ...patch } : x)));

  function pickPart(l: LineRow, part: string) {
    const c = row.components.find((x) => cutKey(x) === part);
    if (!c) {
      setLine(l.key, { part: "", coordinate_id: null, component_id: null, fabric_category_id: null, fabric_name: null });
      return;
    }
    setLine(l.key, {
      part,
      coordinate_id: c.coordinate_id,
      component_id: c.component_id,
      fabric_category_id: c.fabric_category_id ?? null,
      fabric_name: c.structure,
      gsm: l.gsm || singleGsm(c.gsm),
    });
  }

  const partLabel = (c: StyleComponent) => (c.coordinate_name ? `${c.coordinate_name} ▸ ${c.name}` : c.name);

  function save() {
    setServerError(null);
    const typed = lines.filter(isTyped);
    const unnamed = typed.findIndex((l) => !l.component_id);
    if (unnamed >= 0) {
      setServerError(`Line ${lines.indexOf(typed[unnamed]) + 1}: choose the Type of Part.`);
      return;
    }
    const num = (s: string) => (s.trim() === "" ? null : Number(s));
    start(async () => {
      const r = await savePatternSheet(version.id, {
        pattern_status: status,
        pattern_date: date || null,
        lines: typed.map((l) => ({
          coordinate_id: l.coordinate_id,
          component_id: l.component_id!,
          fabric_category_id: l.fabric_category_id,
          gsm: num(l.gsm),
          colour: l.colour || null,
          size_id: l.size_id || null,
          table_dia: num(l.table_dia),
          width_form: l.width_form || null,
          avg_pcs_weight_g: num(l.avg_pcs_weight_g),
          remark: l.remark || null,
        })),
      });
      if (!r.ok) {
        setServerError(r.error);
        return;
      }
      toast.success(status === "ready" ? "Pattern marked Ready — it can be sent now" : "Pattern sheet saved");
      onClose();
    });
  }

  // code 144 + hug 88 + code 144 × 2 + hug 88 × 2 + range 112 × 2 + code 144
  // = 1,064 + 72 chrome = 1,136 ≤ 1,155 (check:grid-budget). The register's
  // own column order.
  const patternLineColumns: ChildGridColumn<LineRow>[] = [
    {
      header: "Fabric",
      width: FIELD_WIDTH_CSS.code,
      cell: (l) => <Truncated className="text-sm">{l.fabric_name ?? "—"}</Truncated>,
    },
    {
      header: "GSM",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => (
        <Input
          aria-label="GSM"
          type="number"
          inputMode="decimal"
          min={0}
          value={l.gsm}
          onChange={(e) => setLine(l.key, { gsm: e.target.value })}
        />
      ),
    },
    {
      header: "Type of Parts",
      width: FIELD_WIDTH_CSS.code,
      cell: (l) => (
        <Select aria-label="Type of Parts" value={l.part} onChange={(e) => pickPart(l, e.target.value)}>
          <option value="" />
          {row.components.map((c) => (
            <option key={cutKey(c)} value={cutKey(c)}>
              {partLabel(c)}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Colour",
      width: FIELD_WIDTH_CSS.code,
      cell: (l) => (
        <Select aria-label="Colour" value={l.colour} onChange={(e) => setLine(l.key, { colour: e.target.value })}>
          <option value="" />
          {row.colours.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
          {/* A colour saved earlier that the combos no longer carry stays visible. */}
          {l.colour && !row.colours.includes(l.colour) && <option value={l.colour}>{l.colour}</option>}
        </Select>
      ),
    },
    {
      header: "Size",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => (
        <Select aria-label="Size" value={l.size_id} onChange={(e) => setLine(l.key, { size_id: e.target.value })}>
          <option value="" />
          {row.size_options.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Table Dia",
      width: FIELD_WIDTH_CSS.hug,
      cell: (l) => (
        <Input
          aria-label="Table Dia"
          type="number"
          inputMode="decimal"
          min={0}
          value={l.table_dia}
          onChange={(e) => setLine(l.key, { table_dia: e.target.value })}
        />
      ),
    },
    {
      header: "Tubular / Open Width",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Select
          aria-label="Tubular / Open Width"
          value={l.width_form}
          onChange={(e) => setLine(l.key, { width_form: e.target.value as LayoutType | "" })}
        >
          <option value="" />
          {LAYOUT_TYPES.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </Select>
      ),
    },
    {
      header: "Avg CAD Pcs Wt (g)",
      width: FIELD_WIDTH_CSS.range,
      cell: (l) => (
        <Input
          aria-label="Avg CAD Pcs Weight (g)"
          type="number"
          inputMode="decimal"
          min={0}
          value={l.avg_pcs_weight_g}
          onChange={(e) => setLine(l.key, { avg_pcs_weight_g: e.target.value })}
        />
      ),
    },
    {
      header: "Remark",
      width: FIELD_WIDTH_CSS.code,
      cell: (l) => (
        <Input aria-label="Remark" value={l.remark} onChange={(e) => setLine(l.key, { remark: e.target.value })} />
      ),
    },
  ];

  return (
    <CadFormFrame
      inline={inline}
      open
      onClose={onClose}
      title={`Pattern · ${row.style_ref_no}`}
      // lg (full screen): this is the Pattern Maker's whole form — a header row
      // of five and a nine-column grid — opened from the CAD Queue, not a small
      // sub-detail; md's ~1,100px would leave the grid 19px from falling to cards.
      size="lg"
      alignToPane
      origin={origin}
      footer={
        <>
          <Button variant="outline" size="md" onClick={onClose}>
            Cancel
          </Button>
          <Button size="md" disabled={isPending} onClick={save}>
            {isPending ? "Saving…" : "Save pattern"}
          </Button>
        </>
      }
    >
      <DetailSection label="Pattern Status">
        {/* term 176 + code 144 + name 288 × 2 + term 176 + 4 gaps 48 = 1,120 —
            one row on the page; wraps in the sheet. Buyer / RE No / Style are
            the order's, read-only. */}
        <FieldRow align="start">
          <Field label="Pattern Status" required w="term" htmlFor="cad-pattern-status">
            <Select id="cad-pattern-status" value={status} onChange={(e) => setStatus(e.target.value as PatternStatus)}>
              {PATTERN_STATUSES.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </Select>
          </Field>
          <Field label="Date" w="code" htmlFor="cad-pattern-date">
            <Input id="cad-pattern-date" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
          </Field>
          <Field label="Buyer" w="name" htmlFor="cad-pattern-buyer">
            <Input id="cad-pattern-buyer" readOnly value={row.customer_name ?? ""} />
          </Field>
          <Field label="RE No / Style Name" w="name" htmlFor="cad-pattern-re">
            <Input
              id="cad-pattern-re"
              readOnly
              value={[row.re_no ?? row.order_code, row.style_description].filter(Boolean).join(" / ")}
            />
          </Field>
          <Field label="Style" w="term" htmlFor="cad-pattern-style">
            <Input id="cad-pattern-style" readOnly value={row.style_ref_no} />
          </Field>
        </FieldRow>
        {status !== "ready" && (
          <p className="text-xs text-muted-foreground">The CAD can be sent once the pattern is marked Ready.</p>
        )}
      </DetailSection>
      {/* frameless: the grid draws the one frame (ONE FRAME PER GRID). */}
      <DetailSection label="Pattern Details" frameless>
        <ChildGrid<LineRow>
          columns={patternLineColumns}
          rows={lines}
          tableFrom="5xl"
          flatRows
          addLabel="+ Add line"
          onAdd={() => {
            setLines((xs) => [
              ...xs,
              {
                key: newKey(),
                part: "",
                coordinate_id: null,
                component_id: null,
                fabric_category_id: null,
                fabric_name: null,
                gsm: "",
                colour: "",
                size_id: "",
                table_dia: "",
                width_form: "",
                avg_pcs_weight_g: "",
                remark: "",
              },
            ]);
          }}
          onRemove={(l) => setLines((xs) => xs.filter((x) => x.key !== l.key))}
          renderMobileRow={(l, i) => (
            <FieldRow align="start" gap="tight">
              {patternLineColumns.map((c, ci) => (
                <Field key={ci} label={c.header} w={fieldWidthStep(c.width) ?? "hug"}>
                  {c.cell(l, i)}
                </Field>
              ))}
            </FieldRow>
          )}
        />
      </DetailSection>
      {serverError && (
        <p role="alert" className="rounded-md border border-danger bg-danger-soft px-3 py-2 text-sm text-danger">
          {serverError}
        </p>
      )}
    </CadFormFrame>
  );
}
