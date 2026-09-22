# IWO Fabric Consumption & Finish Dia rules · implementation plan

Spec: two pasted "technical specification" documents (2026-09-21) — *IWO Fabric
Consumption Logic & Finish Dia Listing / Auto-Fill Rules* and *Handling of
multiple diameters (Finish Dia)*. Written after mapping both onto this repo and
onto the client's own IWO SRS (`doc/order/internlwork order.md`) and Fabric
Process audio notes (`doc/order/fabriprocess.md`). Most of it is either already
built or contradicts a client document; three items are genuine gaps and are
listed for a decision at the end.

**Every file the spec names is fictional.** `lib/orders/internal-work-orders/lines.ts`
(deleted by 0585), `lib/orders/fabric-bom/calculations.ts`,
`components/orders/fabric-bom/structure-tab.tsx`, `…/process-tab.tsx` — none
exists. The real files are named in the table.

## 1. Section by section

| Spec | Status |
|---|---|
| §1A Piece Wt = W × L × GSM ÷ 10,000; Net Wt = Planned Pcs × Piece Wt on the **IWO** | **Wrong formula, and not built.** The legacy IWO screen (recording 2026-09-21) DOES have a calculated weight — but as *Garments × Grams/Garment* on the dia row, gated by a fabric-level `Type: Direct ▾` whose default is Direct; not the pattern W × L × GSM the spec describes. The SRS's "bypassed" means Type = Direct. Not adopted here (this application derives Gross Yarn from Req Wt through the route, which is the figure that matters); revisit only if the client asks. Original note kept below for the SRS citation. `internlwork order.md` §1/§4: an IWO "completely bypasses" garment panel logic — *"Garment Pcs = 0, Grams/Pc = 0 … the merchandiser inputs the Required Weight (Req Wt) directly in KGS"*. `iwo_fabric_bom_lines.req_kgs` is that typed figure; `iwoFabricGross` (`lib/orders/iwo-fabric-bom/yarn.ts`) replaces exactly one link of the order chain — where the gross comes from. The formula itself already exists where the client put it: the **order** Fabric BOM ▸ Manual ▸ Calculated mode (`lib/orders/fabric-bom/manual.ts`, `GRAMS_CONVERSION = 10_000`, tolerance on the length per 0524). Adding a piece-weight matrix to the IWO would re-introduce the garment logic the SRS says the IWO exists to skip. |
| §1B Backward compounding ÷(1 − L), 1000 / (0.98 × 0.90 × 0.95) = 1193.460 | **Exists.** `comboUplift` (`yarn-process.ts:790`) is `factor *= 1/(1 − loss/100)` per step, compounded; IWO's `iwoRoutesByFabric` / `iwoYarnModePurchase` feed the same function. `check:iwo-fabric-bom` §3/§4/§10 pin it and refute the ×(1+L) reading. |
| §1C "both must pass `strategy = 'DIVIDE_SUBTRACT'`" | **False premise — do not build** (verified this morning). There is ONE engine and it divides; a strategy switch would only add the multiplicative branch the user refused on 2026-09-18. The accessories side (Material BOM) multiplies by design — a different engine, not a strategy. |
| §2A Finish Dia de-duplicated by value: Circular 60" + Woven 60" = one `60` | **Exists on both screens.** Order: `declaredDiaOptions` keys on `diaKey` (text, upper-cased — a dia has been text since 0566, so `23 CM` is a legal value) and shows the families as a sublabel ("Circular · Woven"). IWO: `declaredDias` is `new Set(trim().toUpperCase())`, same identity, no sublabel. |
| §2A′ (implied by the order's rule) Finish Dia scoped to the fabric's knit family | **Exists on the order, MISSING on the IWO.** Client 2026-09-19: *"if the fabric is circular, circular dias only; if flat, flat only"* — `diaOptionsFor(held, knit)` + `dia-knit.ts` (`diaKnitProblem` refuses Save) on the order. The IWO's `diaOptionsFor(held)` takes no family: a Fabric IWO with a circular and a woven cloth offers every declared dia to both. Its Dia panel already carries `knit_type` (0581) and every line has `structure_id` → `structures.knit`, so the scoping needs no schema. **Gap A.** |
| §2B Exactly one dia declared → auto-fill; two or more → abstain | **Exists — it is the client's own spec point 5** ("automatically prepopulate the Dia field … but remain editable"): the order's `defaultDiaFor(knit)` prefills a new size row only when the fabric's FAMILY declares exactly one dia, else abstains. The IWO had the prefill on fabric pick but counted across every family; **built now** — it counts within the family, like the order. |
| §2C Finishing Dia on the BOM line vs Knitting Dia on the GREY KNITTING step | **Half exists.** Finishing Dia is `finish_dia` on both BOM line tables. Knitting Dia exists only as a MASTER (`config_lookups` kind `knitting_dia`, Master Data ▸ Materials ▸ Knitting Dias) — nothing stores it on a route step, a fabric or a line. The concept is the client's (`fabriprocess.md` §5, from their audio: *"the target diameter set on the knitting machine loom to account for shrinkage"*), but that note describes the parameter; it does not ask for it on the route. **Gap C — a real feature, needs scoping with the client** (which step carries it, whether it prints on the knitting programme / process order). |
| Doc 2 §2 Item Form filters the component pool (Open Width → FRONT BODY, Tubular → NECK RIB) | **Not built, and not sourced.** `componentOptionsFor` scopes components by (style, structure) — the client's "strictly restricted to what is in the order" rule. A component's roll form is a property of the ENTRY (`width_form`, 0495), not of the component master, so there is nothing to filter by. Not recommended without a client instruction. |
| Doc 2 §2 pick a dia per component / size row in the grid | **Exists** — the order's Manual grid has a Finish Dia per size row (`diaOptionsFor(r.dia, entryKnitCode(e))`); the IWO's Consumption grid has one per line, and `+ Dia` adds the next line of the same fabric (2026-09-20). |
| Doc 2 §3 Direct mode hides Width / Length / Tolerance / Calc Wt; Calculated unhides them | **Exists** — `...(mode === "calculated" ? measured : [])` on the Manual grid; Direct is the default ("99.9% of entries"). |

## 2. What I recommend building

**Gap A — IWO Finish Dia scoped by knit family. BUILT 2026-09-21.** Already the
client's rule on the order screen; the IWO copy simply never received it.
`IwoStructureOption.knit_code` (the family's lookup code beside its name),
`diaOptionsFor(held, knit)` copied from the order screen (family sublabels, held
value survives tagged), `defaultDiaFor(knit)` for the prefill, `diaKnitBlockers`
on the screen's Save gate and `diaKnitProblemOf` in the action — both
`diaKnitProblem` from `dia-knit.ts`, so the refusal sentence is the same on both
screens. `check:iwo-fabric-bom` §17 pins the wiring. No migration.

**Gap B — folded into Gap A.** The prefill already existed on both screens (the
client's spec point 5); what the IWO lacked was counting "exactly one" within
the fabric's family. Done with A.

**Gap C — Knitting Dia on the knitting step.** Not in this plan's scope to build:
it needs a column on `order_fabric_bom_processes` AND `iwo_fabric_bom_processes`
(both tables are delete-and-reinsert on Save, so a column, never a child table —
0606's lesson), a cell on `FabricProcessGrid` shown only on an `is_knitting`
step, and a decision on where it is READ (process order? knitting programme
print? the Fabric T&A Step 6?). A stored value nobody reads is the
"column no code reads lies to the admin who set it" trap. Ask the client what
consumes it before storing it.

## 3. What is deliberately NOT built

- §1A piece-weight matrix on the IWO — contradicts the SRS (see table).
- §1C strategy switch — false premise; the engine already divides everywhere.
- Doc 2 Item-Form component filtering — no client source; components are scoped by style + structure.

## 4. Verification (for whatever is built)

- `npm run check:iwo-fabric-bom` (new §13 / §17 vectors, each made to FAIL first by mutating the rule).
- `npm run check:grid-budget` — no column widths change.
- `npx tsc --noEmit`, `npm run check:hooks`.
- Click-test on `localhost:3000/orders/iwo-fabric-bom`: a circular fabric's Finish Dia ▾ lists only circular dias; a woven line already holding a circular dia shows it tagged and Save refuses it by name.

## 6. Derived cards — BUILT 2026-09-22 (supersedes §5)

User, screenshot 3000: the Plan by attribute was "not a good fit … we can plan it
like derived values". A pasted "Grouped Fabric Consumption UI & Auto-Derivation
Engine" spec made it concrete, and two of its claims were corrected against the
repo: the Fabric Colour and Dia panels are per BOM, not per fabric (0581), and
Form / GSM are typed once per fabric (user's choice), not per row.

- **One card per fabric** on Fabric Consumption. Header: fabric name + family ·
  type, then Stage ▾ · Form ▾ · GSM (the fabric's, stored on every line).
- **Rows are DERIVED**: a coloured stage = Fabric Colour × the fabric's family
  dias (× Roll form prints on PRINT); GREIGE = dias only. Colour / Print / Dia
  are text; **Req Wt is the one typed cell**; Gross Yarn per row; the totals
  band is the card subtotal. No `+ Add`, no ✕.
- A blank weight is not stored. A weight whose axes the panels no longer name is
  KEPT on the card tagged "(not declared)" and Save refuses it by name.
- A fabric with no weighted row expands to ONE placeholder line, so the existing
  `req_kgs` rule refuses it on screen and in the action ("enter a weight on at
  least one row").
- Stage change keeps every weight: → GREIGE merges per dia and sums; off PRINT
  merges the prints; GREIGE → coloured is the identity (cells show as not
  declared until retyped per colour).
- `lib/orders/iwo-fabric-bom/plan.ts` rewritten (`derivePlanRows`, `setPlanCell`,
  `expandPlanCells`, `foldPlanCells`, `planCellsForStage`, `familyDias`,
  `stalePlanRows`, `planReqKgs`, `plannedColours`); `fabric-breakup-sheet.tsx`
  deleted; storage, `lines.ts`, the engine and the action untouched.
  `check:iwo-fabric-bom` §18 rewritten (fail-first under four mutations).

## 5. Plan by — BUILT 2026-09-21, SUPERSEDED 2026-09-22 by §6 (history)

Screenshots 2990 · 2992; design in the plan artifact (rev 5, "our application's
shape"). One row per fabric on Fabric Consumption; a **Plan by ▾** (Fabric ·
Colour · Dia · Colour + Dia — the IWO Material BOM's Attribute, 0614, with a
fabric's axes; GREIGE offers Fabric · Dia only) and, under a split, the **Req Wt
cell is a button** carrying Σ rows that opens the **[Breakup] sheet** — one flat
`ChildGrid` with only the attribute's columns (Colour ▾ / Print ▾ where Colour is
split on a Print stage / Finish Dia ▾ family-scoped / Req Wt / Gross Yarn per
row). Split axes read as summaries on the row (`WHITE · RED`, `74 · 76`).

- `lib/orders/iwo-fabric-bom/plan.ts` (pure): `reqKgsOf` (one reader),
  `expandPlan` / `foldLines` (the boundary to 0592's one-line-per-(fabric,
  colour, dia) — storage, `lines.ts`, engine, budget, reports unchanged; Plan by
  is INFERRED from the lines, never stored), `replan` (switching keeps what was
  typed), `replanForStage` (→ GREIGE merges colours per dia and SUMS; prints go
  off a Print stage), `planByFor`. `check:iwo-fabric-bom` §18, 5 mutations caught.
- From the legacy screen only the CONTENT was taken (a colour has dias with a
  weight each; Print belongs to the colour). Not its nested grids, ⓘ pickers,
  Req Qty / Measurement / Specification, or Type Direct/Calculated.
- No Of Colors on Allocation stays TYPED: it seeds the Yarn Dyed repeat (yarn
  colours in a stripe), which is not the count of dyeing shades.
- Gross Yarn on the row is now Σ per colour of kgs × `comboUplift(route, colour)`,
  so a 0613 colour-wise loss shows on the IWO.
