# Sample Costing — Clean UI Specification

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
