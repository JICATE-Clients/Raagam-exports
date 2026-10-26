# Raagam Assist — one tap-first chat + the garment-factory problem catalog (PLAN)

Status: **PLAN, for the user's approval — nothing built yet** (2026-10-26).
Asked: "one unified chat mode … tapping with pre-built options for the subject
and what happened … think from a garment company, list all the problems we
should cover in Buy / Broken / IT … clean and compact, why this many
uncleaned categories — think from the bottom."

Builds on: `doc/resolve/service-desk-plan.md` (stage 3) and the chats built
2026-10-26 (`components/resolve/{report,service,complaint,chat}/*`).

---

## 1. What is wrong today (from the bottom)

| Today | Problem |
|---|---|
| Four separate chats, each asking in its own order | Same person, four different conversations |
| The person TYPES the subject and "what happened" | Slow on a phone, inconsistent words, half the reports say "NOT WORKING" |
| Three unrelated lists: **trades** (8, for Broken), **IT categories** (10), **complaint categories** (7) | 25 internal words the reporter must map their problem onto; IT alone shows 10 chips |
| "What kind of problem?" asked after the fact | The reporter is asked to do the routing; that is the system's job |

**The fix in one line:** the reporter taps **what happened** from a short list
written in their words; the list item already knows the team, the category,
whether it is dangerous and the subject line. Trades and categories disappear
from the reporter's screen entirely — they stay as the routing behind each
item.

---

## 2. The unified chat — one flow, five taps typical

```
 ┌───────────────────────────────────────────────┐
 │ (avatar) Raagam Assist · replies in ~30 min   │
 ├───────────────────────────────────────────────┤
 │ Hi Roja! What do you need?                    │
 │                                               │
 │ [🔧 Fix something] [💻 IT help]                │   ← 4 lanes
 │ [🛒 Buy something] [🛡 Raise a concern]        │
 │                                               │
 │ ──────────────────────────────────────────── │
 │ 🔍 Search a problem: "needle", "salary", …    │   ← one box, searches the
 └───────────────────────────────────────────────┘     whole catalog
```
(Icons in the build are lucide line icons, never emoji — shown here only to
sketch.)

**Every lane runs the same five beats:**

| Beat | Asked as | Fix something | IT help | Buy something | Raise a concern |
|---|---|---|---|---|---|
| 1 Lane | 4 cards | ✓ | ✓ | ✓ | ✓ |
| 2 Area | ≤ 8 chips with icons | Sewing machine, Electrical … | Computer, Printer … | Production, Office … | Pay, Behaviour … |
| 3 **Subject** | ≤ 8 pre-written problems + "Something else" | "Needle breaking" | "Not printing" | "Machine needles" | "Overtime not paid" |
| 4 **What happened** | ≤ 5 detail chips (+ optional note) | "Stopped completely" | "Says offline" | qty + needed-by chips | "This month" / "Since 3 months" |
| 5 Lane extra | 1 question, only when needed | **Where** (place/machine) | **Effect on work** | **Why** (chips) | **Superior?** + **Name / anonymous** |
| then | Photo (Fix, IT) · Review card · Send · Receipt in chat | | | | |

Rules that keep it compact:
- **Two levels only** (Area → Problem). Never a third.
- **≤ 8 options per screen.** More than 8 → the 6 most-reported this month
  first + "More…". The order learns from use (`used_count` per item, per unit).
- **Typing is optional, never required.** "Something else" and "Add a note"
  are the only free-text doors. The search box finds any item by its words
  and synonyms ("thread cut" → "Thread breaking").
- **Smart skips:** an item marked *dangerous* never asks "could it hurt
  someone" — it says "Marked urgent" and, for gas/fire/shock, first shows
  "If anyone is hurt or in danger, call [EMERGENCY NUMBER] / the first-aider
  now". A place with one obvious machine type skips Area.
- The **subject line** saved on the ticket = the item's label; **what
  happened** = the chosen detail chip(s) + the optional note. Both stay in
  CAPITALS (stored values), exactly as today.

---

## 3. The catalog — garment factory, all four lanes

Each row is one tap. `→` shows where it routes (the reporter never sees it).
⚠ = dangerous by default (urgent, due today, owner paged).

### 3.1 FIX SOMETHING (Broken) — 7 areas

**1. Sewing machine** → MACHINE MAINTENANCE · ask *Which machine / line*
- Needle breaking · Skipping stitches · Thread breaking · Not running / motor
  dead · Oil leaking · Strange noise · Thread trimmer not cutting · Pedal /
  sensor not responding
- Details: Stopped completely · Running with a fault · Happens sometimes · Started after a needle change

**2. Other production machines** → MACHINE MAINTENANCE
- Cutting machine / band knife · Fusing machine (temperature) · Steam iron
  (not heating / leaking) · Button / snap / rivet machine · Embroidery or
  printing machine · Thread-sucking / spot-cleaning gun · Needle detector
  not detecting ⚠ (buyer-compliance item: a broken needle can reach a garment)
- Details: Stopped · Wrong output · Leaking · Overheating ⚠

**3. Power & electrical** → ELECTRICAL
- No power in my area · Light not working · Fan not working · Socket /
  switch broken · Sparking / burning smell ⚠ · Exposed wire ⚠ · Generator
  problem · Machine tripping the breaker

**4. Water & toilets** → PLUMBING (toilets also HOUSEKEEPING)
- No water · Leak / pipe burst · Toilet blocked · Tap / flush broken ·
  Drinking water / RO not working · Washroom needs cleaning

**5. Building, doors & furniture** → CARPENTRY / CIVIL
- Chair / stool broken · Work table broken · Rack / shelf loose ⚠ · Door /
  lock / window · Roof leaking · Floor broken or slippery ⚠

**6. Fire & safety** → ELECTRICAL / safety officer (unit head fallback)
- Gas smell / smoke ⚠ · Fire extinguisher missing or expired · Emergency
  exit blocked or locked ⚠ · Fire alarm not working ⚠ · First-aid box empty ·
  Machine guard missing ⚠

**7. Cooling, cleaning & canteen** → AC & REFRIGERATION / HOUSEKEEPING
- AC not cooling · Too hot / no ventilation · Exhaust fan not working ·
  Area needs cleaning · Pests (rats, insects) · Canteen equipment broken

Steam boiler and air compressor are inside area 2 for a maintenance team; if
the unit has a boiler operator, "Boiler / steam pressure ⚠" and "Compressor —
low air" are two more rows there.

### 3.2 IT HELP — 6 areas (replaces the 10 visible IT categories)

**1. Computer** → HW: Won't switch on · Very slow / hangs · No display ·
Keyboard / mouse · UPS beeping / no backup
**2. Printer & scanner** → PRN: Not printing · Paper jam · Toner / ink low ·
Scanner not working · Barcode / label printer not printing
**3. Network & internet** → NET: No internet · Wi-Fi won't connect · Very
slow · Shared folder / drive not opening
**4. Raagam ERP** → ERP / PRM: Shows an error · Can't save · Report or figures
look wrong · Need access to a screen · Forgot password / locked out
**5. Email, phone & attendance** → ACC (+ two new categories BIO, CCTV):
Email not working · New email ID · Mobile / SIM problem · Biometric not
punching · CCTV camera down
**6. New setup / move** → DEV / MOV / SRV: New computer or laptop · Install
software · New joiner setup · Move my computer · Server / storage request

Details for every IT row: Since today · Since some days · Only on my computer
· Whole section affected. Effect on work stays one question (Can't work /
With difficulty / Just a request) — it is what sets the priority.

### 3.3 BUY SOMETHING — 6 areas (indirect purchases only)

Order materials (fabric, trims, labels, packing for an order) are **not**
here: they come from the BOM through Purchase ▸ Requirement PO. This lane is
for what the floor and office use.

**1. Production consumables** — Machine needles · Machine oil · Machine spare
parts · Scissors / thread clippers · Chalk / markers · Pins / tags gun
**2. Safety & PPE** — Metal-mesh gloves (cutting) · Masks · Ear plugs ·
First-aid items · Fire extinguisher refill
**3. Tools & maintenance** — Electrical items (bulbs, cable) · Plumbing parts
· Tools · Paint / civil material
**4. Office & stationery** — Paper · Pens / files · Printer toner · Registers
**5. Housekeeping & canteen** — Cleaning supplies · Drinking-water cans ·
Canteen items · Toilet supplies
**6. IT equipment** — Mouse / keyboard · Cable / charger · Headset · (a
computer → routed to IT ▸ New setup instead)

Beat 4 for Buy = **How many** (1 · 5 · 10 · 50 · other) and **Needed by**
(Today · This week · This month). Beat 5 = **Why** (Ran out · Broken
replacement · New joiner · New work).

### 3.4 RAISE A CONCERN (Complaint) — 5 areas

**1. Pay & attendance** → PAY: Salary short / not credited · Overtime not
paid · Wrong deduction · Attendance / punch missing · Leave wrongly marked
**2. Behaviour** → HAR (sensitive, committee only): Shouting / abusive words
· Threats or bullying · Sexual harassment (goes to the Internal Committee
under the POSH Act) · Physical contact / violence
**3. Fair treatment** → DIS (sensitive): Unfair work allotment · Denied
leave or benefit unfairly · Discrimination (gender, caste, religion, region,
age)
**4. Working conditions** → SAF / FAC: Forced or excess overtime · Not
allowed toilet / water breaks · Unsafe practice · Canteen food · Transport /
bus · Crèche / rest room
**5. Something else** → GEN

Why this list: garment buyers' social-compliance audits (amfori BSCI, WRAP,
Sedex/SMETA) check that workers have a working, anonymous grievance channel
covering wages, hours, harassment and safety — this lane is that channel, so
its words are the audit's words.

---

## 4. Data model (one catalog, admin-editable)

Two shared tables (master data, not per unit — the same factory words
everywhere), mapped to the per-unit routing BY CODE (the 0749 rule):

- **rh_catalog_areas** `(id, lane 'fix'|'it'|'buy'|'concern', code, label,
  icon, sort, inactive)`
- **rh_catalog_items** `(id, area_id, code, label (= the subject), synonyms
  text[] (search), details text[] (the "what happened" chips), dangerous bool,
  trade_code, sd_category_code, complaint_category_code, ask_where bool,
  ask_qty bool, sort, inactive, used_count)`
- Tickets gain `catalog_item_id` (null for "Something else"), so reporting
  can count **real problems** ("Needle breaking: 41 this month, line 3 = 18")
  instead of free text — the payoff for the factory.
- **Buy** creates `rh_tickets kind = 'requirement'` (REQ-2026-000123 — the
  kind and prefix already exist since 0739), routed to Stores / the
  department head, who converts it to an indent. Today Buy only links to
  Indents, which most workers cannot open.
- Administration ▸ **Problem Catalog**: areas and items, Active first,
  drag order, item usage shown. Seeded with §3.

The three old lists stay (they are the routing), but are no longer shown to
reporters. IT categories collapse from 10 visible to 6 areas.

---

## 5. Screens

- **One chat component** (`AssistChat`) replaces ReportChat + the three lane
  chats; lane-specific beats are small step renderers inside it. Same
  Raagam Assist look (assist.tsx), same desktop two-column / phone
  one-column layout.
- **The bottom bar is the whole input**: lane cards → area chips → problem
  cards → detail chips → lane extra → photo → Send. A search box sits at the
  foot of the first three beats.
- Review card unchanged in spirit: every line tappable to change.
- Kept as forms: QR sticker (`/r/<token>`), Log a Call (desk) — both gain
  the same catalog picker in place of typed subject.

---

## 6. Phases

1. Catalog tables + seed (§3) + `catalog_item_id` on tickets; Buy →
   requirement ticket (RPC `rh_submit_requirement`).
2. `AssistChat` (unified, tap-first) + search; retire the four separate chats.
3. Problem Catalog admin screen; most-used ordering.
4. Reporting: top problems per area / place / line (Analytics).

## 7. Decisions needed from you

1. **Buy creates a Requirement (REQ) ticket** that Stores / the department
   head turns into an indent — instead of only opening Indents. (Recommended:
   yes — most operators cannot raise indents.)
2. **The catalog in §3** — add, remove or rename rows. Unit-specific items
   (e.g. a washing plant, embroidery unit, dormitory) can be added per your
   factory.
3. **Emergency line** shown before ⚠ gas / fire / shock items — the number or
   person to call (placeholder until given).
4. **Free text**: only "Something else" + optional "Add a note" (recommended),
   or also allow typing first as today.

---

## 8. As built — lead (2026-10-26)

Decisions taken on "okay go": §7.1 yes (Buy → REQ ticket to Stores), §7.2 the
catalog as listed, §7.3 `rh_unit_settings.emergency_contact` (blank until set;
the chat then says "call your supervisor and the first-aider"), §7.4 typing
only through "Something else" and "Add a note".

- **0751 applied** (verified from the catalog): 24 areas, 123 items (Fix 49 ·
  IT 29 · Buy 26 · Concern 19), `catalog_item_id` + requirement columns on
  `rh_tickets`, requirement statuses per kind, `requirement_owner_id`,
  `emergency_contact`, BIO + CCTV IT categories in every unit,
  `resolve.rq_update` seeded. Applied in parts (execute_sql, then
  `apply_migration` for the last seed) after large calls failed in transit;
  the repo file is the whole migration. `rh_assist_catalog()` was re-run once
  more to add `anonymous_ok` / `sensitive` (in the file).
- **Wrappers, not re-created bodies**: `rh_assist_broken / _service /
  _complaint` call the existing submits unchanged and stamp the item;
  `rh_assist_requirement` is new. Requirement alerts use a separate trigger
  (`rh_rq_outbox`); `rh_actions_of` re-created from its 0750 body + the
  requirement branch.
- `scripts/resolve-assist-smoke-test.sql`: 15 checks, **0 FAIL**.
- **One chat**: `components/resolve/chat/assist-chat.tsx` (`AssistChat`),
  `assist-icons.ts` (icon map + catalog search), `assist.tsx` (look; lanes
  Fix something · IT help · Buy something · Raise a concern). Steps are
  DERIVED (`nextStep`): Change on the review clears one answer and the chat
  walks back to it. IT keeps the self-help article step.
- Server: `lib/resolve/assist-types.ts`, `assist-service.ts`
  (`getAssistCatalog`, `getEmergencyContact`, `loadAssistChat`),
  `assist-actions.ts` (`submitAssist`; `decideRequirement`,
  `fulfilRequirement`, `withdrawRequirement`).
- Pages: `/resolve/report` and `/resolve/report/{service,complaint,broken}`
  render `AssistChat` (the last three start in their lane);
  `/resolve/report/broken?place=` and the QR door keep the form.
- **Removed** (created the same day, never committed): the four earlier chats
  (`report-chat`, `broken-chat`, `complaint-chat`, `service-chat`) and
  `guess-route.ts` / `guess-category.ts`.
- **Working folder**: at 12:12 another session stashed this work and switched
  `D:\Github\raagam` to `sample`. On the user's choice the work continues in
  the worktree `D:\Github\raagam-resolve` (branch `purchase`); stash@{0} was
  APPLIED there (kept as a backup). Its `node_modules` is a junction to the
  main folder's — never delete that folder recursively.

## 8. As built — assist-handler (2026-10-26)

The HANDLER side of Buy and the catalog admin, on 0751 as applied.

- **Requirement on the ticket page** — `app/(app)/resolve/tickets/[id]/page.tsx`
  branches `kind = 'requirement'` to `components/resolve/ticket/requirement-ticket-detail.tsx`:
  REQ ref, status (`RQ_STATUS_LABEL`: Pending / Approved / Rejected / Given /
  Withdrawn), item, qty, needed by, why, description, asked by (staff only),
  handler + owner reason, decided by, the decision note (`rq_decided_note`),
  the given note (`resolution_message`), notes, history, Live badge. The panel
  (`requirement-ticket-actions.tsx`) draws ONLY `rh_ticket_actions`: Approve
  (sheet, optional note), Reject (sheet, reason required), Mark as given (sheet,
  optional note), Withdraw (confirm), Add note. One filled button — Approve
  while Pending, Mark as given once Approved (never both). Broken / complaint /
  service rendering is untouched. A staff viewer's Back goes to Requirements.
- **Requirements queue** — `/resolve/requirements` (`components/resolve/work/requirements-screen.tsx`,
  `listRequirements()` in `lib/resolve/service.ts`): the current unit's REQ
  tickets RLS shows, tabs Pending · Approved · Done (rejected / given /
  withdrawn, 30 days) with counts; Ref, Item, Qty, Needed By, Why, Created
  Date, Created User, Status; live on the unit. **Created User IS "Asked by"**
  (the request is created as the person asking), so there is no second column
  for it. **Read-only on purpose**: who may decide is `rh__rq_actions`'
  answer, which only the ticket page has — a row icon would have to guess.
  Registered under Resolve Hub ▸ Work.
- **Problem Catalog** — `/resolve/setup/problem-catalog`
  (`components/resolve/admin/problem-catalog-screen.tsx`; reads
  `lib/resolve/catalog-service.ts`, writes `lib/resolve/catalog-actions.ts`,
  shapes `lib/resolve/catalog-types.ts`). Lane tabs Fix · IT · Buy · Concern,
  a Problems | Areas switch, each a `SimpleMasterScreen` (sheet editor, Active
  first, Created columns, live duplicate + near-miss, delete = switch off).
  Problem: Area, Problem (CAPITALS), Code (blank = made from the area code and
  the words, locked once saved), Search Words, What Happened (comma-separated;
  blank = the area's chips), the lane's routing code — Trade (`rh_trades`), IT
  Category (current unit's `rh_sd_categories`), Complaint Category (current
  unit's `rh_complaint_categories`), none for Buy — Dangerous (Fix / IT only),
  Sort; Used read-only. Area: name, code, icon (the chat's own icon names),
  What Happened, Sort. The action blanks the routing columns that do not belong
  to the item's lane. Words are saved in CAPITALS (the schema's rule), so an
  edited area / chip reads in capitals beside the mixed-case seed until those
  are re-saved. Registered under Resolve Hub ▸ Administration.
- **Unit Settings** — a "Raagam Assist" card: Stores / Requirement Owner
  (person) and Emergency Contact (text, CAPITALS); `unitSettingsSchema` +
  `getUnitSettings` carry both, the existing upsert writes them.
- **Alerts** — `resolve.rq_update` declared (`mandatory false, push true,
  fallbackToAdmins false`, matching the 0751 seed). Wording in
  `lib/resolve/messages.ts`: a new request's `ticket_routed` = "New request
  REQ-… / REQ-…: MACHINE OIL ×5, needed this week"; `rq_update` = approved /
  rejected ("Reason: …") / given. The outbox now reads `rq_qty, rq_needed_by`
  for the wording; an unreadable ticket still words as a sensitive complaint.
- **Tones** — `requirementStatusTone` in `lib/resolve/sla.ts`, the named
  override `{ open: "warning" }` (Pending waits on Stores); approved /
  fulfilled / rejected / withdrawn read the shared table unchanged, so
  `lib/ui/status-tone.ts` needed no edit. Vectors in `check:resolve`.
- **My Reports** — lists `kind in (broken, requirement)`; a request carries a
  "Request" pill, its own status words and tone, and the Status filter offers
  Approved / Rejected / Given once a request is listed.
- **Types** — `TicketStatus` gains `RequirementStatus`, `TICKET_ACTIONS` the
  four `rq_*` actions, `Ticket` the `rq_*` / `catalog_item_id` columns,
  `UnitSettings` the two new fields; the timeline words approved / rejected /
  given.

Checks, run in the `purchase` worktree: tsc clean; eslint clean on every file
above; check:hooks, check:nav, check:button-shape, check:grid-budget,
check:listing-width, check:active-first, check:status-tone,
check:notification-events (39 events), check:resolve (401 assertions),
check:screen-catalog all ok; check:nav-paths fails only on its 4 pre-existing
purchase / users sentences.

Not done: no browser look (no signed-in session in the extension); the
ticket page's "Reported" verb for `created` is shared and reads the same on a
request.
