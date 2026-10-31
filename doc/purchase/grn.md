Here is the complete functional specification and developer implementation plan for the **GRN Receiving Screen**, **Bin Master & Labeling**, **Digital Live Board**, and **Unified Approvals Logic**.

---

### 1. 🔍 **GRN Receiving Screen (Conditional Filter Cascade)**

The new **GRN Receiving / Material Receipt** screen uses the exact same dependent filter sequence as the Raise PO screen to quickly narrow down pending deliveries:

```
[ Group Type ] ➔ [ Customer / Buyer ] ➔ [ Vendor ] ➔ [ Item Class ] ➔ [ RE / Order Number ]
```

* **Group Type:** `RE` (Regular Order), `SWO` (Sample), `IWO` (Internal), or `General` (Non-order / Overhead) [125, 129, 139–140].
* **Customer / Buyer:** Filters orders belonging to the selected Buyer.
* **Vendor:** Lists only vendors with pending dispatched POs for that Buyer/Group.
* **Item Class (Dependent Condition):** Automatically lists **only** the item classes (*Yarn*, *Fabric*, *Trims*, *Packaging*) present in the selected vendor's active pending POs [18, 95, 124, 130, 280–281].
* **RE / Order Number (Dependent Condition):** Populates the RE numbers that have pending inward deliveries under the selected Vendor and Item Class [18, 112–114, 129, 159].

---

### 2. 📦 **GRN Processing, Rejections & Replacement Workflow**

#### **A. Inwarding & Receipt Report**
* **Inward Capture:** Purchase Manager enters Vendor Invoice No. / Delivery Challan (DC) No., Invoice Date, Received Qty/Weight, and select the target **Bin** [67, 114–116, 435–438].
* **GRN Report:** Displays received history, pending balances, invoice matching status, and age of stock [68–69, 76, 81–84, 113].

#### **B. Rejection & Debit Note Workflow**
When goods fail Quality Check (QC):
1. **Stock Categorization:** Mark received line items as **`Rejected`** [71, 73, 115, 338–339].
2. **Automated Debit Note:** System automatically generates a **Debit Note** tied to the Vendor's Invoice for the rejected amount [72–73].
3. **Rejection Delivery Challan:** Generates a **Rejection DC** to send materials back to the vendor alongside the Debit Note copy.
4. **Reopens Requirement:** The rejected quantity is automatically added back to the order's pending requirement list, allowing a fresh PO to be raised [73–74].

#### **C. Replacement Delivery Workflow**
1. Vendor sends replacement material for previously rejected stock [74–75].
2. Store inward receives it under **`Replacement GRN`** (adjusting stock without generating duplicate financial invoice entries).

---

### 3. 🏷️ **Unit & Store-Wise Bin Master + Customized Labels**

#### **A. Multi-Unit & Multi-Store Bin Architecture**
In the Master configuration, Bins are strictly mapped by **Unit** and **Store**:
* **Unit Hierarchy:** `Raagam HO`, `Unit 2`, and `Unit 3`.
* **Store Hierarchy:** Main Material Store, Yarn Store, Fabric Store, Trims Store, General/Stationery Store.
* **Bin Mapping:** Each Bin ID is uniquely assigned to a specific **Unit + Store + Rack + Shelf** (e.g. `HO-TRIM-R01-S02`, `U2-YARN-R04-S01`).

#### **B. Customized Bin Label Generation**
* Printable customized labels generated directly from Bin Master or GRN Receipt:
  * **Label Data:** Unit Name, Store Name, Bin Code, Item Description, Lot/RE Number, QR Code / Barcode.

---

### 4. 📺 **Digital Live Board (Real-Time Bin Details)**

A dedicated full-screen dashboard display for store rooms and factory floors:
* **Live Storage Overview:** Displays occupied vs. empty Bins across `HO`, `Unit 2`, and `Unit 3` in real time.
* **Bin Material Detail:** Clicking/hovering on any Bin reveals stored items, order/RE numbers, received quantities, and stock age (aging analysis in days) [68–69].
* **Movement Feed:** Displays real-time feeds of recently inwarded GRNs and production requisitions dispatched from Bins.

---

### 5. ⚡ **Unified Approvals Logic**

Instead of separate approval screens for every module, all approval actions route to a single **Unified Approvals Screen (`/approvals`)** [308–310, 317–323].

#### **Developer Component Logic (`UnifiedApprovals.tsx`):**
```typescript
interface ApprovalItem {
  id: string;
  approval_type: 'BUDGET_OVERRIDE' | 'PO_APPROVAL' | 'REJECTION_OVERRIDE' | 'SHORTAGE_APPROVAL';
  unit: 'HO' | 'UNIT_2' | 'UNIT_3';
  re_number: string;
  requested_by: string;
  amount_variance?: number;
  details: Record<string, any>;
  status: 'PENDING' | 'APPROVED' | 'REJECTED' | 'REQUEST_REWORK';
}

// Unified Approval Execution
async function handleApprovalAction(item: ApprovalItem, action: 'APPROVE' | 'REJECT', remarks?: string) {
  if (action === 'APPROVE') {
    // 1-Click Approval: Append Digital Signature & Update Status
    await supabase.from('approvals').update({
      status: 'APPROVED',
      approved_by: currentUser.id,
      digital_signature_url: currentUser.signature_url, // Auto-attaches user digital signature
      approved_at: new Date().toISOString(),
      remarks: remarks || 'Approved'
    }).eq('id', item.id);

    showToast(`${item.approval_type} approved successfully.`);
  } else {
    // Rejection requires remark explanation
    openReasonModal(item, action);
  }
}
```

* **Central Routing:** Route tasks based on logged-in user permissions (e.g. MD sees all profit-variance POs and budgets; Store Head sees shortage overrides) [310, 318–323].
* **Digital Signatures:** Automatically applies the approver's uploaded digital signature image to approved PO PDFs [32, 104, 315–316, 323].