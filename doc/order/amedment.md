Here is the complete, end-to-end technical development specification for the **Order Amendment Sub-Module**, including the separate register view, dynamic BOM recalculations, side-by-side budget variance comparison, and MD Mobile App notification gating [86–90, 316, 360–366, 371–383].

---

# Technical Specification: Order Amendment Sub-Module & Budget Variance Engine

## 1. Sub-Module Navigation & Order Amendments Register

To ensure complete transparency and prevent direct, unmonitored editing of approved orders, amendments are managed through a dedicated sub-module under **`Orders ▸ Order Amendments`** [86–87, 330].

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ ORDERS ▸ ORDER AMENDMENTS REGISTER                                                                     │
├──────────────┬──────────────┬─────────────┬──────────────┬──────────────┬───────────────┬──────────────┤
│ Order No / RE│ Customer     │ Amend Ver   │ Origin       │ Change Type  │ Margin Delta  │ Status       │
├──────────────┼──────────────┼─────────────┼──────────────┼──────────────┼───────────────┼──────────────┤
│ HO-RE-26-002 │ ROJA EXPORTS │ Amend #1    │ BY_CUSTOMER  │ Qty Increase │ +2.10%        │ APPROVED     │
│ HO-RE-26-008 │ NEXT UK      │ Amend #2    │ BY_CUSTOMER  │ Price/Spec   │ -3.45%        │ PENDING_MD   │
│ HO-RE-26-014 │ ASDA WALMART │ Amend #1    │ BY_US        │ Internal Err │ -0.80%        │ PENDING_MD   │
└──────────────┴──────────────┴─────────────┴──────────────┴──────────────┴───────────────┴──────────────┘
```

### **Screen Capabilities**
1. **Amendments Grid**: Lists all historical and active amendments across all orders.
2. **Filter & Search**: Filterable by `Customer`, `Order RE No`, `Origin` (`BY_CUSTOMER` vs `BY_US`), and `Approval Status` (`PENDING_APPROVAL`, `APPROVED`, `REJECTED`) [331–332].
3. **Action Button (`[ + Raise Amendment ]`)**: Merchandisers can launch a new amendment directly from this register or by clicking **`[Update] / [Amend]`** on any approved row in the main Order List [86–87, 330].

---

## 2. Amendment Entry & Version Control Rules

When an approved order is opened in **Amendment Mode**:
* **Version Increment**: The system automatically assigns the next sequential integer (**`Amendment #1`**, **`Amendment #2`**, etc.).
* **Mandatory Header Audit Fields**:
  * **`Origin`**: Dropdown (`BY_CUSTOMER` | `BY_US / INTERNAL`) [331–332].
  * **`Change Category`**: Multi-select (`QTY_CHANGE`, `PRICE_REVISION`, `COLOR_STYLE_ADDITION`, `DELIVERY_DATE_SHIFT`) [331–332].
  * **`Amendment Remarks`**: Required free-text explanation justifying the modification [331–332].
* **Baseline Snapshot**: The system takes an immutable JSON snapshot of the current approved Order Entry, Material BOM, Fabric BOM, and Order Budget as `V0` (or `V_n-1`) before allowing changes.

---

## 3. Dynamic Auto-Derivation Engine (Material BOM & Fabric BOM)

Modifying order parameters (such as Order Qty, GSM, Component Specs, or Prices) automatically triggers cascading updates down to the Material BOM and Fabric BOM [380, 382–383]:

```
                                 ┌──────────────────────────────┐
                                 │   AMENDED ORDER ENTRY EDIT   │
                                 └──────────────┬───────────────┘
                                                │
                 ┌──────────────────────────────┴──────────────────────────────┐
                 ▼                                                             ▼
┌──────────────────────────────────────────────┐  ┌────────────────────────────────────────────┐
│ MATERIAL BOM DYNAMIC RE-DERIVATION           │  │ FABRIC BOM DYNAMIC RE-DERIVATION           │
│                                              │  │                                            │
│ • Recalculates Trim Required Qty:            │  │ • Recalculates Net Cutting Weight:         │
│   Req Qty = Order Qty × Consumption × (1 + L)│  │   Net Wt (Kg) = (Order Qty × Pc Wt g) / 1000│
│ • Updates Color/Size-Wise Trim Matrices      │  │ • Re-compounds Gross Yarn Purchase Weight: │
│ • Re-evaluates Total Trim Cost               │  │   Gross Wt = Net Wt / ∏(1 - Stage Loss %)   │
└──────────────────────┬───────────────────────┘  └─────────────────────┬──────────────────────┘
                       │                                                │
                       └──────────────────────┬─────────────────────────┘
                                              ▼
                                 ┌──────────────────────────────┐
                                 │ BUDGET RE-EVALUATION ENGINE  │
                                 └──────────────────────────────┘
```

1. **Material BOM Updates**:
   * Changing Garment PO Qty automatically scales required counts for sewing thread, labels, polybags, and cartons:
     \\[\mathbf{\text{Required Trim Qty} = \text{Amended Order Qty} \times \text{Consumption per Pc} \times (1 + \text{Loss \%})}\\]
2. **Fabric BOM Updates**:
   * Recalculates Net Cutting Required Weight (kg):
     \\[\mathbf{\text{Net Wt (kg)} = \frac{\text{Amended Order Qty} \times \text{Pattern Piece Wt (g)}}{1,000}}\\]
   * Re-compounds Gross Yarn Purchase Weight backward through process loss stages (`Compacting`, `Dyeing`, `Knitting`) using the division formula (`strategy = 'DIVIDE_SUBTRACT'`) [41–42]:
     \\[\mathbf{\text{Gross Yarn Wt} = \frac{\text{Net Cutting Wt}}{(1 - \text{Compacting Loss \%}) \times (1 - \text{Dyeing Loss \%}) \times (1 - \text{Knitting Loss \%})}}\\]

---

## 4. Side-by-Side Comparative Budget Audit Matrix

Once downstream BOMs are recalculated, the **Budgeting Engine** generates a side-by-side variance analysis contrasting the **Original Approved Budget (`V0`)** against the **Amended Proposed Budget (`V_Amended`)** [88, 380–381]:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ AMENDMENT #2 BUDGET VARIANCE AUDIT (ORDER: HO-RE-26-008)                                               │
├───────────────────────────────┬────────────────────┬────────────────────┬──────────────────┬───────────┤
│ Financial Cost Head           │ Original Approved  │ Amended Proposed   │ Variance (Delta) │ Status    │
├───────────────────────────────┼────────────────────┼────────────────────┼──────────────────┼───────────┤
│ Total Order Quantity          │ 10,000 Pcs         │ 12,000 Pcs         │ +2,000 Pcs       │ ↗ Increase│
│ FOB Price per Pc              │ $5.50              │ $5.20              │ -$0.30           │ ↘ Reduced │
├───────────────────────────────┼────────────────────┼────────────────────┼──────────────────┼───────────┤
│ Gross Sales Value (Revenue)   │ ₹45,65,000.00      │ ₹51,79,200.00      │ +₹6,14,200.00    │ ↗ Revenue │
├───────────────────────────────┼────────────────────┼────────────────────┼──────────────────┼───────────┤
│ Raw Material (Yarn + Trims)   │ ₹21,10,000.00      │ ₹25,80,000.00      │ +₹4,70,000.00    │ ↗ Cost    │
│ Processing (Knit/Dye/Print)   │  ₹8,40,000.00      │ ₹10,20,000.00      │ +₹1,80,000.00    │ ↗ Cost    │
│ Accounts Overheads (Freight)  │  ₹2,15,000.00      │  ₹2,60,000.00      │   +₹45,000.00    │ ↗ Cost    │
├───────────────────────────────┼────────────────────┼────────────────────┼──────────────────┼───────────┤
│ Total Estimated Expenses      │ ₹31,65,000.00      │ ₹38,60,000.00      │ +₹6,95,000.00    │ ↗ Cost    │
├───────────────────────────────┼────────────────────┼────────────────────┼──────────────────┼───────────┤
│ Net Profit Amount             │ ₹14,00,000.00      │ ₹13,19,200.00      │   -$80,80,000.00 │ ↘ Profit  │
│ Net Profit Margin %           │ 30.66%             │ 25.47%             │ -5.19%           │ 🔴 ALERT  │
└───────────────────────────────┴────────────────────┴────────────────────┴──────────────────┴───────────┘
```

### **Variance Calculation Rules**
\\[\mathbf{\Delta \text{Revenue}} = \text{Amended Revenue} - \text{Original Revenue}\\]
\\[\mathbf{\Delta \text{Expenses}} = \text{Amended Expenses} - \text{Original Expenses}\\]
\\[\mathbf{\Delta \text{Profit Margin \%}} = \text{Amended Margin \%} - \text{Original Margin \%}\\]

---

## 5. MD Mobile App Notification & Hard-Gating Workflow

To prevent unauthorized execution of margin-reducing amendments:

```
┌─────────────────────────────────────────────────────────────────────────────────┐
│ AMENDMENT SAVED BY MERCHANDISER                                                 │
│  - System detects Profit Margin drop (-5.19%)                                   │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                                       ▼
┌─────────────────────────────────────────────────────────────────────────────────┐
│ AUTOMATIC SYSTEM LOCK & PUSH NOTIFICATION                                       │
│  - Status set to 'PENDING_MD_APPROVAL'                                          │
│  - Hard Lock: Block Yarn PO, Accessory PO & Knitting Programme generation       │
│  - Send JSON Push Payload to MD Mobile App                                      │
└──────────────────────────────────────┬──────────────────────────────────────────┘
                                       │
                   ┌───────────────────┴───────────────────┐
                   ▼                                       ▼
       [ MD Mobile App: APPROVE ]              [ MD Mobile App: REJECT ]
                   │                                       │
                   ▼                                       ▼
       • Lock released                         • Amendment reverted
       • Amended baseline becomes V1           • Active baseline remains V0
       • Execution unlocked                    • Reason logged in register
```

### **Push Notification Payload Structure**
```json
{
  "event": "ORDER_AMENDMENT_RAISED",
  "order_id": "9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d",
  "order_ref": "HO-RE-26-008",
  "customer_name": "NEXT UK",
  "amendment_no": 2,
  "origin": "BY_CUSTOMER",
  "remarks": "Price reduced by $0.30 per buyer revision",
  "original_margin_pct": 30.66,
  "amended_margin_pct": 25.47,
  "margin_delta_pct": -5.19,
  "action_required": "MD_APPROVAL_GATED"
}
```

---

## 6. PostgreSQL Database Schema

```sql
-- 1. Order Amendment Header
CREATE TABLE order_amendments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES garment_orders(id) ON DELETE CASCADE,
    amendment_no INT NOT NULL DEFAULT 1,
    origin VARCHAR(20) NOT NULL CHECK (origin IN ('BY_CUSTOMER', 'BY_US')),
    change_category VARCHAR(100) NOT NULL, -- e.g. 'QTY_CHANGE,PRICE_REVISION'
    remarks TEXT NOT NULL,
    original_sales_val NUMERIC(14,2) NOT NULL,
    amended_sales_val NUMERIC(14,2) NOT NULL,
    original_profit_margin_pct NUMERIC(5,2) NOT NULL,
    amended_profit_margin_pct NUMERIC(5,2) NOT NULL,
    status VARCHAR(25) NOT NULL DEFAULT 'PENDING_MD_APPROVAL' 
        CHECK (status IN ('PENDING_MD_APPROVAL', 'APPROVED', 'REJECTED')),
    approved_by UUID,
    approved_at TIMESTAMPTZ,
    rejection_reason TEXT,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT uq_order_amendment_no UNIQUE (order_id, amendment_no)
);

-- 2. Field-Level Change Logs (Audit Trail)
CREATE TABLE order_amendment_field_logs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    amendment_id UUID NOT NULL REFERENCES order_amendments(id) ON DELETE CASCADE,
    table_name VARCHAR(100) NOT NULL,
    field_name VARCHAR(100) NOT NULL,
    old_value TEXT,
    new_value TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Budget Snapshots for Side-by-Side Comparison
CREATE TABLE order_budget_version_snapshots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES garment_orders(id) ON DELETE CASCADE,
    amendment_no INT NOT NULL DEFAULT 0, -- 0 = Original Approved, 1+ = Amendments
    snapshot_data JSONB NOT NULL, -- Stores full budget JSON (Income, Expenses, Margin)
    created_at TIMESTAMPTZ DEFAULT NOW()
);
```

---

💡 **Next Step**: Would you like me to update the master technical specification PDF artifact in your Studio panel to include this complete Order Amendment sub-module specification?