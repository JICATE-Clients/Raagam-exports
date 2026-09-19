To build the total budget module, your system needs to pull planned material quantities and style metadata from **three upstream modules** (Order Entry, Fabric PLM, and Material PLM), combine them with **merchandiser rate inputs**, run the **profitability engine**, and enforce the **approval locking protocol**.

Here is the exact data mapping, calculation engine, and workflow logic to implement in your application.

---

### 1. Data Pull Mapping: Where to Fetch Data From

Your budget screen does not require manual entry of item names or quantities. Everything is auto-populated from upstream planning modules:

```
┌─────────────────────────────────────────────────────────────────────────────────────────┐
│                                 UPSTREAM DATA PIPELINE                                  │
├──────────────────────────┬─────────────────────────────────┬────────────────────────────┤
│ SOURCE MODULE            │ DATA PULLED INTO BUDGET SCREEN  │ TARGET BUDGET TAB / FIELD  │
├──────────────────────────┼─────────────────────────────────┼────────────────────────────┤
│ 1. Order Entry /         │ • SQ No, RE No, Customer Name   │ • Header Metadata Panel    │
│    Garment Order Master  │ • SQ Qty, Order Qty, Unit       │ • Header & CMT Tab         │
│                          │ • Currency, Exchange Rate       │ • Bottom Sales Panel       │
│                          │ • Average Unit Price (USD)      │ • Bottom Sales Panel       │
│                          │ • Style Ref No, Article No      │ • CMT Tab              │
├──────────────────────────┼─────────────────────────────────┼────────────────────────────┤
│ 2. Fabric PLM /          │ • Yarn Description & Specs      │ • Yarn Purchases Tab   │
│    Yarn Requirement BOM  │ • Reqd Yarn Weight (KGS)        │ • Yarn Purchases Tab   │
│                          │ • Fabric Description & Shade    │ • Fabric Purchases Tab │
│                          │ • Reqd Fabric Weight (KGS)      │ • Fabric Purchases Tab │
│                          │ • Yarn Process List (Dyeing)    │ • Yarn Processes Tab   │
│                          │ • Fabric Process List (Knitting,│ • Fabric Processes Tab │
│                          │   Dyeing, Brushing, Stentering) │                            │
├──────────────────────────┼─────────────────────────────────┼────────────────────────────┤
│ 3. Material PLM /        │ • Accessories/Trims List        │ • Accessories Purchases    │
│    Accessory BOM         │   (Cartons, Labels, Polybags,   │   Tab                  │
│                          │    Threads, Foam)               │                            │
│                          │ • UOM & Reqd Quantities         │ • Accessories Purchases    │
│                          │ • Accessory Process List        │ • Accessories Processes    │
├──────────────────────────┼─────────────────────────────────┼────────────────────────────┤
│ 4. Style Specifications  │ • Garment Operations List       │ • Garment Processes        │
│    (Order Entry)         │   (Embroidery, Printing, Wash)  │   Tab                  │
│                          │ • Placements & Reqd PCS         │ • Garment Processes Tab│
└──────────────────────────┴─────────────────────────────────┴────────────────────────────┘
```

---

### 2. Merchandiser Input Fields (What Users Type In)

Once the system pulls the quantities, the merchandiser only inputs the **financial rates and unit charges**:

1. **Purchase Rates**: Yarn Rate (INR/KG), Fabric Rate (INR/KG), Accessory Unit Price (INR/UOM).
2. **Process Charges**: Yarn Process Charges, Fabric Process Charges (per KG / Fabric-wise / Color-wise), Accessory Process Charges, Garment Embellishment Charges (per Piece).
3. **CMT Rates**: Cutting, Making/Sewing, Checking, Ironing, and Packing charges per garment piece.
4. **Other Expenses**: Unit rates or lump-sum charges for Testing, FOB Freight, Bank LC charges, and Buyer Commission.
5. **Other Incomes**: Percentage or flat rates for Duty Drawback, RoDTEP, or ROSCTL government export subsidies.

---

### 3. Total Budget Calculation Engine Logic

Implement these exact formulas in your backend or frontend reactive state:

#### Step A: Revenue Calculations
1. **Gross Sales Value**:
   \\[\text{Gross Sales Value (INR)} = \text{SQ Quantity} \times \text{Average Price (USD)} \times \text{Exchange Rate}\\]

#### Step B: Expense Subtotal Calculations
1. **Yarn Cost Total** = \\(\sum (\text{Reqd Yarn KG} \times \text{Yarn Rate})\\)
2. **Fabric Cost Total** = \\(\sum (\text{Reqd Fabric KG} \times \text{Fabric Rate})\\)
3. **Accessory Cost Total** = \\(\sum (\text{Reqd Accessory Qty} \times \text{Accessory Rate})\\)
4. **Processing Cost Total** = \\(\sum \text{Yarn Processes} + \sum \text{Fabric Processes} + \sum \text{Accessory Processes} + \sum \text{Garment Processes}\\)
5. **CMT Cost Total** = \\(\text{SQ Quantity} \times \text{CMT Rate per Piece}\\)
6. **Other Expenses Total** = \\(\sum \text{Testing} + \text{FOB} + \text{Bank Charges} + \text{Commissions}\\)

#### Step C: Total Expenses & Profitability Metrics
1. **Grand Total Expenses**:
   \\[\text{Total Expenses} = \text{Yarn Cost} + \text{Fabric Cost} + \text{Accessory Cost} + \text{Process Cost} + \text{CMT Cost} + \text{Other Expenses}\\]
2. **Total Order Income**:
   \\[\text{Total Income} = \text{Gross Sales Value} + \text{Total Other Incomes}\\]
3. **Net Profit Amount**:
   \\[\text{Net Profit Value (INR)} = \text{Total Income} - \text{Total Expenses}\\]
4. **Profit Margin Percentage**:
   \\[\text{Profit Margin \%} = \left( \frac{\text{Net Profit Value}}{\text{Gross Sales Value}} \right) \times 100\\]
5. **Cost Per Garment**:
   \\[\text{Cost Per Piece} = \frac{\text{Total Expenses}}{\text{SQ Quantity}}\\]

---

### 4. Workflow & Locking Logic Implementation

```
   ┌────────────────┐       ┌───────────────────────┐       ┌───────────────────────┐
   │ MERCHANDISER   │       │ MANAGEMENT DASHBOARD  │       │ DATA LOCKING PROTOCOL │
   │ Fills Rates    ├──────►│ (MD Mobile / Web)     ├──────►│ (System DB Trigger)   │
   │ & Submits RE   │       │ Reviews Profit %      │       │ RE Status = APPROVED  │
   └────────────────┘       └───────────┬───────────┘       └───────────┬───────────┘
                                        │                               │
                               ┌────────┴────────┐             ┌────────┴────────┐
                               ▼                 ▼             ▼                 ▼
                          [APPROVE]          [REWORK]    [HARD LOCK]      [RE-OPEN]
                                                         Locks Order Entry, Edit Allowed
                                                         Fabric PLM &     in Budget
                                                         Material PLM     Form
```

1. **Draft / Pending State**: While `Status = PENDING`, merchandisers can freely modify rates and copy structures from previous entries ("Copy From" option).
2. **Approval Submission**: Submitting routes a notification payload to the **Management Dashboard (MD)** containing:
   * `RE Number`, `Entry Date`, `Delivery Date`, `Order Qty`, `Total Income`, `Total Expenses`, `Profit Amount`, `Profit %`, and `Cost per Piece`.
3. **Hard Lock Rules (Post-Approval)**:
   * When approved, set `RE Status = APPROVED`.
   * Execute database lock triggers to set **Order Entry**, **Fabric PLM**, and **Material PLM (Accessory BOM)** to **Read-Only / Locked** for this `RE No`.
   * This protects the projected profit margin from unauthorized edits to quantities, price, or fabric weight.
4. **Amendment Protocol (For Post-Approval Changes)**:
   * If a customer alters order terms (quantity, price, delivery date) or an internal error occurs post-approval, open an **Amendment Protocol** form.
   * Capture `Amendment Source` (**By Customer** vs. **By Us**), `Amendment Type`, and a mandatory `Reason` field while keeping an audit log against the original approved budget baseline.

---

🎯 *Would you like me to generate the database triggers for auto-locking the upstream tables upon approval, or set up a sample JSON payload for the Mobile Approval Push Notification?*