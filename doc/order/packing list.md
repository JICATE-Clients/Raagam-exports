Here is the complete functional and technical specification for the **Packing List Advice (Packing Advised List)** screen (`Screenshot (2942).png`), designed for your development team to build the export packing and dispatch workflow.

---

### 1. Purpose & Core Logic of Packing List Advice

The **Packing List Advice** acts as the formal bridge between garment production completion and export logistics . It translates completed garment quantities into physical shipping units (cartons), defining exact carton sequences, assortment rules (solid vs. ratio packing), and destination groupings.

* **Upstream Integration**: Auto-fetches order details, quantities, styles, and shipping destinations directly from **Order Entry**.
* **Downstream Integration**: Feeds actual packed figures into the **Order Completion & P&L Variance Engine** to reconcile cutting, sewing, and shipping quantities against initial budget projections.

---

### 2. Header UI Logic & Field Mapping

The header section organizes shipment metadata and links directly to customer contracts:

```
┌────────────────────────────────────────────────────────────────────────────────────────┐
│ PACKING LIST ADVICE HEADER                                                             │
├──────────────────────────────┬──────────────────────────┬──────────────────────────────┤
│ Packing Advice No: [U2/PLA/…]│ Date:       │ Customer: [AARSAN AMERICAS]  │
│ Order Ref (RE No): [U2/RE...]│ Destination / Country:   │ Total Cartons: [Calc]        │
│                              │ [USA - US East Coast ▼]  │ Total Packed Pcs: [Calc]     │
└──────────────────────────────┴──────────────────────────┴──────────────────────────────┘
```

#### Field Specifications for Developers:
* **`Packing Advice No`**: Auto-generated sequential shipping document ID (e.g., `U2/PLA/2627/0012`).
* **`Date`**: Document creation date.
* **`Customer`**: Buyer name selected from Customer Master.
* **`Order Reference (RE No)`**: Links directly to the approved order reference entry.
* **`Destination / Country`**: **Multi-Destination Dropdown** — Fetches destination countries defined in the Order Entry Quantity breakdown. If an RE Number contains multiple delivery destinations (e.g., US East Coast vs. US West Coast), the user selects the specific destination for this packing batch.

---

### 3. Packing & Assortment Grid Specification

The lower grid handles carton allocation and garment distribution:

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│ PACKING ASSORTMENT DATA GRID                                                                          │
├──────┬──────────────┬──────────────┬────────────┬─────────────┬─────────────┬───────────┬──────────────┤
│ S No │ Style / Art  │ Color / Shade│ From Ctn No│ To Ctn No   │ Total Ctns  │ Assortment│ Pcs / Ctn    │
│      │              │              │            │             │ [Calc]      │ Type      │              │
├──────┼──────────────┼──────────────┼────────────┼─────────────┼─────────────┼───────────┼──────────────┤
│ 1    │ 1000143376-W │ NAVY BLUE    │ 1          │ 10          │ 10          │ SOLID (M) │ 24 PCS       │
│ 2    │ 1000143376-W │ NAVY BLUE    │ 11         │ 25          │ 15          │ RATIO     │ 30 PCS       │
└──────┴──────────────┴──────────────┴────────────┴─────────────┴─────────────┴───────────┴──────────────┘
```

#### Detailed Column Logic:
1. **`S No`**: Sequential line item index.
2. **`Style / Article No`**: Dropdown listing active styles under the selected RE Number .
3. **`Color / Shade`**: Garment shade name.
4. **`From Ctn No` & `To Ctn No`**: **Manual Input Fields** — Defines carton numbering range (e.g., `1` to `10`).
5. **`Total Cartons`**: **Calculated Field**:
   \\[\text{Total Cartons} = (\text{To Ctn No} - \text{From Ctn No}) + 1\\]
6. **`Assortment Type`**: Dropdown selector:
   * **`Solid Size`**: One size per carton (e.g., 24 pieces of Size M in every carton).
   * **`Ratio / Mixed`**: Mixed size ratio per carton (e.g., 1-S, 2-M, 2-L, 1-XL = 6 pcs/pack x 5 packs = 30 pcs/carton).
7. **`Pcs / Carton`**: Number of pieces per carton .
8. **`Line Total Pcs`**: **Calculated Field**:
   \\[\text{Line Total Pcs} = \text{Total Cartons} \times \text{Pcs / Carton}\\]
9. **`Carton Dimensions & Weight`**:
   * `Dimensions (LxWxH cm)`: (e.g., `60 x 40 x 40 cm`).
   * `Gross Weight (KG)` & `Net Weight (KG)`: Measurements required for shipping bill and bill of lading generation.

---

### 4. Integration with Order Completion & P&L Reconciliation

```
   ┌──────────────────────┐
   │ ORDER ENTRY          │ ──► Budgeted Order Qty (e.g., 1,000 Pcs)
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ CUTTING & SEWING     │ ──► Actual Cut/Sewn Output (e.g., 1,025 Pcs)
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────┐
   │ PACKING LIST ADVICE  │ ──► Total Packed Pcs (e.g., 1,000 Pcs)
   └──────────┬───────────┘
              │
              ▼
   ┌──────────────────────────────────────────────────────────┐
   │ ORDER COMPLETION REPORT (OCR) & P&L ENGINE               │
   │ • Shipped Pcs: 1,000                                     │
   │ • Surplus Unpacked / Rejected: 25 Pcs                    │
   │ • Process Losses & Waste Reconciled                       │
   │ • Final Financial P&L Statement Generated                │
   └──────────────────────────────────────────────────────────┘
```

1. **Reconciliation**: When an order cycle ends, the system aggregates all **Packing List Advices** for an RE Number to calculate total shipped garments.
2. **Variance Analysis**: The **Order Completion Report (OCR)** compares shipped garments against yarn/fabric issued and cut pieces, identifying process losses, leftover scrap, or rejected garments.
3. **P&L Settlement**: Calculates actual financial gain or loss against the original budget target.

---

### 5. Database Schema for Developers (SQL)

```sql
-- 1. Packing List Advice Header
CREATE TABLE packing_list_advice_header (
    pla_id INT PRIMARY KEY AUTO_INCREMENT,
    pla_no VARCHAR(100) UNIQUE NOT NULL, -- e.g. U2/PLA/2627/0012
    pla_date DATE NOT NULL,
    customer_id INT NOT NULL,
    re_no VARCHAR(100) NOT NULL,
    destination_country VARCHAR(100) NOT NULL,
    total_cartons INT DEFAULT 0,
    total_packed_pcs INT DEFAULT 0,
    remarks TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- 2. Packing List Advice Details Grid
CREATE TABLE packing_list_advice_details (
    detail_id INT PRIMARY KEY AUTO_INCREMENT,
    pla_id INT NOT NULL,
    style_article_no VARCHAR(100) NOT NULL,
    color_shade VARCHAR(100) NOT NULL,
    from_carton_no INT NOT NULL,
    to_carton_no INT NOT NULL,
    total_cartons INT GENERATED ALWAYS AS ((to_carton_no - from_carton_no) + 1) STORED,
    assortment_type ENUM('SOLID_SIZE', 'RATIO_MIXED') DEFAULT 'SOLID_SIZE',
    pcs_per_carton INT NOT NULL,
    line_total_pcs INT GENERATED ALWAYS AS (((to_carton_no - from_carton_no) + 1) * pcs_per_carton) STORED,
    carton_dimensions VARCHAR(50), -- e.g. 60x40x40 cm
    gross_weight_kg DECIMAL(10,2),
    net_weight_kg DECIMAL(10,2),
    FOREIGN KEY (pla_id) REFERENCES packing_list_advice_header(pla_id)
);
```

---

🚚 *Would you like me to generate a PDF technical design report for this Packing List Advice module to add to your developer documentation set?*