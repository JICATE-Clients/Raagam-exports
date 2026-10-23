Here is a step-by-step analysis focused **strictly on the exact workflow points** you specified, detailing how each requirement functions within the system design:

---

### **1. Digital Handoff: Requirement Sheet & T&A to Purchase Manager**
* **Digital Work Queue:** Once the Merchandiser completes the Requirement Sheet and sets the Time & Action (T&A) plan target dates, the requirement automatically routes to the **Purchase Manager’s digital login queue**.
* **Paperless Transition:** Eliminates physical paper printouts and manual hand-offs, giving the Purchase Manager immediate visibility of pending items and target fulfillment dates.

---

### **2. Vendor Master to Purchase Selection Filtering**
* **Master Configuration:** In Vendor Master, suppliers are flagged with parameters such as **`Is Bought Item Vendor`** and categorized under specific **Item Classes** (e.g., Sewing Thread, Yarn, Trims).
* **Dynamic PO Filtering:** During PO creation, the supplier dropdown dynamically filters to display **only vendors mapped to the selected item category**, hiding irrelevant master entries.

---

### **3. RE Number Selection & Item Auto-Fetching**
* **First Step Selection:** The user selects the **RE (Requirement Entry) Number** first in the interface.
* **Automated Data Retrieval:** The system automatically fetches all associated item names, specifications, Purchase UOM, and balance required quantities directly from the approved requirement sheet.

---

### **4. Multi-Order & Multi-Item Consolidation with Rate & GST Entry**
* **Consolidated PO:** A single vendor PO supports selecting **multiple RE / Order numbers** and **multiple items** under each RE number.
* **Manager Data Input:** Item details and quantities are locked and auto-populated; the Purchase Manager only inputs the **negotiated unit rate** and selects applicable **GST tax structures**.

---

### **5. Vendor Delivery Date & Performance Rating**
* **Promised Date Tracking:** The Purchase Manager enters a promised **Delivery Date** per item line.
* **Supplier Rating:** The system tracks vendor lead times and calculates on-time delivery performance ratings based on compliance with this target date.

---

### **6. Quantity Controls (No Excess Quantity Allowed)**
* **Strict Balance Cap:** The system enforces strict validation and **blocks entering excess quantities** above the balance required quantity.

---

### **7. Budget Rate Hiding & Above-Budget Alert**
* **Hidden Budget Rate:** To preserve negotiation leverage, the approved budget rate remains hidden from the Purchase Manager during rate entry.
* **Warning Message:** If the entered rate exceeds the approved budget rate, the system immediately displays an alert message: **"Above Approved Budget"**.

---

### **8. MD Escalation & Profit & Loss Impact**
* **Draft Lock:** An above-budget PO can be saved as a draft, but document generation and printing remain strictly locked.
* **MD Approval Routing:** The order automatically escalates to the **Managing Director (MD) Approval Screen**.
* **Financial Impact View:** The approval screen displays the exact variance in **Profit & Loss**, highlighting how much overall order profit will decrease due to the higher purchase rate.

---

### **9. MD Decision Workflow (Approve, Reject, Cancel, Revise)**
* **Approval Actions:** The MD can choose to **Approve**, **Reject**, **Cancel**, or send for **Revision**.
* **Requirement Reset:** If the PO is cancelled or rejected, the system re-opens the requirement balance so a new PO can be created.

---

### **10. Digital Signature & Authorized Document Release**
* **Approver Verification:** Upon authorization, the system records the approver's **Name / User ID** and embeds their **Digital Signature image** directly onto the PO signature block.
* **Printout Unlock:** Final PDF printing and vendor dispatch are enabled **only after formal digital approval** is completed.

---

### **ATM-Style Single-Screen Purchase Order (PO) Interface**

This single-screen interface is designed like an ATM touch-screen — zero manual typing of descriptions or specifications, automatic data-fetching, and a guided 3-click flow so **anyone can raise a PO without training or guidance**.

---

### **1. Visual UI Screen Layout (Wireframe)**

```
┌────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│  PURCHASE ORDER CREATION                                                     [ 🟢 LOCAL ]  [ IMPORT ]  │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│  STEP 1: SELECT RE / ORDER NUMBER                                                                      │
│  ┌──────────────────────────────────────────┐     ┌─────────────────────────────────────────────────┐  │
│  │ RE / Order No: [ RE/2627/2120   ▼ ]      │     │ Vendor Name:   [ SIVARAJ SPINNING MILLS  ▼ ]    │  │
│  └──────────────────────────────────────────┘     └─────────────────────────────────────────────────┘  │
│  (Auto-fetches required items from T&A)     (Filtered by "Is Bought Item Vendor" & Class)  │
│                                                                                                        │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│  STEP 2: ITEM & QUANTITY DETAILS (Auto-Populated Grid)                                        │
│  ┌──────┬──────────────┬────────────────────────────┬──────────────┬──────────────┬─────────────────┐  │
│  │ RE   │ Item Class   │ Description & Size         │ Purchase UOM │ Req. Balance │ Order Qty       │  │
│  ├──────┼──────────────┼────────────────────────────┼──────────────┼──────────────┼─────────────────┤  │
│  │ 2120 │ SEWING THREAD│ 3-PLY DTM / CONE (SIZE: M) │ CONE     │ 220.00       │ [ 220.00     ]  │  │
│  │ 2120 │ LABELS       │ MAIN LABEL (SIZE: L)       │ PACKS    │ 5,261.00     │ [ 5,261.00   ]  │  │
│  │ 2121 │ TWILL TAPE   │ COTTON TAPE (DYEING PROC)  │ ROLLS │ 1,000.00     │ [ 1,000.00   ]  │  │
│  └──────┴──────────────┴────────────────────────────┴──────────────┴──────────────┴─────────────────┘  │
│  ⚠️ Excess quantity blocked automatically                                                      │
│                                                                                                        │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                                                                                                        │
│  STEP 3: COMMERCIALS & DELIVERY DATES                                                         │
│  ┌─────────────────────────────┬──────────────────────────────┬─────────────────────────────────────┐  │
│  │ Negotiated Unit Rate (₹)    │ GST Tax Structure            │ Promised Delivery Date              │  │
│  ├─────────────────────────────┼──────────────────────────────┼─────────────────────────────────────┤  │
│  │ [ ₹ 75.00 / Cone      ]     │ [ CGST 2.5% + SGST 2.5% ▼ ]  │ [ 2026-10-30             📅 ]        │  │
│  └─────────────────────────────┴──────────────────────────────┴─────────────────────────────────────┘  │
│  (Budget rate is hidden to protect negotiation)       (Tracks Supplier Performance Rating)│
│                                                                                                        │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  SYSTEM STATUS / ALERTS                                                                                │
│  [ ⚠️ ALERT: Rate exceeds approved budget! Sent for MD Approval on save. ]                          │
├────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│  ACTION BUTTONS                                                                                        │
│                                           [ 💾 SAVE AS DRAFT ]    [ 📤 SUBMIT FOR APPROVAL / PO ]      │
└────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

---

### **2. How the "3-Click" Simple Workflow Works**

#### **Step 1: Select RE / Order & Vendor (Filtered)**
1. **PO Mode Selection:** Toggle between **Local (INR)** or **Import** (prompts for Foreign Currency & Exchange Rate).
2. **Select RE Number:** The user selects the **Requirement Entry (RE) / Order Number** first. 
3. **Auto-Filtered Vendor Dropdown:** The Vendor dropdown shows **only suppliers mapped to that item category** based on Vendor Master settings (`Is Bought Item Vendor` flag and Item Class like *Sewing Thread*, *Yarn*, or *Trims*).

#### **Step 2: Review Auto-Fetched Items & Enter Quantity**
1. **Auto-Fetched Details:** System instantly loads Item Description, Size Breakup, Process Details (e.g. *Dyeing for Twill Tape*), and official **Purchase UOM** (*Cones, Bags, Rolls, Kg* instead of consuming meters).
2. **Multi-Order & Multi-Item Support:** A single PO can consolidate **multiple RE numbers** and **multiple items** under the same supplier.
3. **Quantity Control:** The user enters the required **Order Quantity**. The system enforces a hard cap and **blocks entering excess quantity** beyond the balance required.

#### **Step 3: Enter Negotiated Rate, GST & Promised Delivery Date**
1. **Rate Entry:** The Purchase Manager enters the negotiated unit rate.
   * *Hidden Budget Rate:* The approved budget rate is intentionally hidden from the screen so the user does not leak the target price to suppliers.
2. **GST Selection:** Selects the applicable GST tax slab from the master dropdown (e.g. *CGST + SGST* or *IGST*).
3. **Promised Delivery Date:** User selects the committed delivery date, which the system tracks to compute the **Vendor On-Time Delivery Rating**.

---

### **3. Built-In Safeguards & Approval Automation**

```
                     ┌─────────────────────────────────────────┐
                     │         USER CLICKS "SUBMIT PO"         │
                     └────────────────────┬────────────────────┘
                                          │
                             Is Rate ≤ Approved Budget?
                                          │
                       ┌──────────────────┴──────────────────┐
                       ▼                                     ▼
                   [ YES ]                                [ NO ]
                       │                                     │
           Direct System Approval             Shows "Above Approved Budget" Alert
                       │                                     │
         Attaches Digital Signature         Saves Draft & Blocks Printout
                       │                                     │
             PO Ready for Printing              Escalates to MD Approval Dashboard
                                                (Displays Profit & Loss Impact)
                                                             │
                                            ┌────────────────┼────────────────┐
                                            ▼                ▼                ▼
                                      [ APPROVE ]       [ REVISE ]       [ CANCEL ]
                                            │                │                │
                                      Digital Sig      Compulsory        Requirement
                                       Attached &      Reason Entry        Balance
                                      PO Released      Required      Reset
```

* **Above-Budget Alert:** If the entered rate is higher than the approved budget, the screen alerts **"Above Approved Budget"**.
* **Draft Lock:** The PO is saved as a draft, but printing and vendor issuance remain locked.
* **MD Approval & Profit Impact:** Automatically routes to the MD Approval Screen, showing the exact **Profit & Loss reduction** caused by the rate increase.
* **Digital Signature Attachment:** Once approved by management, the approver's **Name/User ID** and **Digital Signature image** are automatically attached to the signature block, unlocking PDF generation.

---
