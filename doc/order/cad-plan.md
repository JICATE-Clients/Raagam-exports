# CAD Lifecycle — build plan and what was built (2026-09-24)

Spec: `doc/order/cad.md`. Migration: `0628_cad_lifecycle.sql`. Code:
`lib/orders/cad-lifecycle/*`, `components/orders/cad/*`,
`app/(app)/orders/cad-lifecycle/*`, `app/(app)/orders/cad-room/*`,
`app/(app)/reports/cad-completion/*`. Check: `npm run check:cad-lifecycle`
(inside `build:check`, beside `check:work-flow`).

## 1. The spec described tables this repo never had — mapped, not copied

| Spec | Here | Why |
|---|---|---|
| `staff_master`, `designations` | `employees.designation_id → config_lookups` (kind `designation`) | That is the list Master Data ▸ Associates ▸ Employee's Designation picker offers. `public.designations` is a different table the Employee screen cannot attach (0482's trap). |
| "Pattern Maker" / "CAD Technician" designations | seeded as WORDS by 0628 | No employee holds them yet — tag the pattern makers on the Employee master. Until then the Pattern Maker picker is empty and says so. |
| `style_id INT` | `(garment_order_id, style_ref_no TEXT)`, compared trim + upper | Order styles are deleted and re-inserted on every order save, so no table here holds a style-row FK (0461, 0479). |
| `marker_definitions.is_submitted` | `order_cad_allocations.is_submitted` per VERSION; order-level = `cad_order_ready()` | `marker_definitions` never existed. The existing CAD Markers sheet (`order_cad_markers`, 0460) is the consumption data and is unchanged. |
| Customer Review Lead Days | `customers.cad_review_days` | New field on the Customer master. Blank = no Expected Approval Date (the dispatch says so). Calendar days. |
| `layout_type (style)` | `garment_order_amendment_styles.layout_type` | Restored per STYLE at the user's instruction (2026-09-24). 0533 removed a per-COMPONENT one on 2026-09-05 — a different field. |
| `ENUM`, `SERIAL`, `TINYINT` | text + CHECK, uuid, int | Postgres. |
| `/uploads/cad/styles/{style_id}/v{n}/` | `garment-order-docs` bucket, `cad/{order}/{style}/v{n}/{style}_{n}_{timestamp}.{ext}` | A style ref is unique only within its order; the private bucket's RLS already gates on orders permission. |

## 2. Where each rule is enforced

| Spec rule | Database (0628) | Screen |
|---|---|---|
| Pattern Maker designation (§2.1) | trigger on allocation insert / maker change | `patternMakerOptions` (empty-and-explain; held value survives) |
| CAD Type + Pattern Maker mandatory (§7) | NOT NULL + CHECK | required fields |
| Allocation Date = system date, not future (§2.3) | trigger stamps IST today | read-only field |
| Target ≥ Allocation (§2.3) | CHECK | `allocationProblem` |
| Sequential versions (§4.2, §7) | trigger: v(n+1) only after v(n) = Rework; number assigned by DB | Re-allocate offered only on Rework |
| A dispatched version is history | trigger refuses edit / delete | menu offers Edit/Delete only before dispatch |
| Attachment mandatory, .DXF/.PDS/.PLT (§3.1) | `cad_dispatch` RPC: ≥1 file, extension, path under the version folder — one transaction | `CadFileUpload` checks by EXTENSION (browsers give CAD files no MIME type) |
| Dispatch proof (§3.2) | CHECK + RPC | `dispatchProblem` |
| Expected Approval = Dispatch + lead days (§3.3) | RPC stamps it | shown live in the sheet |
| Dispatch / decision not in the future (§7) | RPC vs IST today | `max=today` + rule |
| Rework needs comments (§4.2) | CHECK + RPC | `decisionProblem` |
| Layout must match the style (§7) | `cad_decide` refuses Approved on mismatch | `decisionProblem`, same sentence |
| Approved → is_submitted (§4.3) | `cad_decide` | — |
| Fabric BOM refused unless submitted (§7) | `trg_ofb_cad_guard` BEFORE INSERT on `order_fabric_boms` (stands down for a revision revert) | `createFabricBom` + CAD seed ask first; the editor opens a NEW BOM read-only with the reason and "Open CAD Lifecycle" |
| Pattern Sent / Pattern Approval (§4.3) | Work Flow milestones (0607 table), stamped with the EVENT date by `cad_work_flow_sync` | Order Entry ▸ T&A ▸ Work Flow |
| "CAD PENDING" on Fabric BOM reports (§4.3) | — | bordered red badge on screen and on every PDF page (not a faint diagonal — photocopiers lose those; the GOS Draft badge rule) |
| Order Sheet shows "Approved (V{n})" / red "Pending" (§6.2) | — | per style on the Garment Order Sheet |
| CAD Completion Report (§6.1) | — | Reports ▸ CAD Completion; lead time = approval − V1 allocation |

## 3. Decisions (user may adjust)

- **Two doors, one behaviour (user 2026-09-24: "Both").** Orders ▸ CAD ▸ CAD
  Lifecycle is the CAD team's cross-order work list; Order Entry ▸ **CAD** is
  the merchandiser's view of ONE order. Both draw the next step, the
  corrections menu and the four sheets from `useCadActions`
  (`components/orders/cad/use-cad-actions.tsx`), so a style can never be
  offered different steps in the two places. The tab is its own component
  (`order-cad-tab.tsx`) reading its own rows (`getOrderCad`) — no hook joins the
  order editor below its early return. It sits inside `SeparateDocumentScope`
  (field.tsx): CAD records are outside the order lock, so the tab still works
  on an approved order, through its own actions only; the Eye's read-only view
  shows it without actions.

- **Grain is order + style.** The same style ref on two orders is two CAD
  lifecycles — a style ref is only unique within its order here.
- **Only CREATION of a Fabric BOM is gated.** A BOM that already exists keeps
  saving; the two existing orders both already have one.
- **The seed from the CAD Markers sheet now needs both** the sheet submitted
  (0460's rule) and every style approved (this spec).
- **Milestones are per RE and done when EVERY style is sent / approved**, dated
  by the last style's dispatch / approval. They never move backward (0607).
  Both default to 2 working days after Day 0 (the old CAD step's figure) and
  are editable per order. Existing orders got the two rows, pending, with the
  overdue alert pre-silenced (0607 §9's rule — no flood about old orders).
- **Corrections exist and are bounded:** edit/delete a version not yet sent;
  undo a dispatch the buyer has not answered (its files are removed); reopen a
  decision while no later version exists.
- **Permissions:** `orders:view` to see, `orders:edit` for every write
  (the CAD Technician role already holds both — 0458). No new permission module.
  **0631** adds two storage policies for the `cad/` folder only: upload with
  `orders:edit` (the bucket's own INSERT needs `orders:create`, which the CAD
  Technician does not hold), and delete with `orders:edit` of an object no
  recorded dispatch points at (undo / a cancelled sheet).
- **A style that left the order** keeps its CAD history on the listing, flagged;
  it neither blocks nor satisfies the Fabric BOM gate.

## 4. Verified

- 0628 applied; grants read from the catalog (no `anon` on any function; the
  internal ones not callable by `authenticated`).
- Behaviour, in rolled-back transactions against the live database, as the
  admin user: designation refusal, v1 / v2 numbering, v2 refused before
  Rework, edit/delete refused after dispatch, the Fabric BOM trigger's
  sentence, milestone stamping with event dates, every `cad_dispatch` refusal
  (no file, .pdf, future date, no proof, marker without layout), expected date
  = +7, layout mismatch refused, rework without comments, reopen, undo removes
  dispatch and files. Nothing was left behind.
- `check:cad-lifecycle` made to FAIL first against four mutations (state read
  from the first version, no layout check, .pdf accepted, a wrong designation).

## 5. Not done / remainders

- Not browser-verified end to end (no employee is tagged Pattern Maker yet, so
  a real allocation needs the Employee master first).
- IWO Fabric BOMs are not gated — IWOs are not garment orders with styles.
- The CAD tables stay outside the budget-approval order lock, as 0576 left
  0460's — CAD rework on an approved order is recorded, not refused.

## 6. 2026-09-25 — the Order Entry ▸ CAD tab spec (0632 · 0634)

The spec restated the lifecycle (allocation, dispatch, expected date, decision,
T&A sync), and those parts were already live. What it added:

| Spec | Built |
|---|---|
| Fit Wash Process Yes/No + Length / Width Shrinkage % (mandatory on Yes) | `fit_wash`, `length_shrink_pct`, `width_shrink_pct` on the VERSION; CHECK (0634 fixed a NULL hole in 0632's) + `allocationProblemAt` |
| Cut Type One-Way / Two-Way | `cut_type` |
| Component Cut Method per style component (Direct Shape / Fit Form) | `component_cuts` jsonb, name snapshotted; rows from Order Info ▸ Style Components; validated by the allocation trigger |
| CAD Type: Initial Fit / Grading & Size Set / Marker-Consumption / Shrinkage-Wash | labels renamed (stored values unchanged); `shrinkage_wash` added, needs Fit Wash = Yes |
| Designer from "CAD Designer" / "Pattern Maker" | CAD DESIGNER seeded as a third accepted designation |
| .PDF marker upload | accepted BESIDE a .DXF/.PDS/.PLT, never instead of one |
| Transmission Proof attachment | `order_cad_dispatch_files.kind = 'proof'` (.PDF .JPG .PNG .EML .MSG) under `v{n}/proof/`; counts as proof of dispatch |

Pattern details freeze at dispatch, like every other allocation field.

**Deliberately NOT changed:** Rework does not auto-create V2. It leaves the style
at "Rework required" and the next step is Re-allocate, which pre-fills V2 from
V1 (maker, type and now the pattern details). V2 still needs a new Target
Date, and a system-made version would have to invent one.

## 7. 2026-09-25 — the tab shows the form, not a table (0637)

- Order Entry ▸ CAD renders the next step's form in place (`cad-form-frame.tsx`);
  the style table was removed at the user's request. One strip above the form:
  Style (a select when the order has more than one), status, history, corrections.
- Component Cut Method is a table of the style's components — Coordinate ·
  Component · Structure · Cut Method — keyed (coordinate, component) by 0637, so
  a TOP and a BOTTOM FRONT BODY are two rows.
- Test employee TST-PATT-1 (PATTERN MAKER 1, designation PATTERN MAKER) added
  to the live database on request.

- **Fit Wash Process → "Bit Wash"** (user 2026-09-25). Label only; the column stays `fit_wash`.

## 8. 2026-09-25 — Pattern Status, Order Sheet, clean-up (0638 · 0639)

- **Pattern Status** on each version (0638): Garment Not Received (default) →
  Acknowledged → Ready. It sits INSIDE Assign → Send → Buyer decision (user:
  "add it inside"). **Send requires Ready** (user): `cad_dispatch` refuses
  otherwise. Frozen at dispatch; dispatched versions backfilled Ready.
- The Pattern Master's step is `PatternWorkForm` (`cad-pattern-work.tsx`): the
  status plus the **Order Sheet** grid. In the tab it shows first, with Send
  beneath it once Ready; in the CAD Queue the row's button reads "Pattern Status"
  until Ready, and the ⋯ menu has "Pattern status & notes".
- **Order Sheet** (`OrderSheetSection`): the style's sizes, and per component
  Coordinate · Component · Structure · GSM (from the order's combos) · Cut Method
  · **Notes** (piece weight, opening-dia adjustments). A row may hold notes
  without a method. **No dia column**: the order holds no dia (only the Fabric
  BOM does, and it cannot exist before the CAD is approved).
- **View Order Sheet** on every CAD row's menu → the Garment Order Sheet report
  (href from `ORDER_REPORTS`).
- **CAD Type** removed from the Order Entry tab; the tab stores Initial Fit
  Pattern; the CAD Queue sheet still shows and edits it.
- **CAD Markers** back off the menu (`retired` group), URL and search intact.
- **BIT WASHING** (0639): BITWASH renamed; BIO WASH switched off (nothing used either).
- Kept by decision: buyer **Send + Approval** (they drive the Fabric BOM gate and
  the T&A Pattern Sent / Approval dates).
- **Not built yet:** the CAD → Fabric BOM auto-fill (spec §3).

## 9. 2026-09-25 — the Pattern Maker's sheet (0640) and the queue

- CAD Queue: Ver / Dispatched / Expected Approval / Status / Next columns removed; a **Pattern Status** dropdown column saves on change (read-only once sent). The ⋯ menu holds the next step (not Pattern Status), View Order Sheet and **Delete** only.
- `PatternWorkForm` is now the register the pattern room keeps: header Pattern Status · Date · Buyer · RE No / Style Name · Style; lines Fabric · GSM · Type of Parts · Colour · Size · Table Dia · Tubular / Open Width · Avg CAD Pcs Wt (g) · Remark (`order_cad_pattern_lines`, saved atomically by `cad_save_pattern_sheet`, frozen at dispatch). Seeded one line per style component; untyped lines are not saved. These typed numbers are what the Fabric BOM auto-fill will read.
