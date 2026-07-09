# Master Data — Open Questions for the Client

Questions the build team could not resolve from the legacy screenshots alone. Each
needs someone who knows the **legacy RP Software system** (or the business rule) to
answer. Where we made a provisional choice, it's noted so it can be confirmed or corrected.

> Status legend: 🟡 provisional (a guess is in place, confirm) · 🔴 blocked (left out until answered)

---

## Material master

1. **Type dropdown — what are all the options?** 🟡
   Legacy "Type" is a fixed dropdown. We could only confirm **"Production"** (from the Garments form). *What is the full list of Type values?* And: **is the Type list the same for every Item Class, or different per class** (e.g. does Yarn's Type list differ from Garments')?

2. **HSN Code — master BUILT** ✅ (confirm model)
   Confirmed HSN is a legacy picker (Add/Modify) on Material/Process/Commodity. **Built** as `config_lookups` kind `hsn_code` (code = HSN number, name = description); `items.hsn_id` FK added (0231); the Material HSN field is now a `LookupPicker` with inline **Add + Modify**. *Only open question: is a simple code+description list enough, or should HSN carry more (default GST rate, chapter grouping)?* Other HSN fields (Process, Commodity, Category) still point at the old text column — roll them onto `hsn_id`/the picker next.

3. **Shade — picked from a master or typed?** 🟡
   Legacy shows a special picker (⚙) on the Shade field. We made it free text. *Is there a Shade / colour master to pick from?* (This applies to the **Shade field** on Details **and** the **Shade column in the Mixing grid**.)

4. **Mixing grid → "Description" column — what does its lookup point to?** 🟡
   In the legacy Mixing grid, the **Description** column has a lookup button (ⓘ), so it seems to pick from a master rather than free text. We made it free text. *Which master does the Mixing "Description" pick from?* (UomID in the same grid = Stock Units, confirmed.)

5. **The unlabeled dropdown under Category (Yarn / Fabric form) — what is it?** 🔴
   On the Fabric/Yarn Details form there is a dropdown directly **below Category with no label**. We left it out. *What field is that, and where do its options come from?*

6. **"User defined" (Yes/No) — what does it do?** 🟡
   Appears on the Button/Capital/General/Sewing/Packing and Garments forms. We store it as a Yes/No flag. *What behaviour does "User defined = Yes" trigger?*

7. **Budget Rate — the unit beside it.** 🟡
   Budget Rate is "amount / unit". We wired the unit to Stock Units (UOM). *Confirm the "per __" is a UOM (not something else).*

---

## Employee master (Associates) — BUILT (0243)

Built as a **new dedicated `employees` table**, kept separate from the lean payroll
`staff` table (0013, salary/ESI/PF only). Every ⓘ field lists stored data:
**Category** → `config_lookups` kind `employee_category` (new, Add/Modify), **Department** →
kind `department` (reused, Add/Modify), **Designation** → kind `designation` (reused), **Team** →
kind `team` (new, Add/Modify), **Location** → the `locations` GST-entity master (select-only —
System-owned), **Manager** → self-reference to `employees` (select-only). Full field set covered
(ID, Name, S/O relation + guardian, DOB + auto Age, Permanent/Correspondence addresses with "Same
as Permanent", E-Mail, Qualification, Blood Group, Marital Status, Sex, Nationality, Religion).

Open items to confirm from legacy:
- **E. Category / Team lists** 🟡 — backed as free Code+Name `config_lookups` (Add/Modify inline).
  *Are Employee Category and Team fixed legacy lists we should pre-seed, or free lists?*
- **F. Location** 🟡 — wired to the existing GST-entity `locations` master (HO / Unit 2). *Confirm
  employee "Location" means the working unit/office (not a separate branch/city list).*
- **G. Staff vs Employee** 🟡 — payroll `staff` and this HR `employees` master are separate today.
  *Should they be linked (one employee ↔ one payroll staff record) later?*
- **H. Photo** 🔴 — the legacy Photo box is **not** built (image upload deferred; a `photo_url`
  column is reserved). *Confirm photo upload is wanted before wiring Supabase Storage.*

## Consignee master (Associates) — ALL THREE TABS BUILT (0245 + 0248)

Built as `consignees` + `consignee_contacts` (+ `consignee_markings`, `consignee_notifies`), a clone
of Notify 0239 + `also_notify` Yes/No + `customer_id` → `customers` (select-only **CustomerPicker**).
- **Address** tab — address fields + Contact grid.
- **General** tab (0248) — same as Applicant General (Currency 1/2/3 → `currencies`, Ship Mode/Pay
  Mode fixed lists, Ship Type/Payment Terms → `config_lookups`, Bank → `banks`, A/c No.) **plus** a
  **Marking** child grid (S No + text) and a **Registration** block (TIN No. [3 boxes] · PAN · GST).
- **Notify** tab (0248) — a child grid of Notify-party references (→ `notifies` via select-only
  **NotifyPicker**; Country column is display-only, from the picked notify).

Open items to confirm:
- **J. Also Notify vs Notify tab** 🟡 — *does `also_notify=Yes` gate/require the Notify tab grid, or
  are they independent?* (Built as independent: the grid is always editable.)
- **K. TIN No. three boxes** 🟡 — modelled as `tin_no` / `tin_no_2` (small) / `tin_no_3`. *Confirm
  what the 2nd/3rd boxes mean (state code? CST no.?).*

## Account Head master (Associates) — BUILT (0250)

New dedicated `account_heads` table (Short Name · Blocked · Name · Group Under [**If
Debits** ⓘ · **If Credits** ⓘ] · **Cost head** ⓘ). Kept distinct from the modern
double-entry `gl_accounts` ledger (0015) — it's part of the legacy chart-of-accounts set
alongside `account_groups` (0244). Icon fields wired: If Debits / If Credits → the
`account_groups` master via the shared `AccountGroupPicker`; Cost head → the finance
`cost_heads` master (0119) via a new select-only `CostHeadPicker`.

- **K. Legacy COA vs gl_accounts** 🟡 — `account_groups` + `account_heads` reproduce the
  legacy chart of accounts as their own tables, separate from `gl_accounts`/`journal_entries`.
  *Confirm they should stay separate, or be reconciled with the modern finance ledger later.*
- **L. Cost head Add/Modify** 🟡 — the Cost head picker is **select-only** (cost heads are
  managed in Finance). *Confirm inline Add isn't needed here.*

## Currency master (Currencies) — BUILT

Built as a flat master screen over the existing `currencies` table (PK = `code`;
`code` · `name` · `symbol`) — the same table the app-wide **CurrencyPicker** (Currency
1/2/3 fields on Applicant/Consignee/Customer) already adds to, so a currency created
here appears everywhere. No `is_draft`/`blocked` columns (a shared reference list, not a
workflow record). Delete surfaces any FK-reference violation to the user.

Open items to confirm from legacy:
- **N. Currency field set** 🟡 — the legacy **Currency form** screenshot wasn't captured;
  built with the three columns the app already uses (Code / Name / Symbol). *Does the
  legacy Currency master carry more (decimal places, ISO number, per-currency
  rounding, a "base currency" flag)?* If so, extend the table + screen.
- **O. Exchange-rate registers — Quotes/Orders BUILT (0253)** 🟡 — legacy "Exchange rate
  (Quotes / Orders)" is a master-detail: header (Entry No auto · Date · **For** · Effective
  From) + a grid of **Currency** (→ `currencies`, via `CurrencyPicker`) → **Ex-Rate**
  (numeric, 4 dp). Built as one table pair (`exchange_rate_entries` + `exchange_rate_lines`)
  discriminated by a `register` column. **All three registers wired** to one
  `ExchangeRateMasterScreen`; the entry's **period** varies by register (`REGISTER_META.period`):
  - **Quotes / Orders** ✅ (screenshot) — period = a single **Effective From** date;
    `For` = Quotes / Orders; rate col "Ex-Rate (Exports)".
  - **Customs** ✅ (screenshot) — period = **Month + Year** (`rate_month` 1–12 + `rate_year`),
    *no* Effective From; `For` = `Customs(Export)` confirmed (added `Customs(Import)` as the
    likely sibling — confirm); rate col "Ex-Rate (Exports)".
  - **Imports** ✅ (screenshot) — period = a single **Effective From** date (like Quotes/Orders,
    *not* Month+Year); `For` = `Imports` (single fixed value, disabled in legacy); rate col
    "Ex-Rate (Imports)".

  Entry No numbers **per register** (each starts at 1). Kept distinct from Finance's daily
  `exchange_rates` (0115). *Open:* confirm the Customs **For** second value (`Customs(Import)`?) —
  everything else is confirmed from screenshots.

## TCS Assign to Customers (Associates) — BUILT (no migration)

A bulk-toggle grid over the existing `customers` master — lists every customer with a per-row
**TCS** Yes/No dropdown that writes `customers.tcs_applicable` (the column already existed from the
Customer build). Read-only columns: Customer · Customer Name · Customer ID (`doc_id`) · Country ID
(country code). Edit-only (no Add/Delete); one bulk **Save**.

- **P. "Update view" column** 🟡 — the legacy grid has a per-row "Update view" cell; we folded it
  into a single bulk **Save** (collect all row changes, one write). *Confirm no per-row apply is needed.*

## Department master (HR) — BUILT (0259)

The legacy HR **Department** form is a **rich dedicated master**, not the simple `department`
config_lookups kind that the Employee / Consignee / Courier pickers reference. Built as
`departments` (Short Name · Name · Doc Prefix · Warehouse · Blocked · **Item-Class checklist**
stored `text[]`) + a `department_locations` child grid (**Location** → `locations` via the
select-only `LocationPicker` · **All Divisions** flag).

Open items to confirm from legacy:
- **P. Rich `departments` vs `department` lookup kind** 🟡 — the pickers on Employee/Consignee/
  Courier still point at `config_lookups` kind `department` (simple Code+Name). *Should those
  fields re-point at this rich `departments` master, or do the two "departments" coexist
  (an org unit vs. a contact's department)?*
- **Q. "Divisions" detail button** 🔴 — each Location row has an **All Divisions** checkbox
  plus a trailing **detail button** (to pick specific divisions when All Divisions is off).
  Built the checkbox; the per-division picker is **not** built (needs its own screenshot —
  what is a "Division", and which master does it list?).
- **R. Item-Class list** 🟡 — used the same 6 values as the legacy Stock Unit form
  (Yarn/Fabric/Sewing/Packing/Garments/General). The right-side box showed a scrollbar —
  *are there more classes (the 8-value Item Class master), or exactly these six?*

## Applicant master (Associates)

A. **Two Country fields — same or different?** 🟡
   The Applicant form shows a **Country** in the header *and* a **Country** on the Address tab. We
   modelled them as **two separate values** (party country vs address country). *Confirm they are
   distinct — or should they always be the same one country?*

B. **City / State — flat lists, or linked?** 🟡
   City and State are green ⊕ pickers. We built each as a simple **Code + Name** list (legacy showed
   e.g. `45133 ESSEN`). *Do they need linkage (State → Country, City → State), or is a flat list fine?*

C. **General tab — BUILT** ✅ (confirm backing choices)
   The **General** tab is now wired (0241): **Currency 1/2/3** → `currencies` (blue ⓘ picker with
   Add/Modify), **Ship Mode** → fixed list `AIR/ROAD/SEA/SEA/AIR`, **Ship Type** → new reusable
   Incoterms master (`config_lookups` kind `ship_type`, seeded EXW…DDP + DDU/DAF), **Pay Mode** →
   fixed list `CAD/CASH/CHEQUE/DA/DD/DP/LC/OTH`, **Payment Terms** → `config_lookups` kind
   `payment_term` (ⓘ picker), **Bank** → `banks` (blue ⓘ picker, header-only Add/Modify),
   **A/c No.** → free text. *Open: (i) is the full legacy **Ship Type** list exactly Incoterms, or
   does it include extra codes (e.g. CAD appeared under Ship Type in the screenshot)? (ii) confirm
   **Ship Mode**/**Pay Mode** are truly closed dropdowns (no Add), and their full value lists.*

E. **Ship Type reuse — follow-up.** 🟡
   Per the brief ("if we built this table wire it for all applicable fields"), Ship Type is now a
   reusable master (`config_lookups` kind `ship_type`). Today the **logistics/sales** screens store
   `incoterm` as ad-hoc hardcoded strings (`['FOB','CIF','CFR','EXW','DDP','DAP']` / free text in
   Shipment + Quotation). Those fields should be re-pointed at this master — left as a follow-up
   because those files are owned by the other build lane (Commercial).

F. **Payment Term master vs the field.** 🟡
   The Applicant **Payment Terms** field is backed by `config_lookups` kind `payment_term`. The
   Associates ▸ **Payment Term** child (still a `todo`) can render this same kind when built (like the
   other lightweight lists), rather than needing its own table.

D. **"Internal Department" vs "Department".** 🟡
   The Contact grid has both a **Department** and an **Internal Department** picker. We backed each with
   its own list. *Confirm they are genuinely two different masters (not the same list).*

## Customer master (Associates) — tabs (0247) — BUILT

The four remaining Customer tabs are wired (Agents · Customer Supplied Items · Customer
Nominated Vendors · CustomerGeneral). Backing choices to confirm:

I. **Agent & Agent Type** 🟡 — the Agents grid's **Agent Type** and **Agent** ⓘ pickers are
   backed by new `config_lookups` kinds (`agent_type`, `agent`) with inline Add/Modify (simple
   Code+Name lists). *Is "Agent" actually a richer party master (address / commission / contact),
   deserving its own table + form? If so we upgrade `agent` from a config-list to a dedicated
   master and re-point the picker.*

J. **Supplied-Item "Category"** 🟡 — both Sewing Accessories and Packaging Accessories grids pick
   **Category** from the existing `material_category` ("Categories") master. *Confirm it's the same
   category master used in Materials (not a customer-specific list).*

K. **Nominated / Recommended Vendor** 🟡 — both grids pick **Vendor** from the Purchase `vendors`
   master (select-only, no inline Add — vendors are created on their own screen). *Confirm the
   nominated/recommended vendor list is the same vendor master.*

L. **CustomerGeneral dropdowns** 🟡 — **Ship Mode** and **Pay Mode** reuse the Applicant fixed
   lists (`AIR/ROAD/SEA/SEA/AIR` and `CAD/CASH/CHEQUE/DA/DD/DP/LC/OTH`); **Ship Type** is a Select
   over the `ship_type` Incoterms master (legacy showed a ▼ dropdown). *Confirm the exact Customer
   Ship Mode / Pay Mode value lists, and that Ship Type = the Incoterms master.*

M. **Packing List Format — "Columns" button** 🔴 — the format itself is a `config_lookups` kind
   `packing_list_format` (Add/Modify); **Commercial Invoice Format** = kind
   `commercial_invoice_format`. The **Columns** button (per-format column configuration) is **not**
   built — rendered as a disabled placeholder. *What does the Columns dialog configure (a column
   layout per packing-list format)? Needs its own screenshot before building.*

## Designation master (HR) — BUILT (0260)

New dedicated `designations` table (Designation name · **For** [Staff / Worker / Staff-Worker
enum] · Blocked + is_draft) — same convention as Department 0259: kept **distinct** from the
simple `designation` config_lookups kind that the Applicant/Customer/Notify/Consignee contact-grid
pickers reference.

- **N. Two "designations"** 🟡 — the contact-grid **Designation** pickers still point at the
  `designation` config_lookups kind, not this rich `designations` master. *Should those pickers
  re-point at this table, or do the two designation lists coexist (HR designations vs contact-role
  labels)?* Same open question as Department (item near line 142).

## Employee Category master (HR) — BUILT (0262)

New dedicated `employee_categories` table (Short Name · Name · **For** [Staff / Worker /
Staff-Worker enum] · Blocked + is_draft) — the twin of Designation 0260 with an extra Short Name
column. Same convention: kept **distinct** from the `employee_category` config_lookups kind that
the **Employee master's** Category picker (`LookupDialogPicker`) still references.

- **O. Two "employee categories"** 🟡 — the Employee form's **Category** picker still points at the
  `employee_category` config_lookups kind, not this rich `employee_categories` master. *Should the
  Employee picker re-point at this table, or do the two lists coexist?* Same open question as
  Department / Designation. (Re-pointing was deferred to stay consistent with those two — doing it
  for Employee Category alone would be more inconsistent, not less.)

## HSN detail master (GST) — BUILT (0263)

New dedicated `hsn_details` table (Item Class → config_lookups `item_class` · **For** [Materials /
Process] · Description · HSN Code · Blocked + is_draft). Richer than the simple `hsn_code`
config_lookups kind (0231) that the Material/Process/Commodity HSN pickers use.

- **O. Two HSN stores** 🟡 — the Material/Process/Commodity HSN fields still pick from the
  `hsn_code` config_lookups kind (0231, code=HSN number, name=description), not this richer
  `hsn_details` master (which adds Item Class + For). *Should those pickers re-point at
  `hsn_details`, or do the two coexist (a flat HSN code list vs the per-item-class HSN master)?*
  The four GST "Assign" screens (HSN Assign to Material/Process) are likely where `hsn_details`
  gets applied to records — confirm when those screenshots arrive.

## Document No format master (System) — BUILT (0264)

3-level nested master-detail: header (Entry No auto · Date · **Track** ⓘ) → **Menu** rows
(Menu ⓘ · Location wise · Starting SlNo · Sample DocNo) → per-menu **segment** lines
(Value Type ⓘ · Value · Seperator · No Of Digits · **Value From** ▼ · Ref. only) that compose
the document number. Track / Menu / Value Type / Value From are all `config_lookups` kinds
(`doc_track` / `doc_menu` / `doc_value_type` / `doc_value_from`) with Add/Modify.

- **P. "Value From" — picker vs fixed enum** 🟡 — legacy shows Value From as a **▼ dropdown**
  (probably a fixed system list, e.g. Manual / Financial Year / Location / Document Date). We backed
  it with a `doc_value_from` config_lookups kind (editable, Add/Modify) since the exact values
  weren't visible. *What are the real Value From options — a fixed system enum, or a user list?*
- **Q. "Menu" list source** 🟡 — the Menu picker (`doc_menu` kind) identifies which document /
  screen the numbering applies to. *Is "Menu" the app's actual menu/screen registry (a system list
  we should seed from the real menu tree), or a free list the user maintains?*
- **R. "Sample DocNo"** 🟡 — modelled as free text; in legacy it looks **computed** from the
  segments (a live preview). *Should it auto-generate from the segment definition (prefix + digits +
  separator …) rather than being typed?*

## Earlier masters (also need confirmation)

8. **Levy — full "Type" list.** 🟡
   We captured only **GST Intra State** and **GST Inter State** (which drive CGST+SGST vs IGST). *Are there more Levy Types (Import duty, Cess-only, Exempt, …)?*

9. **Stock Unit — the "Item Classes" list.** 🟡
   The Stock Unit form shows a 6-item Item-Class checklist (Yarn, Fabric, Sewing, Packing, Garments, General). This differs from the separate 8-value **Item Class master** (adds Button, Capital Goods, Consumables; longer names). *Should Stock Unit's classes be the same master as everywhere else, or is this shorter list intentional?*

---

## Build backlog (internal — from the "pickers need Add/Modify" review)

- Every legacy ⓘ picker = a list with **Add + Modify**. Reusable `LookupPicker` now does both for config-list pickers; **done** on Material ▸ Count/Purity (Item Class has Add).
- **Roll out** `LookupPicker` to the other config-list pickers across screens (Commodity/Category/Process ▸ Item Class & Commodity, etc.).
- **Rich-master pickers** (Category, Cost Head, Stock-Unit/UOM): need a mini add/edit form each (Category needs Item Class + Levy + Commodity) — do per-picker.
- **HSN master**: build it (see Q2), then HSN fields use `LookupPicker`.

## Notes (internal — not client questions)

- Category / Count / Purity / all UOM pickers / Cost Head are **wired and confirmed**.
- Empty dropdowns in the Material form are a **data-entry** matter (the source masters have no rows yet), not a wiring problem — see setup order in the session notes.
