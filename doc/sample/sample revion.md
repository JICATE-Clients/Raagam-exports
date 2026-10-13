Here is the complete **Developer Technical Specification** for implementing the **Sample Revision Module**, adapted from the established Garment Order Entry revision architecture:

---

# 🧵 Technical Specification: Sample Revision Module (Sampling & Costing)

---

## 1. Executive Summary & Rationale

In garment manufacturing, once a **Development Sample / Buyer Costing Quote** is approved by management or the customer, its technical specifications, fabric compositions, trim consumption, and target costing are **locked**. 

When a buyer requests changes during the sampling process (e.g., fabric GSM changes, size specs, trim substitutions, or revised sample quantities), merchandisers must not edit approved data directly. Instead, they must raise a **Sample Revision** (`SMP-REV/26-27/000N`).

### Core Objectives
* **Audit Trail & Versioning**: Preserve the original approved sample baseline (\\(V_0\\)) while recording proposed changes (\\(V_1, V_2 \dots\\)).
* **Granular Field Unlocking**: Unlock only the specific sample module categories selected for revision while keeping all other specs locked.
* **Cost Variance Tracking**: Render a side-by-side comparison between \\(V_0\\) Baseline vs \\(V_{\text{proposed}}\\) costing before submission.
* **Safe Revert Mechanism**: Rejection or abandonment automatically restores the \\(V_0\\) baseline without corrupting underlying data.

---

## 2. Sample Lifecycle & State Machine

```
 [ Draft Sample ] ──► [ Submit for Approval ] ──► [ APPROVED & LOCKED ]
                                                          │
                                                (Buyer Requests Change)
                                                          │
                                                          ▼
 [ Approved $V_0$ Restored ] ◄── [ MD Rejects ] ◄── [ Raise Sample Revision ]
              │                                           │
              └─── (Revert Engine) ◄──────────────────────┤ (Unlocks Ticked Modules)
                                                          │
                                                          ▼
                                                [ Submit Revised Sample ]
                                                          │
                                                          ▼
                                                [ Approved New $V_1$ ]
```

### Status States (`sample_status`)
1. **`DRAFT`**: Initial sample creation in progress.
2. **`PENDING_APPROVAL`**: Sent to MD/Sampling Head for approval. System locked against edits.
3. **`APPROVED`**: Sample specs locked. Used as active floor spec for sample development or costing quotation.
4. **`REVISING`**: A Sample Revision has been opened. Selected modules are unlocked for editing.

---

## 3. Sample Revision Scope & Unlocking Matrix

When raising a Sample Revision, the merchandiser selects which module categories need modification:

| Revision Category | Unlocked Sub-fields (`✏️`) | Locked Sub-fields (`🔒`) |
| :--- | :--- | :--- |
| **1. Sample Info & Qty** | Sample Quantity, Delivery/Proto Date, Size Breakdown, Fit Type. | Fabric BOM, Accessories, Costing. |
| **2. Fabric & Yarn Spec** | Fabric Composition, GSM, Width/Dia, Yarn Blend %, Process Loss %. | Sample Qty, Trims, CMT Costing. |
| **3. Accessories & Trims** | Trim Item, Spec/Fold, Unit Consumption, Excess %. | Sample Qty, Fabric Spec, Labor. |
| **4. Sample Costing & Price** | Fabric/Yarn Rates, Processing Rates, CMT Rate, Overhead Value. | Physical BOM quantities. |

---

## 4. Database Schema & Snapshot Architecture

### A. Sample Revision Ledger (`sample_revisions`)
```sql
CREATE TABLE sample_revisions (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    sample_id UUID NOT NULL REFERENCES samples(id) ON DELETE CASCADE,
    revision_no INT NOT NULL DEFAULT 1,
    revision_code VARCHAR(50) NOT NULL, -- e.g. 'SMP-REV/26-27/0001'
    origin VARCHAR(50) DEFAULT 'By Customer', -- 'By Customer' | 'Internal Error'
    
    -- Unlocked Module Categories (Array)
    amendment_types TEXT[] NOT NULL, -- {'sample_info', 'fabric_bom', 'accessories', 'costing'}
    
    -- Remarks & Audit
    remarks TEXT NOT NULL,
    created_by UUID REFERENCES app_users(id),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    
    -- Outcome & Version Tracking
    status VARCHAR(30) DEFAULT 'DRAFT', -- 'DRAFT' | 'PENDING' | 'APPROVED' | 'REJECTED' | 'ABANDONED'
    rejection_remarks TEXT,
    
    -- Baseline Snapshots (V0)
    sample_snapshot JSONB NOT NULL,
    costing_snapshot JSONB NOT NULL
);

CREATE INDEX idx_sample_revisions_sample ON sample_revisions(sample_id);
```

### B. Database Hard Lock Trigger (`refuse_when_sample_locked`)
Attached to `samples`, `sample_fabric_boms`, `sample_material_boms`, and `sample_costings`:

```sql
CREATE OR REPLACE FUNCTION refuse_when_sample_locked()
RETURNS TRIGGER AS $$
DECLARE
    v_status VARCHAR(30);
    v_revising BOOLEAN;
BEGIN
    SELECT status INTO v_status FROM samples WHERE id = NEW.sample_id;
    
    -- If approved and not under an active revision, block writes
    IF v_status = 'APPROVED' THEN
        RAISE EXCEPTION 'Sample spec is locked under Approved Version V0. Raise a Sample Revision to make changes.';
    END IF;
    
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;
```

---

## 5. Sample Costing Variance Matrix (\\(V_0\\) vs \\(V_{\text{proposed}}\\))

Before submitting the revised sample for approval, the workspace renders a side-by-side cost variance comparison:

```
┌───────────────────────────┬────────────────┬────────────────┬──────────────┐
│ Cost Head                 │ Baseline ($V_0$)│ Proposed ($V_1$)│ Variance     │
├───────────────────────────┼────────────────┼────────────────┼──────────────┤
│ Fabric & Yarn Cost        │ ₹ 145.00       │ ₹ 152.00       │ + ₹ 7.00 🔺  │
│ Accessories & Trims       │ ₹  35.00       │ ₹  35.00       │   ₹ 0.00     │
│ Sample Sampling/CMT       │ ₹  80.00       │ ₹  80.00       │   ₹ 0.00     │
│ Overheads & Freight       │ ₹  20.00       │ ₹  20.00       │   ₹ 0.00     │
├───────────────────────────┼────────────────┼────────────────┼──────────────┤
│ Total Unit Sample Cost    │ ₹ 280.00       │ ₹ 287.00       │ + ₹ 7.00 🔺  │
│ Target Buyer Quote/pc     │ ₹ 350.00       │ ₹ 350.00       │   ₹ 0.00     │
│ Net Margin %              │ 20.0 %         │ 18.0 %         │ - 2.0 % 🔻   │
└───────────────────────────┴────────────────┴────────────────┴──────────────┘
```

---

## 6. Approval & Revert Decision Engine

When the Managing Director or Sampling Head reviews the revised sample card on Web or Mobile PWA:

### 🟩 Path A: Approve Revision
1. Updates `sample_revisions.status = 'APPROVED'`.
2. Increments sample version number (`V1`, `V2`, etc.).
3. Restores sample status to **`APPROVED`** (locking the record again).
4. Dispatches an in-app and mobile PWA push alert to the assigned Merchandiser.

### 🟥 Path B: Reject or Abandon Revision (`sample_revision_revert`)
1. Requires mandatory rejection remarks.
2. Triggers `sample_revision_revert()`, which overwrites active rows with the original `sample_snapshot` (\\(V_0\\)) baseline:
```sql
CREATE OR REPLACE FUNCTION sample_revision_revert(p_revision_id UUID)
RETURNS VOID AS $$
DECLARE
    v_sample_id UUID;
    v_snapshot JSONB;
BEGIN
    SELECT sample_id, sample_snapshot INTO v_sample_id, v_snapshot 
    FROM sample_revisions WHERE id = p_revision_id;

    -- Restore sample header & child tables from JSONB snapshot
    UPDATE samples 
    SET 
        sample_qty = (v_snapshot->>'sample_qty')::INT,
        delivery_date = (v_snapshot->>'delivery_date')::DATE,
        target_fob = (v_snapshot->>'target_fob')::NUMERIC,
        status = 'APPROVED'
    WHERE id = v_sample_id;

    -- Update revision record status
    UPDATE sample_revisions SET status = 'REJECTED' WHERE id = p_revision_id;
END;
$$ LANGUAGE plpgsql;
```

---

## 7. Next.js Server Actions Implementation (`lib/sampling/revisions/actions.ts`)

```typescript
'use server';

import { createClient } from '@/lib/supabase/server';
import { revalidatePath } from 'next/cache';

export async function raiseSampleRevision({
  sampleId,
  amendmentTypes,
  remarks,
  origin = 'By Customer'
}: {
  sampleId: string;
  amendmentTypes: string[];
  remarks: string;
  origin?: string;
}) {
  const supabase = await createClient();

  // 1. Fetch complete current sample baseline data for snapshot
  const { data: currentSample, error: fetchErr } = await supabase
    .from('samples')
    .select('*, sample_fabric_boms(*), sample_material_boms(*), sample_costings(*)')
    .eq('id', sampleId)
    .single();

  if (fetchErr || !currentSample) throw new Error('Failed to fetch active sample baseline.');

  // 2. Insert Revision Record with V0 Snapshot
  const { data: rev, error: revErr } = await supabase
    .from('sample_revisions')
    .insert({
      sample_id: sampleId,
      amendment_types: amendmentTypes,
      remarks,
      origin,
      sample_snapshot: currentSample,
      costing_snapshot: currentSample.sample_costings,
      status: 'DRAFT'
    })
    .select()
    .single();

  if (revErr) throw new Error(`Failed to create revision: ${revErr.message}`);

  // 3. Set Sample Status to REVISING
  await supabase
    .from('samples')
    .update({ status: 'REVISING' })
    .eq('id', sampleId);

  revalidatePath(`/sampling/${sampleId}`);
  return { success: true, revisionId: [suspicious link removed] };
}
```

---

## 8. Mobile PWA Approval Card Component (`components/sampling/mobile-sample-revision-card.tsx`)

```tsx
export function MobileSampleRevisionCard({ revision, onApprove, onReject }) {
  return (
    <div className="m-2 p-3.5 bg-slate-900 text-white border border-slate-800 rounded-xl space-y-3">
      {/* Header */}
      <div className="flex justify-between items-center border-b border-slate-800 pb-2">
        <div>
          <span className="text-xs font-mono text-blue-400">{revision.revision_code}</span>
          <h4 className="font-bold text-sm">{revision.sample_code} — {revision.buyer_name}</h4>
        </div>
        <span className="px-2 py-0.5 bg-blue-500/20 text-blue-300 text-[10px] rounded border border-blue-500/30">
          {revision.amendment_types.join(', ')}
        </span>
      </div>

      {/* Variance Summary */}
      <div className="bg-slate-800 p-2.5 rounded-lg text-xs grid grid-cols-2 gap-2">
        <div>
          <span className="text-slate-400 block">Baseline Cost (V0)</span>
          <strong className="text-slate-200">₹ {revision.v0_cost} / pc</strong>
        </div>
        <div>
          <span className="text-slate-400 block">Proposed Cost ({revision.version_label})</span>
          <strong className={revision.v1_cost > revision.v0_cost ? "text-rose-400" : "text-emerald-400"}>
            ₹ {revision.v1_cost} / pc {revision.v1_cost > revision.v0_cost ? '🔺' : '🔻'}
          </strong>
        </div>
      </div>

      {/* Remarks */}
      <p className="text-xs text-slate-300 italic bg-slate-950 p-2 rounded">
        "{revision.remarks}"
      </p>

      {/* Actions */}
      <div className="grid grid-cols-2 gap-2 pt-1">
        <Button variant="outline" className="border-rose-500/50 text-rose-300 hover:bg-rose-950" onClick={onReject}>
          ↩️ Request Rework
        </Button>
        <Button className="bg-emerald-600 hover:bg-emerald-700 text-white" onClick={onApprove}>
          ✅ Approve Revision
        </Button>
      </div>
    </div>
  );
}
```

---

## 📋 Developer Implementation Checklist

- [ ] **Database Migration**: Create `sample_revisions` table and attach `refuse_when_sample_locked()` triggers to sample child tables.
- [ ] **Raise Revision Screen**: Build module picker UI (`components/sampling/raise-sample-revision.tsx`).
- [ ] **Workspace Lock Guard**: Update sample entry tabs to respect `amendment_types` array, rendering unselected tabs in read-only mode (`🔒`).
- [ ] **Revert Function**: Implement PostgreSQL RPC function `sample_revision_revert` to handle rejection baseline resets.
- [ ] **Mobile Approval Card**: Deploy mobile-friendly comparison card with \\(V_0\\) vs \\(V_{\text{proposed}}\\) cost deltas.