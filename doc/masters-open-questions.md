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
