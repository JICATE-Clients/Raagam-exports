# Developer Implementation Specification & UI/UX Field Updates (v8)

**Target Modules:** Order Entry / Sample Entry, Product Info, Sample Info, Combos, PD Request, Product Grouping, Sample Costing, Sample Fabric Plan, Accessories Plan, and Tracking Reports  
**Document Purpose:** Complete technical specification covering UI field mappings, explicit terminology separation (`Revise` for Quotation vs `Revision` for Plans), database locking rules, calculation formulas, workflow handoffs, email negotiation handling, and plan approval tracking for the development team.

---

## 1. Action Terminology Alignment (`Revise` vs. `Revision`)

To eliminate UI ambiguity across departments, the system enforces strict terminology separation based on existing built application flows:

* **Quotation / Costing $\longrightarrow$ `Revise`:** Refers to pre-approval quotation iterations during buyer email negotiations (`Revise 0`, `Revise 1`, `Revise 2`...) while status remains `Under Progress`.
* **Fabric & Accessories Plans $\longrightarrow$ `Revision`:** Refers to the separate, built-in plan approval flow (`Revision 1`, `Revision 2`...) triggered via `Raise Revision` which routes plan changes to the Approval / Report Queue.

| Module | UI Button Label | Terminology | Workflow & Report Destination |
| :--- | :--- | :--- | :--- |
| **Quotation / Costing** | `Revise` / `Raise Revise` | **Quotation Revise** | Stays in `Under Progress` tab for buyer email negotiations |
| **Fabric Plan** | `Raise Revision` | **Fabric Plan Revision** | Separate approval flow $\rightarrow$ Sent to Approval Queue |
| **Accessories Plan** | `Raise Revision` | **Accessories Plan Revision** | Separate approval flow $\rightarrow$ Sent to Approval Queue |

---

## 2. Fabric Plan Formulas & Calculations

### 2.1 Gross Fabric Weight (Greige Weight) Formula
To account for mill processing losses (knitting, dyeing, stentering, compacting, brushing/sueding), the system calculates gross/greige fabric requirement as:

$$\text{Gross Weight (Greige Weight in Kg)} = \frac{\text{Required Finished Weight (Net Wt in Kg)}}{1 - \text{Process Loss \%}}$$

* **Dyeing Work Order (Issue Qty):** Issued at **Gross/Greige Weight** because dye houses process and invoice on raw input weight.
* **Stores Receipt (Return Qty):** Verified against the **Net Target Finished Weight** when dyed fabric returns to the factory floor.

### 2.2 Dual-Loss Costing Architecture
* **Mill Process Loss % (10%–12%):** Factored into the **Fabric Price per Kg** calculation.
$$\text{Fabric Price / Kg} = \left(\text{Yarn Rate} + \text{Knitting Rate} + \text{Dyeing Rate} + \sum \text{Finishing Rates}\right) \times (1 + \text{Process Loss \%})$$
* **Cutting Waste Allowance (3% in `calc.ts`):** Applied at the garment component level to account for floor cutting waste and panel trimming.

---

## 3. Fabric Consumption Grid: 3-Tier Tree-Grid Hierarchy

To resolve user confusion when a single sample style or fabric structure has multiple colors or multiple finished diameters (e.g., body fabric vs. cuff/collar rib), the UI uses a **3-tier nested tree-grid**:

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ Level 1: Sample & Fabric Construction  ──► [SMP No] + [Fabric Structure] + [GSM]                         │
│   └── Level 2: Color Breakdown         ──► [Colour]  (+ Add Color button)                                │
│         └── Level 3: Dia & Weight Pairs──► [Finish Dia] + [Req Wt (KGS)]  (+ Add Dia button)            │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

## 4. Order Entry & Product Info Updates

### 4.1 Field Rules
* **`Style Name / No` → `Article No` Auto-Fetch:** Selecting/typing a `Style Name / No` automatically triggers a backend lookup to populate `Article No`.
* **`Fabric Structure` & `GSM`:** Multi-select dropdown for fabric structures (e.g. *Single Jersey*, *1x1 Lycra Rib*, *3-Thread Fleece*) with structure-dependent GSM fields.
* **`Garment Unit Type`:** Choice of **Piece** or **Set** (Top/Bottom/Co-ord).
* **Billable Toggle:** Defaults to **No (Free of Cost)**. When **Yes**, exposes commercial fields (Shipment Type/Mode, Currency, Price, Size-Quantity breakdown).
* **Removed Legacy Fields:** Stripped bulk production identifiers (`PRD No`, `RE No`, `FAR No`, `For`).

---

## 5. Combos Tab: Embellishment Structure

Under/below the **Combos** tab, the **Embellishments** section is split into two distinct categories:

1. **Component Process (Panel-Level):** Applied to individual cut panels before stitching (e.g., Chest Printing, Embroidery, Appliqué, Sequins, Heat Seal Logos).
2. **Garment Process (Whole Garment):** Applied to the complete assembled garment (e.g., Garment Wash, Enzyme Wash, Softener Wash, Tie & Dye, Dip Dye).

---

## 6. Merchandising Handoff: PD Request & SWO Sequence

### 6.1 Workflow Sequence
$$\text{Sample Entry } (\text{SMP No}) \longrightarrow \text{PD Request} \longrightarrow \text{Acknowledgement} \longrightarrow \text{Product Grouping} \longrightarrow \text{SWO Number}$$

1. **`SMP Number` Creation:** Merchandiser saves initial style request.
2. **PD Request:** Merchandiser selects `SMP Number` on the PD Request screen to formally instruct the Sample Department.
3. **Acknowledgement:** Sample Department clicks **`Acknowledge`** on the PD Request.
4. **Product Grouping & `SWO Number`:** Acknowledged `SMP Number` entries land in the Product Grouping queue. Saving the group assigns a master **`SWO Number`** (`SWO/26-27/0001`) for consolidated yarn procurement and fabric planning.

---

## 7. Sample Costing: Data Pre-Fill, Target USD/PCS & Multi-Currency

### 7.1 Sample Entry ▸ Costing Pre-Fill (Gap 3A Resolution)
* When creating a new Cost Sheet (`Revise 0`), `sample-costing-screen.tsx` auto-populates fabric rows directly from `sample.fabric_structures` (`Structure`, `GSM`, `Composition`).
* Dimensional weight calculator (`Length × Width × GSM`) defaults to the pre-filled structure GSM.

### 7.2 Buyer Target Price (USD/PCS) & Multi-Currency Analysis
* **Multi-Currency Conversion:** Base INR totals convert dynamically to **USD ($)**, **GBP (£)**, or **EUR (€)** based on exchange rates.
* **Buyer Target Entry:** Planners can enter a target price in `Buyer Target USD/PCS` (e.g., $4.75).
* **Dynamic Recalculation:** Instantly recalculates realized profit margin % and net Rupee gain/loss per piece without altering the base INR cost calculations.

---

## 8. Workflow Specifications: Quotation Revise vs. Plan Revision

### 8.1 Quotation / Costing (`Revise` Workflow)
* **Pre-Approval Email Negotiation (`Under Progress`):**
  1. Initial costing created as `Revise 0`.
  2. Merchandiser/MD emails quotation to buyer.
  3. When buyer negotiates in email, merchandiser updates rates or margins (`Revise 1`, `Revise 2`, `Revise 3`), emailing updated quotes back while status remains **`Under Progress`**.
* **Customer Email Acceptance (`Approved`):**
  1. Status changes to **`Approved`** **ONLY when customer confirms acceptance via email**.
  2. Customer acceptance locks the final quoted rates, per-piece costs, and profit margins.
* **Post-Approval Quotation Revise (`Revise` Button):**
  1. If an *Approved / Locked* quote needs adjustments later (spec/quantity changes or yarn rate fluctuations), clicking **`Revise`** unlocks the costing sheet.
  2. System increments to `Revise N+1`, backs up the $V_0$ approved snapshot in `sample_revisions`, and resets status back to **`Under Progress`** for re-negotiation.

### 8.2 Fabric & Accessories Plans (`Revision` Approval Flow)
* **Separate Built-in Approval Flow:** Fabric and Accessories Plans use the dedicated **`Revision`** workflow already built into the application.
* **Initial State:** Saved as `Draft` $\rightarrow$ Submitted $\rightarrow$ Management Approves $\rightarrow$ Status set to **`Approved`** (Locked).
* **`Raise Revision` Action:**
  1. Clicking **`Raise Revision`** on an approved plan unlocks editing.
  2. Creates the next plan revision (`Revision 1`, `Revision 2`...) and creates a $V_0$ JSONB backup snapshot.
  3. Routes the revised plan to the **Approval Queue / Report View** where management reviews diffs (yarn weight deltas, dyeing shade changes, trim quantity adjustments) before granting re-approval.

---

## 9. Report & Tracking Screen Architecture (4-Tab Layout)

### 9.1 Status Renaming Rules
* **`Pending SMP` $\rightarrow$ `Approved`:** Once a Sample Entry (`SMP Number`) is created and saved, its status is updated/renamed to **`Approved`** (indicating the sample request is valid and active).
* **`Under Progress`:** Assigned to active sample costings currently undergoing internal adjustments or buyer email negotiations.
* **`Approved`:** Assigned to customer-accepted costings and approved fabric/accessories plans.
* **`Rejected`:** Assigned to customer-declined quotes or cancelled sample requests.

### 9.2 Tracking Report Tab Structure

```
┌──────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ SAMPLE MANAGEMENT TRACKING REPORT                                                                        │
├───────────────────┬───────────────────┬───────────────────┬──────────────────────────────────────────────┤
│ 📝 Draft          │ ⏳ Under Progress │ ✅ Approved       │ ❌ Rejected                                  │
├───────────────────┴───────────────────┴───────────────────┴──────────────────────────────────────────────┤
│ [ Tab Content & Grid Filters ]                                                                           │
└──────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **`Draft` Tab:** Unsubmitted cost sheets, draft fabric plans, and draft accessories plans (`Edit Draft`, `Submit`).
2. **`Under Progress` Tab:** Active costings undergoing buyer email negotiation (`Revise Quote`, `Mark Customer Approved`, `Mark Rejected`).
3. **`Approved` Tab:** Saved Sample Entries (`SMP Number`), customer-accepted Costings, and approved Fabric/Accessories Plans (`View Summary / PDF Report`, **`Revise`** for Costing, **`Raise Revision`** for Plans).
4. **`Rejected` Tab:** Customer-declined quotes or cancelled requests (`View Rejection Reason`, `Re-open as New Draft`).

---

## 10. Migration `0716` Database Lock & Revision Engine

* **`sample_revisions` Table:** Captures $V_0$ JSONB snapshot upon initiating a quotation revise or plan revision (`revision_code` format: `SMP-REV/26-27/000N`).
* **`refuse_when_sample_locked()` Trigger:** Attaches to `opportunities` and `styles` to block direct database edits while a revision or costing approval is pending.
* **`abandon_sample_revision()` RPC:** Restores $V_0$ JSONB snapshot, purges unapproved draft records, and reinstates active version safely.
