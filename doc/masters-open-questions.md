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

---

## Garment Orders ▸ Style master (`/orders/styles`, migration 0124)

Built the full legacy Style screen (header + General + Coordinates/Components/Sizes grids). Every ⓘ/⊕ field is a picker. Open items:

1. **Fixed dropdown option lists** 🟡 — we could only read one value each from the screenshot. Provisional lists in `lib/orders/styles/types.ts`; *please confirm the full options for*: **For** (`Garments`…), **Season** (`Summer`…), **Tech pack** (`Not Required`…), component **Type** (`Circular`…), **Receipt Mode** (`By Mail`…).
2. **New config-list pickers start empty** 🟡 — Style Category, Coordinate, Component (kind `style_component`, kept separate from the Material `component` list), Structure, Trims Category, Size are new `config_lookups` kinds with **no rows yet**. Add via each picker's inline **Add**, or share the legacy picker contents to seed them. (Data-entry, not a wiring gap.)
3. **Customer → `customers` master** 🟡 — bound to the Associates *Customers* master (CustomerPicker), so **Contact** reads that customer's `customer_contacts`. Not linked to `sales_orders.buyer_id` (buyers). Confirm this is the intended "Customer".
4. **Approved Sample No** 🔴 — the `samples` table has **no human sample-number** (only id + type + status). We list `status='approved'` samples labelled by type + date. *Needs the legacy Sample screen to model a real sample number.*
5. **"Modification History" / "Errors Found" buttons** 🟡 — footer buttons on the legacy form; not built (audit history is captured via `writeAudit`). Confirm whether a per-record history/validation panel is required here.

## Garment Orders ▸ Define Garment Processes selector (`/orders/garment-processes`)

Built the legacy "Define Garment Processes for accepted orders — By SC No" **selector** (Step 1). It
lists accepted orders (`status in confirmed/in_production`) and routes each to the existing per-order
process editor at `/orders/[orderId]/processes`. The `SC No`/`Order No` filter is a searchable
`RecordPicker` dialog (wiring-skill core rule). Open items:

1. **SC No mapped to `order_number`** 🟡 — `sales_orders` has no Sales-Confirmation number
   (`HO/RE/2526/xxxx` per `doc/deep capture.md` L1233) nor `sc_date`/`delivery_date` columns. The grid
   maps SC No/Order No → `order_number`, SC/Order Dt → `created_at`, Delivery Dt → `ship_date`,
   Customer → `buyers.name`. If real SC numbers get captured later, add the column then and the grid
   shows it — no rework of this screen.
2. **Tag All / None / Toggle + "Selected" multi-select** 🟡 — intentionally deferred. Defining
   processes is per-order (the editor handles one order), so bulk row-tagging maps to no real
   operation; the faithful action is click-a-row → open that order's editor.
3. **Column / Operator / Value criteria builder** 🟡 — the legacy advanced-filter grid is out of
   scope (net-new component, rarely used). The Order-picker + Status + Find/Clear filter bar covers
   real use.

## Garment Orders ▸ Prepare Advised Items selector (`/orders/advised-items`)

Reshaped the legacy "Prepare Advised Items — By SC No" screen into a **selector** (accepted-orders
grid, `status in confirmed/in_production`) + a per-order **editor** at `/orders/advised-items/[orderId]`
(replacing the previous flat all-orders list). Backing table `order_advised_items` (0032) + actions
were reused unchanged. The **Customer** and **SC No / Order No** filters are searchable `RecordPicker`
dialogs (wiring-skill core rule). Open items:

1. **SC No → `order_number`, CountryID → `buyers.country`** 🟡 — same mapping gap as the Garment
   Processes selector above; no SC-No/date columns exist on `sales_orders`.
2. **Item-entry form fields free-text** 🟡 — the two screenshots show only **Step 1 (the order
   selector)** and its result grid, *not* the item-entry form. So the editor keeps the existing
   free-text fields (Item description, Attribute, Qty, Unit, Suggested supplier, Remarks). If the
   legacy item form has picker-icon fields (e.g. Item master, Unit/UOM, Supplier/Vendor), wire them
   when that screenshot is available.
3. **Tag All / None / Toggle + Column/Operator/Value criteria builder** 🟡 — intentionally deferred
   (per-order prep → bulk tagging maps to nothing; advanced-filter grid is net-new). Find/Clear +
   the two pickers cover real use.

## Garment Orders ▸ Garment Order Amendment (`/orders/amendments`, migration 0126)

Built the legacy step-8 "Garment Order Amendment" screen (header + **10 sub-tabs**:
Style(s) · Color/Print Details · Combos · Prices · Pack type(s) · Quantities · Approval Qty ·
Country/Sizewise · **Logistic** · **Reason**). **Phased build — we have only the `Logistic`
tab screenshot.** Phase 1 built the header band + fully-wired **Logistic** + **Reason** tabs;
the other 8 tabs render a labelled "awaiting screenshot" placeholder (never dropped) and get
additive child tables (0127+) as each screenshot arrives. Tables: `garment_order_amendments`
(header) + `garment_order_amendment_charges` (Less/Add) + `garment_order_amendment_style_prices`.
Kept distinct from the lean `order_amendments`/`order_revisions` (0006); this screen records an
amendment and does **not** mutate the live `sales_orders`. Open items:

1. **SCNo auto-load scope** 🟡 — confirmed the SCNo picker loads the order. Phase 1 hydrates
   the fields the order already carries (Customer/buyer, Currency, Delivery date) from the picked
   `sales_orders` row. The per-tab grid hydration (Styles/Colours/Quantities from `so_line_items`)
   lands with each of those tabs — *confirm exactly which fields the legacy copies vs. leaves blank.*
2. **"Customer" = `buyers`** 🟡 — modelled the header Customer as the order's party (`buyer_id →
   buyers`), matching `sales_orders.buyer_id` so auto-load maps cleanly. *Confirm it is the buyer,
   not the Associates `customers` master.*
3. **"Merchand." = `profiles`** 🟡 — the Merchandiser picker lists app users (`profiles`), like
   `sales_orders.merchandiser_id`. *Confirm vs. an `employees`/`merchandising_teams` master.*
4. **Logistic "Contact" scoping** 🟡 — `buyers` have no contact master (only email/phone), so the
   Contact ⓘ lists **all** `customer_contacts` unscoped. *Which contacts should it scope to for a
   buyer-based order?*
5. **Logistic "Agent"** 🟡 — wired to `config_lookups` kind `agent` (shared with Customer ▸ Agents).
   *Is Agent a richer party master (address/commission) deserving its own table + re-pointed picker?*
6. **Less/Add "Mode" & "Unit" dropdowns** 🔴 — each charge row (Freight/Piece, Insurance/Piece,
   Bonus, Buyer/Agent Commission, Discount, Others 1/2, Add 1/2) has two ▼ (a calc "mode" and a
   "unit") whose option lists are **not legible** in the screenshot. Built as free-text inputs so the
   values are still captured; *share the option lists to convert them to `Select`/pickers.*
7. **Fixed dropdown lists** 🟡 — Initiated (`By Customer`…), Type (`Garment`…), Season, Ship Mode,
   Pay Mode, Received mode, Reason Type are provisional `as const` lists in
   `lib/orders/amendments/types.ts`. *Confirm the full legacy option sets.*
8. **"Modification History" / "Errors Found" buttons + Approval** 🟡 — footer buttons not built
   (audit captured via `writeAudit`). The separate step-11 "Approve Amendment" workflow is not yet
   linked to this record. *Confirm whether a per-record history/validation panel + approval flow is
   required here.*

## Garment Orders ▸ Material BOM Amendment (`/orders/material-bom-amendment`, migration 0265)

Built the legacy step-9 "Material BOM Amendment" screen — a master-detail amendment **document**:
header (Entry No = `MBA-0001` code · Date · **Customer** ⓘ · **SC No/Order** ⓘ · **A. No** · Remarks)
+ 3 tabs — **Items** (fully wired grid), **Processes** (Item grid), **Calculated Quantities**
(read-only, computed). New tables `material_bom_amendments` + `_items` + `_processes`, gated on
`orders`. Kept **distinct** from the Planning free-text approval log `bom_amendments` (0023), which is
untouched (still reachable at `/planning/bom-amendments`). Every ⓘ field is a picker: Customer →
`customers`, Order → accepted `sales_orders`, Category → `material_category`, Item → `items`, Attribute
→ `material_attribute`, Vendor → `vendors`, Purchase/Consumption/Alternate Uom → `uoms`. Open items:

1. **SC No / Order No → `order_number`** 🟡 — same mapping gap as the sibling selectors; no SC-No
   column on `sales_orders`. A. No = a per-order sequence auto-assigned on save.
2. **Type / Supply Type — provisional fixed dropdowns** 🟡 — no legacy option list captured. Placed as
   `MATERIAL_TYPE_OPTIONS` (Production/Sample/Trial) and `SUPPLY_TYPE_OPTIONS`
   (Local/Import/Nominated/Free Issue) in `types.ts`. *Share the real legacy option lists.*
3. **Combination — free text** 🟡 — no backing/spec for the "Combination" column; captured as text.
   *What master or rule does Combination reference?*
4. **Calculated Quantities formula unknown** 🔴 — the tab is a **read-only provisional projection**:
   Calc Qty = per-piece Qty × order qty; **Process** and **Size** columns are shown blank (no mapping
   captured). *Provide the real calculation (how Process/Size explode, loss %, MOQ rounding).*
5. **Items columns off the right edge** 🟡 — the screenshot's Item Details grid scrolls past MOQ;
   columns to the right of MOQ were not captured. Built the visible set (through MOQ + a Qty basis).
   *Share a wider screenshot to add the remaining columns.*
6. **Processes tab = just "Item"** 🟡 — the legacy Processes "Detail" grid shows only S No + Item ⓘ;
   modelled as `item_id → items`. *Confirm whether Process rows carry more (process name, sequence).*

## Garment Orders ▸ Approve Amendment (`/orders/approve-amendments`, migration 0129)

Built the legacy step-11 "Approve amendment" screen — an **approval queue** over the Garment Order
Amendment documents (`garment_order_amendments`, 0126/0128). 0129 adds `approval_status`
(pending/approved/rejected) + `approved_by` + `approved_at` + `approval_reason` to that header.
Grid columns mirror the legacy: SC No · SC Dt · Order No · Customer · Delivery Dt · Ship Type/Mode ·
Currency · Pay Mode · Order Qty · Amended Dt · Amendment No · **Approval Status** · Created User ·
Reason. Multi-select (Tag All) + per-row Approve/Reject; a reason is required to Reject, optional to
Approve. Only submitted (`is_draft = false`) amendments enter the queue. Open items:

1. **Approve records the decision only — it does NOT apply amended values to `sales_orders`** 🔴 —
   the amendment document has 30+ header fields + 10 child grids, many of which the order does not have
   (and vice-versa), so pushing them back requires a confirmed field-by-field mapping we don't have.
   *A future "apply approved amendment to order" step must consume these `approval_status='approved'`
   records once the amendment→order mapping is confirmed. Confirm what the legacy Approve does to the
   live order (nothing / applies changes / bumps a version).*
2. **SC Dt = `sales_order.ship_date`** 🟡 — the amendment has no separate SC-creation date; using the
   order's ship date. *Confirm the legacy "SC Dt" source if it matters.*
3. **"Details / Order details / Style details" collapsed into one "Details" link** 🟡 — all three legacy
   drill-in columns link to the existing amendment editor (`/orders/amendments`) rather than separate
   read-only pop-outs. **"Update view"** (a saved-layout feature) is not modelled.
4. **Scope = Garment Order Amendment only** 🟡 — Process Amendment (0127) and Material BOM Amendment
   (0265) have their own separate approval need, not covered here. *Confirm if step 11 should approve
   those too.*

## Packing List Advice (step 12, rebuilt to legacy — migration 0130)

The lean 0033 `packing_advices`/`_lines` model (one order per advice + a simple carton grid) was
extended additively to the legacy screen: header (Customer/Consignee/Warehouse + Carton numbering) +
a wide "Packing List" detail grid where **SC No is chosen per line**. `sales_order_id` (header) and
`description` (line) relaxed to nullable; legacy columns added. Open items:

1. **"Carton SlNo.By" dropdown option list** — only "Packing List" was legible; built provisional
   ["Packing List","Assortment","Manual"]. Confirm the real options.
2. **"Assort Type" dropdown option list** — the grid showed "Solid Pack - Solid..." (truncated); built
   provisional ["Solid Pack","Assorted Pack","Ratio Pack"]. Confirm.
3. **Warehouse Name = new config_lookups kind `warehouse`** — no warehouse master exists; the green add
   icon = inline-add config list + a free-text address field. Confirm intended backing (vs a richer
   warehouse master carrying its own address).
4. **SC No per-line has no auto-fill** — sales_orders carries no PO No / Customer Order No / Country
   columns, so those line fields are manual entry. Confirm whether they should derive from the order.
5. **"Assort" nested button** (deferred) — per-line Assort sub-screen rendered as a disabled
   placeholder; needs its own screenshot. Header Ctns / Qty are computed live as the sum of the line
   grid (read-only); Total Qty auto-calcs = Ctns x Qty/Ctn (editable override).

---

## Orders ▸ TA ▸ TA Activity (screenshot _13944, migration 0266)

Rebuilt `/orders/ta-masters` to match the legacy "TA Activity" form exactly: Short Name ·
Blocked · Name · Type (▼ picker) · Has Sub activities · Consider for Delivery Date. Open items:

1. **"Type" seed values are inferred** 🟡 — seeded `config_lookups` kind `ta_activity_type` with
   Approvals · Work Flow · Purchase · Processing · Garments · General (the legacy Time/Action panel
   groups). The real dropdown contents weren't captured. The picker has Add/Modify so the user can
   correct the list; *confirm the true legacy Type list.*
2. **"Blocked" = inverse of `is_active`** 🟡 — no separate `blocked` column; blocking sets
   `is_active = false`. Status pill shows Active/Blocked. *Confirm no other behaviour hangs off Blocked.*
3. **Legacy "Modification History" & "Errors Found" buttons not built** 🟡 — history is covered by the
   generic audit log elsewhere; "Errors Found" (a per-record validation report) is unmodelled.
4. **Retained columns `department` / `sequence` / `default_offset_days`** 🟢 — not on this form; kept in
   `ta_activities` for TA Plan / TA Department Assign to consume later. Additive only, no data dropped.

---

## Sales ▸ Marketing ▸ Create Opportunities — By Customer (`/sales/create`, screenshots _13734 / _1389)

Built the legacy bulk "Create opportunities — By Customer" screen: a customer grid
(Customer code · Customer Name · Country · Selected checkbox) with search + country filter,
Tag All / None / Toggle, and a "Create N opportunities" action that inserts one opportunity per
tagged customer. Provisional choices to confirm:

1. **"Customer" = sales `buyers`, not the `/masters` `customers` master** 🟡 — opportunities FK to
   `buyers` (`opportunities.buyer_id`), so the grid lists `buyers`. *Confirm the legacy "Create
   opportunities — By Customer" list is the same customer set as the sales buyer list (not the
   Associates customer master).*
2. **Title/season for bulk-created opportunities are inferred** 🟡 — the legacy grid has no title
   field, but our `opportunities.title` is required. We set `title = customer name`, `currency =
   buyer's currency`, `stage = enquiry`, and apply one optional shared **Season** input to all.
   *Confirm what the legacy screen puts in title/season on Apply.*
3. **Legacy Criteria Filter (Column / Operator / Value + Default/Refresh Filter) not built** 🟡 —
   v1 ships a simple search box + Country dropdown instead of the full criteria builder. *Confirm the
   simple filter is acceptable, or specify which columns/operators the criteria panel must support.*
4. **No duplicate guard** 🟡 — Apply always creates a new opportunity per tagged customer, even if
   that customer already has an open (non-won/lost) opportunity. *Confirm whether legacy skips
   customers that already have an active opportunity.*

---

## Garment Orders ▸ Garment Order Cancellation (enriched to legacy — migration 0131)

Enriched the 0122 `/orders/cancellations` screen to the legacy form: **Cancel No** (auto `GOC` code) ·
**Date** · **Customer** ⓘ · **SC No** ⓘ · **Order No** (text) · **Remarks**. 0131 adds `customer_id →
buyers` + `order_no text` and relaxes `reason` to nullable. SC No = `RecordPicker` over cancellable
`sales_orders` (auto-fills Customer from `buyer_id`); Customer = `RecordPicker` over `buyers`. Saving
still flips `sales_orders.status = 'cancelled'`. Open items:

1. **"Reason" dropped from the form** 🟡 — not a legacy field (Remarks is the note); the column is kept
   nullable for existing rows but no longer written. *Confirm Remarks fully replaces Reason.*
2. **Customer = `buyers`** 🟡 — the order's party, auto-filled from the SC No's `buyer_id` (matches the
   Order Amendment screen). *Confirm Customer here is the sales buyer, not the Associates customer master.*
3. **"Order No" = free text** 🔴 — `sales_orders` has no customer-PO column and SC No already =
   `order_number`, so Order No is a manual reference. *Confirm what legacy "Order No" is (customer PO?
   a second internal number?) and whether it should be a picker.*
4. **Create-only + list** 🟡 — the screen stays inline-create + list (matches the Completion screen);
   the legacy record navigation / edit-existing-cancellation is not built.
5. **"Modification History" / "Errors Found" footer buttons not built** 🟡 — greyed in the legacy shot;
   audit history is covered by the generic audit log; "Errors Found" (per-record validation report) is
   unmodelled. (Same stance as TA Activity / Packing List Advice above.)

---

## Garment Orders ▸ Garment Order Completion (enriched to legacy — migration 0132)

Enriched the 0123 `/orders/completions` screen to the legacy form (**identical layout to Cancellation**):
**Completion No** (auto `GCM` code) · **Date** · **Customer** ⓘ · **SC No** ⓘ · **Order No** (text) ·
**Remarks**. 0132 adds `customer_id → buyers` + `order_no text` (completion never had a Reason field).
SC No = `RecordPicker` over completable `sales_orders` (auto-fills Customer from `buyer_id`); Customer =
`RecordPicker` over `buyers`. Saving still flips `sales_orders.status = 'closed'` and derives
`completion_year` from the date. Same open items as Cancellation above:

1. **Customer = `buyers`** 🟡 — auto-filled from the SC No's `buyer_id`. *Confirm it's the sales buyer.*
2. **"Order No" = free text** 🔴 — no customer-PO column on `sales_orders`; captured as a manual
   reference. *Confirm what legacy "Order No" is and whether it should be a picker.*
3. **Create-only + list** 🟡 — inline-create + list; legacy record navigation / edit-existing not built.
4. **"Modification History" / "Errors Found" footer buttons not built** 🟡 — same stance as elsewhere.

---

## Sales ▸ Marketing ▸ Define Styles — By Enquiry No. (`/sales/styles`, screenshots _133842 / _133933)

Built as a **flat style register** across enquiries (each row carries its enquiry). Added columns to
`styles` (migration **0268**): `action`, `sample_type`, `composition`, `sample_qty`, `unit_id`. Editor
ties a style to an **Enquiry** (opportunity `Select`); columns match the legacy grid (Enquiry No · Enquiry
Dt · Customer · Sample Type · Style · Style Description · Fabric · Composition · Sample Qty · Unit · Action).
Provisional choices to confirm:

1. **"Composition" = free text** 🟡 — a `compositions` master (0225) and a `config_lookups` kind
   `composition` both exist, but the Step-2 editor form wasn't captured, so we can't tell if Composition
   is a picker. Built as free text. *Confirm whether Composition should pick from the composition master.*
2. **"Action" = free text** 🟡 — the legacy "Action" dropdown's option list wasn't captured. Stored as
   free text `styles.action`. *Confirm the Action dropdown values (and whether it's a fixed list / master).*
3. **"Sample Type" = the sample enum** 🟡 — mapped to the existing samples list (Proto/Fit/SMS/PP/TOP).
   *Confirm Define-Styles "Sample Type" is the same list as sample requests.*
4. **"Fabric" = `fabric_type` enum** 🟡 — mapped to woven/circular/flat_knit. *Confirm legacy "Fabric" is
   the fabric type (not a fabric/quality master).*
5. **Enquiry No / Enquiry Dt / Season / Customer are read-through from the opportunity** 🟢 — Enquiry Dt =
   opportunity `created_at`; no separate enquiry-date column. *Confirm the enquiry date is the opportunity
   creation date, not a distinct field.*
6. **Step-1 Criteria Filter (Column/Operator/Value + Action/Sample Type/Season/Enquiry Dt panel) not
   built** 🟡 — v1 uses search + Season/Sample-Type/Fabric dropdowns instead (same stance as Create
   Opportunities). *Confirm the simplified filter is acceptable.*

---

## Orders ▸ TA ▸ TA Department Assign (screenshot _134038, migration 0267)

Master-detail: header (Entry No auto · Entered Dt · Location ⓘ · Department ⓘ) + activity grid
(S No · Activity ⓘ · Owner). Open items:

1. **"Owner" column read as a boolean checkbox** 🟡 — the grid's Owner cell shows a small square (■)
   control, interpreted as a per-activity "is this department the owner?" checkbox (`is_owner`). If it is
   actually a person/employee picker in legacy, swap `is_owner boolean` → `owner_id → employees`. *Confirm.*
2. **Location = `locations` master, Department = `config_lookups` kind `department`** 🟢 — Location is
   select-only (LocationPicker, managed in System); Department has inline Add/Modify (LookupDialogPicker).
3. **Activity picker = `ta_activities` (RecordPicker, select-only)** 🟢 — references the TA Activity
   catalogue (0266). No inline Add (activities are created on the TA Activity screen).

---

## Sales ▸ Marketing ▸ Prepare Product Cost Sheet — By Enquiry No. (`/sales/cost-sheets`, screenshot _142938)

Built on the **existing** `cost_sheets` / `cost_sheet_items` model (0005) — no migration. A cross-enquiry
register + an inline preparation editor (Enquiry picker → optional Style → currency/target FOB → costed
line items with computed FOB), reusing the existing workflow actions (draft → submit → approve/reject →
clone-to-revise). Only the enquiry-selection Step 1 was captured; the Step-2 costing form was not.
Provisional choices to confirm:

1. **"Against" (Step-1 filter dropdown) not built** 🟡 — legacy Step 1 has an **Against** dropdown (above
   Action/Sample Type/Season/Enquiry Dt) whose options weren't captured. Our cost sheet is always prepared
   *against the enquiry (+ optional style)*. *Confirm what "Against" selects (Enquiry / Sample / Style /
   Order?) and whether it changes what the cost sheet attaches to.*
2. **Cost-sheet line structure = our model, not the legacy Step-2 form** 🟡 — line items are
   category (material/labour/overhead/other) · description · qty · unit cost -> amount, summing to Computed
   FOB. The real legacy cost-sheet layout wasn't captured. *Share the Step-2 costing screenshot to confirm
   the true cost breakdown (per-component rows? standard cost heads? UOM per line?).*
3. **"Sample Qty" column** 🟡 — appears in the legacy tagged-grid header but is a style/sample attribute,
   not a cost-sheet field; not carried on the cost sheet. *Confirm Sample Qty isn't part of the cost sheet.*
4. **Currency/Target FOB prefilled from the enquiry** 🟢 — picking an enquiry defaults currency +
   target FOB from the opportunity (editable). *Confirm this is the desired default.*
5. **Step-1 Criteria Filter (Column/Operator/Value) not built** 🟡 — v1 uses search + Status/Season
   dropdowns (same stance as the other Marketing children).

---

## Orders ▸ TA ▸ TA User Rights (screenshot _143318, migration 0269)

Per-user permission matrix over TA activities: User (ⓘ profiles) + grid rows ("All Activities" +
each activity) × All/View/Add/Modify/Delete. Legacy View/Add/Modify/Delete → view/create/edit/delete.

1. **"All Activities" stored as a wildcard row** 🟡 — `activity_id = null`; it does NOT cascade its
   checkboxes onto the per-activity rows. Enforcement (future) should read the specific-activity row,
   falling back to the wildcard. *Confirm legacy "All Activities" semantics if different.*
2. **Rights are captured only — NOT enforced yet** 🟡 — no TA screen (Plan/Followups/Completion)
   currently reads `ta_user_rights` to restrict actions. Enforcement is a deliberate later step
   (consistent with the other TA masters capturing data ahead of downstream use).
3. **Gated by `system_admin`, not `orders`** 🟢 — user-permission administration; the User picker reads
   `profiles` (admin-only-readable). Lives under Orders ▸ TA in the nav, but only admins can use it.
4. **"All" column is UI-only** 🟢 — a per-row convenience that checks/unchecks the four actions
   together; not persisted as a separate flag.

## Sales ▸ Quote Preparation (costing sheet — migration 0270)

New `quote_costings` document at /sales/quotes (fleshed the scaffold tagged legacy "Marketing
▸ Quote preparation"). A flat garment costing: cost buckets (Fabric/Trims/CMT/Garment
Process/Other Expenses) roll up to Gross → Waste% → Total → Margin% → FOB, grouped By Costing
No. Distinct from the generic line-item cost_sheets (/sales/cost-sheets) and the thin buyer
quotes. Open items:

1. **Cost buckets typed vs rolled-up** — the two screenshots showed only the list + filter, no
   detail entry form, so Fabric/Trims/CMT/Garment-Process/Other are typed directly as amounts.
   Confirm whether they should instead roll up from a deeper breakdown (send that screenshot).
2. **Style No source** — used garment_styles (the full Style master, STL-#### codes). Confirm
   vs the enquiry's sales style cards (thin `styles`, as the Cost Sheet screen does).
3. **"FOB INR" currency** — FOB is computed in the header currency and labelled "FOB INR" per
   legacy. Confirm whether it must always be INR (needs an FX conversion) or is just the label.
4. **FOB / margin formula** — assumed FOB = Total x (1 + Margin%) (margin-on-cost). Confirm.
5. **Legacy filter power-features not reproduced** — the Find dialog's Column/Operator/Value
   advanced-query builder and Tag All/None/Toggle multi-select were replaced by a standard
   FilterBar (search + Currency + Customer + Status). Confirm acceptable.
6. **"Wt"** — assumed garment weight (numeric, informational). Confirm unit/meaning.

## Sales ▸ Confirm Quotes (`/sales/quote-confirmations`)

Fleshed the scaffold (legacy "Marketing ▸ Confirm quotes — By Quote No") into a real grid of quotes
with an inline **Approval Status** control. "Confirm" = set status → **accepted**, reusing the existing
`setQuoteStatus` action (which cascades the opportunity `stage → won` + audit, and makes the quote
appear in Orders ▸ step 3 via `getAcceptedQuotes`). No migration. Reuses the shared `FilterBar`
(search + Status + Currency). Open items:

1. **Ship Type / Ship Mode — not on `quotes`** 🔴 — the legacy grid + Step-1 filter show Ship Type and
   Ship Mode, but `quotes` carries neither column. Both **omitted** (grid + filter). *If quotes must
   capture ship type/mode, add columns (0005 has none) + a capture point on quote prep.*
2. **Followup Dt → `valid_until`** 🟡 — no `followup_date` on `quotes`; shown as "Valid Until" (the
   nearest existing date). *Confirm whether a distinct follow-up date is needed.*
3. **Style No / Costing No — indirect** 🟡 — quotes have no `style_id`; Style No is derived via
   `cost_sheet_id → cost_sheets.style_id → styles.style_code`, and "Costing" shows the cost sheet
   **version** (`cost_sheets` has no human costing code). *Confirm this derivation.*
4. **Tag All/None/Toggle + Column/Operator/Value criteria builder** 🟡 — deferred (same as the Orders
   selectors); status is set per-row inline. *Confirm bulk-confirm isn't required.*

---

## Sales ▸ Marketing ▸ Product Development Request — By Sample No. (`/sales/pd-requests`, screenshots _145017 / _145138)

Built on the **existing** `pd_requests` model (0031, planning-gated). Migration **0270** adds `style_id`,
`sample_type`, `sample_qty`, `unit_id`, `delivery_date`, `customer_reference`. Screen = register + Sheet
editor that raises a PD request against an **enquiry** (writes/reads via the **admin client**, matching the
existing Sales->Planning handoff, so sales-only users work without `planning:view`). Flows into Planning's
PD pipeline (`/planning/product-dev`). Provisional choices to confirm:

1. **Anchored on the enquiry, not "By Sample No."** 🟡 — legacy raises PD requests from tagged **samples**;
   our `samples` table is lean (no code / qty / unit / delivery / customer-ref), so we anchor on the
   opportunity and capture the sample fields directly on the PD request. *Confirm the PD request should
   link to a specific Sample record (and whether Sample No / Sample Dt come from that sample).*
2. **Single-raise, not bulk tag** 🟡 — legacy Step 1 multi-selects samples (Tag All / None / Toggle);
   we raise one PD request at a time via the editor. *Confirm bulk raise-by-sample is wanted.*
3. **Sample Qty / Unit / Delivery Date / Customer Reference entered on the request** 🟡 — captured on the
   PD request header (not read from a sample). *Confirm these are request-entry fields.*
4. **No per-enquiry dedup here** 🟢 — unlike the opportunity "Request Product Development" button (one
   non-cancelled PD per opportunity), this screen allows several (by-sample implies many per enquiry).
5. **Step-1 Criteria Filter (Column/Operator/Value) not built** 🟡 — v1 uses search + Status filter.

---

## Orders ▸ TA ▸ TA Completion (`/orders/ta-completion`, migration 0274)

Built the scaffolded "TA Completion" screen — a small document (structurally identical to Garment Order
Completion): **Completion No** (auto `TAC`) · **Date** · **Customer** ⓘ · **SC No** ⓘ · **Order No**
(text) · **Remarks**. New table `ta_completions`, gated on `orders`; SC No = `RecordPicker` over
non-cancelled `sales_orders` (auto-fills Customer from `buyer_id`); Customer = `RecordPicker` over
`buyers`. Create-only + list. Open items:

1. **Insert-only — no status flip** 🔴 — `ta_plans` (0006) has no completion/status column and the
   TA-Plan screen uses its own tables, so TA Completion just logs a record (unlike Garment Order
   Completion which flips `sales_orders.status='closed'`). *Confirm whether completing here should mark a
   per-order T&A plan / order complete, and which record/status.*
2. **Customer = `buyers`** 🟡 — the order's party, auto-filled from the SC No (matches Garment Order
   Cancellation/Completion). *Confirm buyers, not the customers master.*
3. **"Order No" = free text** 🔴 — `sales_orders` has no customer-PO column and SC No already =
   `order_number`; captured as a manual reference. *Confirm meaning.*
4. **Eligible orders = non-cancelled** 🟡 — TA can complete even a closed order, so only cancelled orders
   are excluded from the SC-No picker. *Confirm the rule.*
5. **Create-only + list**; **Modification History / Errors Found** buttons not built (same stance as the
   other legacy forms).

---

## Orders ▸ TA ▸ TA Followups (`/orders/ta-followups`, migration 0273)

Built the scaffolded "TA Followups — By Department" screen as **actuals tracking on the legacy TA Plan**:
migration 0273 adds `actual_date · status · description · notes` to **`ta_plan_activities`** (no new
table — a followup IS progress on a planned activity). The screen is a cross-plan grid of every TA-plan
activity (joined to its order/style/customer/qty via `ta_plan_docs` + the `ta_activities` master), with
inline editable **Status / Actual Dt / Description / Notes** (commits via `updateTaFollowup`) and a
computed **Days** overdue pill. Reuses the shared `FilterBar` (Status · Department · Activity · Customer
+ Plan-date range). Open items:

1. **Status enum provisional** 🟡 — `pending / in_progress / done` (mirrors System-A `ta_milestones`).
   Legacy may carry **Delayed / Hold**; "overdue/delayed" is currently **derived** from plan vs today.
   *Confirm the real status set.*
2. **Plan Dt = `ta_plan_activities.end_date`** 🟡 — the planned finish. *Confirm vs `start_date`.*
3. **Days formula** 🟡 — actual−plan if an actual exists, else today−plan for open overdue rows
   (positive = late). *Confirm.*
4. **TA Delivery Status Dt → `ta_plan_docs.proposed_delivery_date`** 🟡 — nearest existing field.
   *Confirm meaning (a computed projected delivery date?).*
5. **SQ No = first `sq_note` for the order** 🟡 — an order can have several; we show the earliest.
   `ta_plan_docs` has no direct SQ link. *Confirm which SQ.*
6. **Description / Notes are NEW followup remark fields** 🟢 — free text per activity (matches the
   scaffold's "capture follow-up remarks / next action").
7. **Owners / Order Category filters + Criteria Filter + Tag All/None/Toggle deferred** 🟡 — Owners has
   no per-person column on the TA path; Order Category needs the `order_category_assignments` join; the
   Column/Operator/Value builder + multiselect are legacy chrome (same deferral as the Orders selectors).

---

## Orders ▸ TA ▸ TA Style (`/orders/ta-style`, migration 0133)

Built the scaffolded "TA Style" screen — a reusable **Time & Action template**: header (**Style Ref No**
auto `TAS` code + **Copy** · **Customer** ⓘ · **Description** · **Lead Days** · **Start Days**) + an
**Activity grid** (S No · **Activity** ⓘ · **From Activity** ⓘ · Days Required) + computed **Target Days /
No of Days** footer + **Blocked** checkbox. New tables `ta_styles` + `ta_style_activities`, gated on
`orders`; activities pick from the existing `ta_activities` master. Open items:

1. **Target Days / No of Days formula is provisional** 🔴 — computed as `no_of_days = Σ days_required`,
   `target_days = lead_days + start_days + no_of_days`. *Provide the real T&A roll-up (how Lead/Start days
   and per-activity offsets combine into Target Days / No of Days).*
2. **"From Activity" = picker over the `ta_activities` master** 🔴 — honors the red ⓘ. *Confirm whether
   From Activity should instead reference a prior row in THIS template (a dependency anchor / predecessor)
   rather than the master catalogue.*
3. **Customer = `customers` master** (via `listCustomers`) 🟡 — matches the Style master (TA Style is a
   style template). *Confirm customers-not-buyers.* Caveat: `customers` RLS is `masters`-gated, so an
   orders-only user may see the picker empty — TA users need `masters:view` (same as the Style master).
4. **Style Ref No format** 🟡 — legacy is `TASTYL/2627/0001` (FY-segmented); ours is `TAS-0001`
   (simple sequence). *Confirm the simple code is acceptable or the FY format is required.*
5. **No garment-style link** 🟡 — the actual form has Customer + Description, not a garment-style picker
   (the scaffold's "attached to a garment style" wording was aspirational). *Confirm no `garment_styles` FK
   is needed.*
6. **Copy** = duplicates the open template into a new draft (client-side); **Modification History /
   Errors Found** buttons not built (same stance as other legacy forms).

---

## Orders ▸ TA ▸ TA Plan (screenshot _145838, migration 0271)

Master-detail T&A scheduling document. Built as SEPARATE tables `ta_plan_docs`/`ta_plan_activities`
(user-confirmed) — the existing per-order `ta_plans`/`ta_milestones` (0006) are left untouched.

1. **Style shown without an ⓘ in legacy** 🟡 — `sales_orders` has NO style FK, so Style can't
   auto-fill from the picked order. Modelled as an optional `garment_styles` RecordPicker. *Confirm
   whether Style should be free text or derived some other way.*
2. **"Details" column ⓘ target unknown** 🟡 — built as a plain text input. The red ⓘ suggests a
   picker (likely the activity's sub-activities, given TA Activity's "Has Sub activities" flag), which
   isn't modelled yet. *Confirm what Details picks from.*
3. **"From Activity" = predecessor** 🟢 — a ▼ select over the plan's own added activities; picking one
   suggests this row's Start Dt = the predecessor's End Dt. End Dt auto = Start + Days Required (editable).
4. **SH Ref No = `shipment_plans` (Planning)** 🟡 — user-chosen. Planning-gated RLS, so an orders-only
   user sees an empty SH Ref picker (same cross-module caveat as Material BOM). Needs planning:view.
5. **Doc code = `TAPLAN-0001`** 🟢 — app `assign_code` convention, not the legacy `TAPLAN/2627/0001`
   (FY-embedded) format.

---

## Sales ▸ Marketing ▸ Samples — By Sample No. (`/sales/samples`)

Completed the Marketing set: promoted `samples` to first-class records matching the legacy PD "By Sample
No." grid. Migration **0272** adds `code` (SMP-#### via trigger), `sample_qty`, `unit_id`, `delivery_date`,
`customer_reference` (style_id/type/status already existed). Screen = cross-enquiry register (Sample No ·
Sample Dt · Customer · Sample Type · Style · Sample Qty · Unit · Deli Dt · Customer Ref · Status) + Sheet
editor (enquiry/style/type/status/qty/unit/delivery/customer-ref/courier/notes) with edit + delete.
`sampleInput` moved to `lib/sales/types.ts` (shared by createSample/updateSample). Notes:

1. **Samples is an app screen, no dedicated legacy "Samples" form** 🟢 — the fields are inferred from the
   PD "By Sample No." grid (which lists sample attributes). *Confirm the sample field set is complete.*
2. **PD Request could now read from samples** 🟡 — with samples first-class, the PD "By Sample No." flow
   could tag real samples instead of the current enquiry-anchored capture. Deferred follow-up:
   re-wire `/sales/pd-requests` to select existing `samples` (pulling Sample No/Dt/Qty/Unit/Deli/Ref).
3. **Sample workflow = requested → in_progress → sent → approved/rejected** 🟢 — status editable directly
   in the editor (no separate dispatch action); `dispatched_at`/`courier_ref` retained. *Confirm the
   status set + whether "sent" should auto-stamp a dispatch date.*
