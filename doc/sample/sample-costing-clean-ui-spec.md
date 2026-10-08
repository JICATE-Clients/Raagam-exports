# Sample Costing — Clean UI Specification

> **Layout superseded 2026-10-08.** The screen is now the step page: a sticky price bar (Net → Margin → FOB), seven step chips (Details · Fabric · Garment weight · CMT & charges · Trims · Overheads · Price & quote), one step open at a time, each fabric one row with its rate built inline, and a sticky Quotation summary on the right. The calculations in this spec are unchanged. See the header comment of `sample-costing-screen.tsx`.


**Status:** the current UI blueprint for Sample ▸ Sample Costing (2026-10-07).
It **supersedes** `sample-costing-uiux-design-spec.md` (v1) and
`sample-costing-uiux-design-spec-v2.md` (v2). The data and arithmetic stay as
`sample-costing-specification.md` defines them.

## 1. Why

v2 added mode switches, presets, auto-fill badges, a completion progress bar,
sliders and a section sidebar. Each was reasonable alone; together they made
the screen busy, and a merchandiser who wants to type four numbers and see a
price had to read past all of it. This spec strips the screen back to the work.

## 2. Principles

1. **No visual clutter.** No progress bars, gamification badges, mode toggles,
   preset strips, sliders or section sidebars. Generous whitespace, light
   borders, a subtle grey canvas.
2. **One column, edge to edge** (layout plan B, user 2026-10-07). Five cards
   down the whole pane, each with its own ₹ per piece at the right of its
   header; the price rides in the footer. The earlier 60/40 split with a
   sticky summary was withdrawn: it never shared a top or bottom edge with
   the cards, squeezed the CMT grid below its width at 1366, and left an
   empty strip beside the cards once scrolled.
3. **Spreadsheet-style entry.** Click into any box, type, press Tab to the
   next. Enter moves on; Ctrl+S saves (the app keyboard contract — nothing
   per-screen).
4. **Help stays, quietly.** Features that save work keep working without
   their own chrome: blank fields auto-fill from approved history, a draft is
   recovered, an earlier costing can be copied. None of them adds a badge.

## 3. Layout

```
+-----------------------------------------------------------------------------------+
| HEADER  CST/26-27/0001 · Rev 0 · Draft | SMP/26-27/0001 | MENS T SHIRT | AARSAN    |
|                                   Copy from · Compare · PDF · Submit · ← Back      |
+-----------------------------------------------------------------------------------+
| Costing details                                   AARSAN · MENS T SHIRT · 1 piece  |
| 1. Fabric rates                                                       ₹ 186.40     |
| 2. Component weights & CMT                                            ₹  98.70     |
| 3. Trims & overheads (trims · wastage · overhead · bank)              ₹  57.40     |
| 4. Price & quote  Margin · Discount · Currency · Rate · Ship Mode ·   $ 5.10 25 %  |
|                   Freight · Insurance · Quoted price                               |
|                   FOB hero · quote matrix · ▸ Cost breakdown · ▸ Work back         |
+-----------------------------------------------------------------------------------+
| FOOTER  Net ₹ 342.50 → Margin 25.0 % → FOB $ 5.10 / PCS        Cancel · Save       |
+-----------------------------------------------------------------------------------+
```

- **Header:** one line of context and the actions.
- **Cards**, in calculation order. The three cost cards' header figures are
  each card's OWN ₹ per piece (fabric; CMT + processing + testing; trims +
  bank) and add up to the Net cost.
- **Price & quote** holds every SELLING term — they change the price, not the
  garment cost — so they come last in Tab order, as the arithmetic does.
- **Footer dock:** read-only Net → Margin → FOB. No field is pinned, so Tab
  and the arrows never land in it; clicking FOB scrolls to Price & quote.

## 4. Behaviour

| What | Rule |
| :--- | :--- |
| New sheet | Opens with one search, *What are you costing?* (sample, style or customer). Picking a style fills the header and puts the cursor in the first fabric. |
| Auto-fill | Blank fields only, no badge: the fabric's last approved rate, the customer's last approved terms, today's Quotes / Orders exchange rate. A typed value is never overwritten. |
| Missing fields | Save names the first missing field and moves the cursor there with a brief highlight. No counts, no progress bar. |
| Margin colour | The margin figure is green at ≥ 22 %, amber at 15–21.9 %, red under 15 %, as plain coloured text. |
| Approval | Unchanged: under 20 % goes to the MD on Submit; under 15 % the Quotation PDF waits for approval. |
| Narrow screens | Already one column; the footer dock shrinks to Margin → FOB on a phone. |

## 5. Removed from v2, on purpose

Express / Pro modes, the 1-click preset strip, ⚡ auto-fill badges, the
completion score bar and its pills, the margin slider, the multi-currency
line, the numbered section sidebar and scroll-spy, the price-history
sparkline and the rate-memory chips.

## 6. CMT and Embellishment come from the Process master (0691 · 0692, 2026-10-08)

A piece's CMT is its **Direct rate** (one flat ₹ per piece) or, with Direct
rate unticked, the sum of **CMT operation** lines (Cutting, Stitching,
Checking, Ironing, Packing …). **Embellishment cost** is a list of Process
master picks, each with a ₹ per piece. Both are picked by KIND, not typed:
`processes.garment_kind` ('cmt' | 'embellishment', set on the Process master
under For ▸ Garments) decides which list a process appears in; a process with no
kind is in neither. The old fixed Print / Embroidery / Wash columns are no longer
written or read (left in the table, unread). Stored in
`sample_costing_piece_processes` + `sample_costing_pieces.cmt_direct`; the engine
is `pieceCmt` / `pieceEmbellishment` in `lib/sales/sample-costing/calc.ts`, pinned
in `check:sample-costing`.

---

## Garment weight: sizes are style sizes the operator chooses (0693, 2026-10-08)

The Garment weight step is the weight table alone, full width: sizes across the top, the component down the left with its fabric under its name, then **Fabric used**, **Loss %** (one box per size; blank takes the first size's), **Total with loss** and **Fabric ₹**. CMT, Embellishment and Testing are in the **CMT & charges** step: per piece, CMT as one row, then Embellishment (optional list, a calm "none" line until one is added) beside Testing (stacked under it when narrow), then the `CMT + Embellishment + Testing = ₹ per piece` line.

Sizes are NAMES taken from the style's own ticked sizes (Sample Entry), added one at a time
from "+ Add size…"; nothing is pre-selected and the Size Group picker is gone. Weights and quotes
are stored by `size_name` (0693); `size_group_id` is no longer written and is read only to show a
pre-0693 row under its group's name. A row with no size is a legacy "every size" row and fills the
first size's column. Loss % rides on every weight line's `wastage_pct` for that size, so a sheet
saved with different allowances per line reads back as its first line's value.

## Trims by consumption (2026-10-08, migration 0694)

A trim line is priced one of two ways, from the client's Trims Consumption spec:

- **Direct rate** (default; every line saved before 0694): cost = Consumption × Rate. A blank Consumption counts as 1, so "₹25 a piece" needs nothing else.
- **Package price** (Direct rate unticked): cost = (Package ₹ ÷ Pack size) × Consumption. A blank Pack size counts as 1, so a length trim is Rate per metre × metres with the pack boxes empty.

`qty` (0688) already meant "units per garment", so it IS the Consumption; three columns were added to `sample_costing_trims` (`is_direct`, `pack_price`, `pack_size`). One helper, `trimCostPerPiece` in `calc.ts`, is read by the screen, the server Submit and the PDF. A Pack size of 0 or less is never divided: the line costs 0 and Save is refused with a plain sentence; a price with no Consumption is refused the same way. The seeded blank row stays blank because `isBlankTrim` never tests `is_direct`.
