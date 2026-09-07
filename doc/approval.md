DEVELOPER HANDOVER: END-TO-END APPROVALS ENGINE SPECIFICATIONThis specification serves as the complete, developer-ready blueprint for building the Approval Master and Transaction Ledger. It details how the 16 technical approvals are defined globally, mapped to individual buyers, executed by merchandisers, version-controlled during reworks, and integrated with safety locks and the Time & Action (T&A) scheduling engine.1. ARCHITECTURAL FLOW OVERVIEWThe approvals module operates on a three-tiered system to ensure flexibility without causing operational bloat for data entry:┌─────────────────────────────────┐
│   Global Approvals Dictionary   │  ◄── Master list of all 16 technical milestones
└────────────────┬────────────────┘
                 │
                 ▼
┌─────────────────────────────────┐
│     Customer Policy Mapping     │  ◄── Defines which approvals are active per buyer
└────────────────┬────────────────┘      and sets default review/approval lead times
                 │
                 ▼
┌─────────────────────────────────┐
│    Order Transaction Ledger     │  ◄── Live tracking table created per order
└─────────────────────────────────┘      with Sent/Approved states, Diffs, & S3 links
2. THE 16 GLOBAL TECHNICAL APPROVALS DICTIONARYThese represent the standard technical check-points across the product lifecycle. They are stored in a master lookup database table (approval_milestones_master):S.NoMilestone CodeMilestone NameResponsible Department1SIZE_SETSIZE SET APPROVALMERCHANDISING2LAB_DIPLAB DIP APPROVALMERCHANDISING3FIT_SAMPLEFIT SAMPLE APPROVALMERCHANDISING4STRIKE_OFFSTRIKE OFF APPROVALMERCHANDISING5TRIMS_APPROVALTRIMS APPROVALMERCHANDISING6PP_SAMPLEPP SAMPLE APPROVALMERCHANDISING7PILOT_RUNPILOT RUN APPROVALMERCHANDISING8SHIPMENT_SAMPLESHIPMENT SAMPLE APPROVALMERCHANDISING9FABRIC_LAB_TESTFABRIC LAB TEST APPROVALMERCHANDISING10WHITE_SEALWHITE SEAL SAMPLE APPROVALMERCHANDISING11BLACK_SEALBLACK SEAL SAMPLE APPROVALMERCHANDISING12GOLD_SEALGOLD SEAL SAMPLE APPROVALMERCHANDISING13BASE_HANGERBASE HANGER APPROVALMERCHANDISING14BULK_HANGERBULK HANGER APPROVALMERCHANDISING15FPT_TESTINGFPT TESTING APPROVALMERCHANDISING16GPT_TESTINGGPT TESTING APPROVALMERCHANDISING3. CUSTOMER-WISE POLICY MAPPINGRather than forcing every order to track all 16 approvals, the system uses a customer-wise policy mapper in the Customer Buyer Master1:Policy Toggles: The administrator selects which of the 16 approvals are mandatory for each specific buyer1.Lead Time Configuration: For each active approval, the master stores the Customer Review Days (the duration the buyer's team takes to return their verdict on a sample)23. For example, Buyer Roja might require 4 days for a PP Sample review, while Buyer Roja's Fit Sample review might take 7 days23.4. ORDER ENTRY TRANSACTION LEDGERWhen a new style or order is created and saved, the backend automatically instantiates the Order Approval Ledger (order_approval_ledger) based on the active buyer's policy settings14:4.1 Real-Time Execution StatesThe merchandiser does not track piece quantities here5. Instead, they log real-time progress through the following transaction fields56:Sent Date: The date the physical sample (or laboratory test certificate) was dispatched/couriered to the buyer5.File Uploader: A file attachment field (uploaded_file_url) to upload tech packs, courier receipts, or inspection documents5.Approval Status: A dropdown selection supporting four distinct states:PENDING: Awaiting sample dispatch.SENT: Sample dispatched; awaiting buyer feedback5.APPROVED: Green-lighted by the buyer6.REWORK: Rejected or returned for revisions6.4.2 The Version-Controlled "Rework" LoopIf a sample is rejected and marked as REWORK6:The system freezes the current record as Version 1 in an archive log to preserve the historical audit trail.The system increments the active_version integer on the live transaction row (e.g., from 1 to 2).The system clears the Sent Date and resets the Approval Status back to PENDING to track the second submission attempt.The system makes the Remarks/Comments input text area strictly mandatory in the UI to capture the buyer's exact feedback (e.g., "Sleeve width too narrow, revise pattern")6.5. SYSTEM INTEGRATION & BUSINESS RULES5.1 The T&A Backward Scheduling IntegrationThe approvals engine directly drives the Time & Action (T&A) calendar date generation7:PP Sample Approval Date is pinned to exactly 1 day before the Cutting Start Date8more_horiz.PP Sample Send Date is calculated dynamically by subtracting the customer's master review days from the target approval date: $$\text{PP Send Date} = \text{PP Approval Date} - \text{Customer Master Approval Days}$$ This calculation runs automatically on save, immediately establishing dispatch target dates for the merchandising team211.5.2 The Cutting Room Safety LockTo prevent raw fabric wastage before the design is signed off:Hardlock Rule: If the PP_SAMPLE milestone in order_approval_ledger does not hold an APPROVED status, the system strictly blocks the cutting room interface from generating fabric cut sheets or starting production4.6. PROPOSED DATABASE TABLE SCHEMAS (POSTGRESQL)To implement this decoupled ledger, developers should deploy the following database schema:-- 1. Global dictionary of approvals
CREATE TABLE approval_milestones_master (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    approval_code VARCHAR(30) UNIQUE NOT NULL,
    approval_name VARCHAR(100) NOT NULL,
    responsible_department VARCHAR(50) DEFAULT 'MERCHANDISING',
    created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- 2. Customer buyer master mapping policy table
CREATE TABLE customer_approval_settings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_id UUID NOT NULL REFERENCES customer_buyer_master(id) ON DELETE CASCADE,
    approval_master_id UUID NOT NULL REFERENCES approval_milestones_master(id) ON DELETE CASCADE,
    is_mandatory BOOLEAN DEFAULT TRUE,
    review_lead_time_days INT NOT NULL DEFAULT 5, -- Days the buyer takes to review samples
    CONSTRAINT uq_customer_approval UNIQUE (customer_id, approval_master_id)
);

-- 3. Live order transaction tracking table
CREATE TYPE approval_status_enum AS ENUM ('PENDING', 'SENT', 'APPROVED', 'REWORK');

CREATE TABLE order_approval_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    order_id UUID NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
    approval_master_id UUID NOT NULL REFERENCES approval_milestones_master(id) ON DELETE CASCADE,
    target_send_date DATE NOT NULL,
    target_approval_date DATE NOT NULL,
    actual_send_date DATE,
    actual_status_date DATE,
    approval_status approval_status_enum DEFAULT 'PENDING',
    uploaded_file_url TEXT, -- Link to S3 storage for tech packs/slips
    remarks TEXT,           -- Mandatory text if status is REWORK
    updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT uq_order_approval_milestone UNIQUE (order_id, approval_master_id)
);
