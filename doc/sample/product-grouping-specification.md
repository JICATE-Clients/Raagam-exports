# Developer Specification: Product Grouping Screen (Sample & Fabric Planning)

**Document Title:** Sample Style & Material Grouping Module Specification  
**Target Audience:** Full-Stack Developers, Database Engineers, UI/UX Engineers  
**System Module:** Sample Management & Internal Work Order (IW) / Fabric Planning  
**Status:** Approved for Implementation  

---

## 1. Executive Summary & Business Rationale

In garment manufacturing, buyer sample requests typically consist of small quantities (e.g., 2 to 5 pieces per style, requiring only 0.5 kg to 2 kg of fabric). However, commercial yarn spinning mills, knitting units, and dyeing houses enforce Minimum Order Quantities (MOQ)—typically 50 kg to 60 kg per bag/batch.

Processing individual fabric orders for single sample styles is cost-prohibitive and wasteful. The **Product Grouping Screen** allows merchandisers and sample planners to aggregate multiple sample styles from the same Season that share common yarn blends, fabric structures, or colors into a single **Group Work Order**.

---

## 2. Technical Architecture & Workflow

```
[ Individual Sample Entries (2-5 pcs) ] 
                 │
                 ▼
     [ Product Grouping Screen ]
   (Filter by Season / Yarn / Fabric)
                 │
                 ▼
    [ Combined Group ID (GRP-xxxx) ] ──► Aggregates Weight & Applies MOQ (e.g., 60 kg)
                 │
                 ▼
 [ Consolidated Fabric Plan & Yarn PO ]
                 │
                 ▼
[ Fabric Received ──► De-group / Allocate to Style IDs for Cutting & Sewing ]
```

---

## 3. UI/UX Layout & Toggle Views

The screen features a top-level toggle allowing users to switch between the **Developer / Operations Detailed View** and the **Client / Executive Summarized View**.

### A. Client / Executive Summarized View (`Mode = SUMMARY`)
A clean, high-level overview designed for management, buyers, or clients to review seasonal batching efficiency:

1. **Summary Cards / Metric Bar:**
   * **Total Pending Sample Styles:** Count of un-grouped sample requests.
   * **Active Batches / Group IDs:** Total active consolidated groups for the selected Season.
   * **Consolidated Fabric Required (Kg):** Net weight needed across all grouped styles.
   * **Purchased Batch Weight (Kg):** Total weight adjusted for market MOQ (e.g. 60 kg batches).
   * **Efficiency / Waste Saved (%):** Financial saving achieved by batching.

2. **Group Batch Summary Table:**
   | Group ID | Season - Year | Included Styles Count | Shared Fabric / Yarn Type | Net Style Weight (Kg) | MOQ Order Qty (Kg) | Group Status | Actions |
   |---|---|---|---|---|---|---|---|
   | `GRP-SS26-001` | SS 2026 | 8 Styles | 100% Cotton 34's Single Jersey | 14.5 Kg | 60.0 Kg (1 Bag) | `YARN_PO_RAISED` | [View Styles] [Print IW] |
   | `GRP-SS26-002` | SS 2026 | 5 Styles | 95/5 Cotton Spandex 2x2 Rib | 8.2 Kg | 25.0 Kg | `FABRIC_RECEIVED` | [View Styles] [Distribute] |

---

### B. Developer / Operations Detailed View (`Mode = DETAILED`)
Full operational grid with multi-select capability for sample department planners:

1. **Filter Controls Bar:**
   * `[ Season - Year Dropdown ]` (e.g., `SS 2026`, `AW 2026`)
   * `[ Buyer / Agent Filter ]`
   * `[ Yarn Count / Blend Filter ]` (e.g., `34's Cotton`, `2/30's Acrylic`)
   * `[ Fabric Category ]` (e.g., `Single Jersey`, `Rib`, `Fleece`)
   * `[ Grouping Status ]` (`UNGROUPED`, `GROUPED`, `ALL`)

2. **Un-Grouped Style Candidates Grid (Multi-Select):**
   * Multi-select Checkbox Column (`[x]`)
   * Sample Request ID (`SMP-2026-0042`)
   * Style No & Image Thumbnail
   * Buyer Name
   * Garment Component (Body, Rib, Collar)
   * Fabric Structure & GSM
   * Sample Quantity (Pcs)
   * Computed Net Fabric Weight (Kg)
   * Action Button: **`[ + Create New Group with Selected (X) Styles ]`** or **`[ + Add to Existing Group ID ▾ ]`**

---

## 4. Backend Database Schema

### Table: `sample_product_groups`
```sql
CREATE TABLE sample_product_groups (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_code VARCHAR(50) UNIQUE NOT NULL, -- e.g. GRP-SS26-001
    season_id VARCHAR(20) NOT NULL,
    year INT NOT NULL,
    yarn_blend VARCHAR(100),
    fabric_structure VARCHAR(100),
    net_required_weight_kg NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    moq_purchased_weight_kg NUMERIC(10,2) NOT NULL DEFAULT 0.00,
    status VARCHAR(30) NOT NULL DEFAULT 'DRAFT', -- DRAFT, APPROVED, PO_RAISED, FABRIC_RECEIVED, COMPLETED
    created_by UUID REFERENCES users(id),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

### Table: `sample_group_items`
```sql
CREATE TABLE sample_group_items (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    group_id UUID REFERENCES sample_product_groups(id) ON DELETE CASCADE,
    sample_entry_id UUID NOT NULL, -- Link to Sample Entry
    style_id UUID NOT NULL,
    component_name VARCHAR(50) NOT NULL, -- e.g. Body, Rib
    sample_qty_pcs INT NOT NULL,
    calculated_weight_kg NUMERIC(10,3) NOT NULL,
    allocated_fabric_kg NUMERIC(10,3),
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);
```

---

## 5. Calculation Rules & Logic (`calc.ts`)

1. **Net Group Weight Aggregation:**
   $$\text{Net Required Weight (Kg)} = \sum_{i=1}^{n} \text{Sample Style Component Weight}_i$$

2. **Market MOQ Batch Rounding Rule:**
   $$\text{MOQ Order Weight (Kg)} = \begin{cases} 
   \text{Market MOQ (60.0 Kg)} & \text{if } \text{Net Required Weight} \le 60.0 \text{ Kg} \\
   \lceil \frac{\text{Net Required Weight}}{\text{Batch Size (30.0)}} \rceil \times 30.0 & \text{if } \text{Net Required Weight} > 60.0 \text{ Kg}
   \end{cases}$$

3. **Material Redistribution on Receipt:**
   When fabric is delivered from dyeing to the sample room, the exact net weight per sample style is released for cutting:
   $$\text{Released Cutting Weight}_i = \text{Sample Style Weight}_i \times (1 + \text{Sample Cutting Waste \%})$$
   *The remaining excess balance remains in the Sample Fabric Stock for future lab tests or re-makes.*

---

## 6. Implementation Checklist for Developers

- [ ] Create PostgreSQL migrations for `sample_product_groups` and `sample_group_items`.
- [ ] Build API endpoints:
  - `GET /api/v1/samples/ungrouped` (Fetch styles matching yarn/fabric filters).
  - `POST /api/v1/samples/groups` (Create new style group).
  - `GET /api/v1/samples/groups/summary` (Fetch client/management summary metrics).
- [ ] Implement UI toggle switch on Grouping Screen (`Client Summary` vs `Detailed Operations Grid`).
- [ ] Implement MOQ auto-rounding calculation helper in `calc.ts`.
- [ ] Connect Group ID creation event to trigger Internal Work Order (`IW`) generation for Yarn & Knitting.
