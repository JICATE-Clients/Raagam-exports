None selected

Skip to content
Using J.K.K.NATTRAJA Educational Institutions Mail with screen readers

3 of 17,725
Kindly Analyze and Review this Spec File of Raagam Exports
Inbox

Mohanraj V
Attachments
11:32 (3 hours ago)
to me, Director,

Dear Roja Mam,

We have collected nearly 40 percent of the requirements of Raagam ERP through Intent Interview Platform. 

I have attached the spec files of the Raagam export. That plan is to implement these 40 percent collected requirements and then go and collect the left out requirements module wise.

I want you to review this spec file and report to me. I am also making the review from my side. Since it is a big Erp project it is better if more people are involved in the review process.

Once it is reviewed we can start the implementation as per the MD sir's direction.

Warm Regards
--
Mohanraj Venkatesan
Chief Business Officer(CBO),
JICATE Solutions,
JKKN Institutions.
Feel Free to Call @ +91 9842971712
 One attachment
  •  Scanned by Gmail




# specs.md - Raagam Exports
Generated: 2026-04-04T06:10:37.771Z
Status: Interview Complete
Template: generic
Total Questions: 165

---

## Client Brief

▎ We are Raagam Exports, a garment export manufacturer in Tirupur, Tamil Nadu. We need a complete web-based   ERP system to replace our current EDP2 desktop software. The system should cover our entire operation: Sales   and Marketing (opportunities, styles, cost sheets, quotes), Garment Order management with amendments and Time   & Action tracking, Planning (shipment plans, BOMs, budgets, PPMs), Materials Purchase with vendor management   and RFQ process, 5 types of Store Management (Purchase Store, Processing Store, Material Store, Rejection   Store, Surplus Store), Production tracking from Cutting through Sewing to Packing with sewing line management,   Process Planning for knitting and dyeing, Embroidery operations, HR and Payroll for both workers (piece-rate)   and staff (salary) with ESI/PF compliance, Logistics and Export Documentation, and Finance including Payables   with 3-way matching, Receivables with forex management, and General Ledger. We have two production locations   (Head Office and Unit 2) with about 50-100 staff across all departments. Our main customers are NEXT (UK),   ABASIC (Spain), and other European buyers. We export knitted garments like T-shirts, pyjama sets, and dresses.

---

## Feature: Finance
Questions answered: 11

### Success Criteria
- **Q:** How will you know the Finance module is working well — what outcome signals that it's delivering value?
  **A:** [MUST HAVE] Something else... - we need all three options

### Recovery
- **Q:** If a finance entry has an error — say a wrong forex rate for a NEXT payment — how should it be corrected in the system?
  **A:** [MUST HAVE] Only admin can reverse finance entries - admin can give authorization to edit to others also. Admin controls everything

### Sad Path / Error Handling
- **Q:** What is the most common Finance failure that causes either a wrong P&L or a delayed payment at Raagam?
  **A:** [NOT SURE] Something else... - nothing

### Who & When
- **Q:** Who manages Finance at Raagam — and given HO and Unit 2 are separate GST entities, how are the books maintained?
  **A:** [MUST HAVE] Centralized finance with location reporting

### True Goal
- **Q:** Now Finance — covering Payables (vendor payments), Receivables (buyer payments in GBP/EUR), and General Ledger. What is the biggest Finance pain at Raagam today?
  **A:** [MUST HAVE] No real-time P&L per shipment

### Edge Cases
- **Q:** Which unusual Finance scenario must the ERP handle at Raagam?
  **A:** [MUST HAVE] Something else... - we need option 1 and 2.

### Happy Path
- **Q:** This is a critical decision — since all your accounts are in Tally today, should the new ERP **replace Tally completely** or **integrate with it**?
  **A:** [MUST HAVE] Replace Tally completely - But i need to use this data and read it in Tally Prime software

### Connections & Integrations
- **Q:** How should Finance connect to the rest of the ERP — and to Tally Prime? You mentioned keeping the ability to read data in Tally Prime.
  **A:** [MUST HAVE] Both — auto-receives from operations AND exports to Tally Prime

### Current State
- **Q:** How does Raagam manage its accounts today — what tools does the finance team use for books, payables, and receivables?
  **A:** [MUST HAVE] Something else... - Everything is done in Tally now

### UI / Data Display
- **Q:** What is the most important Finance screen for daily work — the one the finance team and MD will use the most?
  **A:** [MUST HAVE] Both — shipment P&L and payables aging as the two most-used Finance screens

### Permissions & Roles
- **Q:** Who should be able to see financial data — especially the shipment P&L which contains sensitive profit margins?
  **A:** [MUST HAVE] Role-based with admin control

---

## Feature: Planning
Questions answered: 11

### Success Criteria
- **Q:** How will you measure success for the Planning module? What outcome tells you the BOM and budgeting system is truly working?
  **A:** [MUST HAVE] Something else... - All  three options are needed to measure the success of the planning module

### Recovery
- **Q:** When an order amendment (like a quantity change from 2,000 to 2,500 pcs) hits an already-approved BOM — what should the system do?
  **A:** [MUST HAVE] Auto-recalculate and alert

### Sad Path / Error Handling
- **Q:** What is the most dangerous planning mistake — the one that cascades into production problems or cost overruns at Raagam?
  **A:** [MUST HAVE] Order quantity changes after BOM is approved

### Who & When
- **Q:** Who at Raagam is responsible for creating the BOM, grouping orders into a shipment plan, and preparing the budget?
  **A:** [MUST HAVE] Something else... - This should be controlled by the system admin. He can assign the responsibility to various users or to himself based on the requirements

### True Goal
- **Q:** Now let's explore Planning. You mentioned grouping orders to reduce overhead through combined purchasing. What is the most costly planning failure at Raagam today?
  **A:** [MUST HAVE] Something else... - Now we group orders and create BOM separately for each orders but created Budget for Grouped orders and perform purchase with our vendor like yarn vendor, dying vendor accordingly. We need option to group various orders  or to go separately for each order based on our convinience. Once we group order we cread one po for purchase. when we do not group the order we need to create separate PO for non grouped order. Remember BOM is separate for each order. But budgets are created for the grouped or single orders based on our convenience.

### Edge Cases
- **Q:** Which unusual planning scenario is most common at Raagam that the system must handle smoothly?
  **A:** [MUST HAVE] Two orders share the same yarn colour but different buyers

### Happy Path
- **Q:** When creating a BOM for a new order — say a NEXT T-shirt in circular jersey — what is the ideal sequence of steps for the planner?
  **A:** [MUST HAVE] Something else... - we need separate screen for Fabric BOM and Material BOM. But one is not dependent on other. we can make both fabric bom and material bom together.

### Connections & Integrations
- **Q:** Once a BOM is approved, which downstream modules should automatically receive the data from it?
  **A:** [MUST HAVE] Something else... - BOM required no approval. After BOM budgeting is done using Fabric BOM and Material BOM of various orders which are grouped together. This budget is approved. After approval it should downstream to purchase module.

### Current State
- **Q:** Today, how does Raagam build its BOMs and budgets? What tools and process are being replaced?
  **A:** [MUST HAVE] Something else... - We are doing both in EDP2. Here is the process explanation that we are following in EDP2. Actually BOM is of two types for each order. One is Fabric BOM and another one is Material BOM. In Material BOM there are two categories Sweing Accessories and Packing Accessories. Sewing accessories examples are labels, swing threads, buttons etc. Packing accessories examples are poly-bag, tags, stickers, carton boxes etc. Different items have different units of Measure(UOM) like nos,meters, gross, yards etc. Some of the materials purchased in Material BOM requires further processing like Button Coloring etc. So after purchase we many need to send to Processor by DC and after the process is done we need to GRN into our stock. In bom we need field like attributes to make orders like red label, white label. While making BOM Quantity should be able to given in nos and also in MOQ(Some vendors also only MOQ purchase and not Nos wise purchase). For Fabric BOM we have three fabric types . Woven, Circular, Flat Knit. There are further sub types in each fabric types they are solid, yarn dyed, melange. we need UI to select those and create BOM accordingly. We need to give component wise and  colour wise consumption and size wise. Actually Styles have have to split into component wise fabric details. The BOM should give process sequence to be done like yarn  purchase , knitting, dyeing, stentering , compacting etc. Process wise process loss should be included while calculating the BOM. In size wise diameter details also should be provided.

### UI / Data Display
- **Q:** What is the most important screen in the Planning module for daily work — the one that saves the most time compared to EDP2?
  **A:** [MUST HAVE] Something else... - Both option 2 and 3 are most important screen

### Permissions & Roles
- **Q:** For Planning, who should be able to approve a budget before purchase orders can be raised against it?
  **A:** [MUST HAVE] Admin assigns roles per module

---

## Feature: HR & Payroll
Questions answered: 11

### Success Criteria
- **Q:** Given the complexity of your three-tier payroll system, what does "HR & Payroll working perfectly" look like in 6 months?
  **A:** [MUST HAVE] Both — zero payroll errors AND on-time statutory compliance

### Recovery
- **Q:** When a worker disputes their piece count and HR needs to correct it — how should payroll corrections work in the system?
  **A:** [MUST HAVE] HR can correct piece counts before payroll is finalized

### Sad Path / Error Handling
- **Q:** What is the most common HR/payroll problem that delays or incorrectly calculates someone's wages at Raagam?
  **A:** [MUST HAVE] Something else... - we need option 1 and option 3

### Who & When
- **Q:** Who manages attendance tracking and payroll processing at Raagam — for both workers and staff?
  **A:** [MUST HAVE] Separate HR teams at HO and Unit 2

### True Goal
- **Q:** Now HR & Payroll — you have workers on piece-rate and staff on fixed salary, plus ESI/PF compliance. What is the biggest HR/payroll pain today?
  **A:** [MUST HAVE] Something else... - we have all the 3 options as pain points today

### Edge Cases
- **Q:** Which unusual HR/payroll scenario must the system handle correctly — especially for ESI and PF compliance?
  **A:** [MUST HAVE] Something else... - Actually there are there types of workers in Raagam.
1.Shift Workers tagged to the company Raagam
2. Piece Rate workers tagged to a Contractor
3. Piece rate Workers tagged to the Company Raagam

 All the three types of workers may work for any time. These three workers are paid weekly. Their working time is fetched from their biometric.

Raagam uses two accounts for making payments to its workforce.
Each worker is paid 2 wages. One is Actual Wage and Other is Extra wage from 2 accounts from raagam.

Calculation of Actual Wage/worker:
The payment system should have an option to enter OT hours per day for each worker (There should be a restriction of maximum hours per day and Maximum hours per month that can be set globally for all workers) . The extra shift hours are filled for OT hours per worker as per day and monthly restriction . Those OT hours should be paid in double.
The total weekly wages/worker  = (shift wages/day) * 7 +OT hours wages(paid in double - calculated for hours)

This Actual wage is paid from No.1 Raagam account.

ESI and PF are calculated on Actual wage only. The wages are paid weekly after deducting ESI and PF

This Actual wage calculation is same for all the three types of workers.

Calculation of Extra Wage/worker varies to all three types of workers.

1.Shift Worker Extra Wage calculation
Extra wage = {Extra hours worked per week(fetched from biometric) * Hourly Wages} - OT hour wages paid in Actual wage calculation

2.Piece Rate workers tagged to a Contractor
 This Extra wage is paid to the Contractor. The contractor Payroll calculation is as follows.
 {Total Number of pieces made by all the workers tagged to a contractor * piece rate} -{Sum of all the Actual wages paid to each worker tagged to the contractor}


3.Piece rate Workers tagged to the Company Raagam
This Extra wage is paid to the Workers itself.
calculation part
Extra wages= {Pieces made by worker* piece rate} - Actual wages paid to the worker.
This extra wages is paid from Raagam account no.2 
No ESI and PF for extra wages.

Other than workers there is a staff salary that is calculated monthly and paid monthly.

### Happy Path
- **Q:** Walk me through the ideal monthly payroll flow in the new system — from biometric attendance to final payslip. What should happen automatically vs. what needs HR review?
  **A:** [MUST HAVE] Something else... - we need all three options. we follow weekly payroll for workers(workers have shift basis ) and monthly payroll for staff .

### Connections & Integrations
- **Q:** How should the HR Payroll module connect to Finance? You mentioned ESI/PF compliance is a pain — how critical is automated statutory filing?
  **A:** [MUST HAVE] Both — GL posting AND statutory challans

### Current State
- **Q:** How is attendance currently captured and how is payroll calculated today at Raagam?
  **A:** [MUST HAVE] EDP2 for payroll + biometric attendance

### UI / Data Display
- **Q:** For the HR Payroll module, what must the weekly payslip for a worker show? The system must display both the Actual Wage (Account 1, with ESI/PF deductions) and the Extra Wage (Account 2, no deductions) clearly. What else is essential on the payslip screen?
  **A:** [MUST HAVE] Worker payslip view — weekly breakdown

### Permissions & Roles
- **Q:** Given that you have separate HR teams at HO and Unit 2, and payroll involves two bank accounts — who should have authority to approve and lock the weekly payroll run?
  **A:** [MUST HAVE] Admin-configurable roles — same principle as other modules

---

## Feature: Order Management
Questions answered: 12

### Success Criteria
- **Q:** How will you know the Order Management module is truly working? What does success look like in 6 months?
  **A:** [MUST HAVE] Something else... - I want both option 1 and Option 3

### Recovery
- **Q:** Since all 8 amendment types need MD approval — once approved, how should the system record the change so there's a complete audit trail?
  **A:** [MUST HAVE] Something else... - I need version-numbered order revisions. But the last approved version should be allowed for further processing. Also each amendment should show how it affects the budgeted profit amount.

### Sad Path / Error Handling
- **Q:** Amendments from buyers like NEXT are your biggest pain. What is the most damaging type of amendment that hits Raagam in the middle of production?
  **A:** [MUST HAVE] Something else... - We faces the following amendments problems from client side
1.Quantity changes
2. Color changes
3.Price changes
4.Adding new sizes
5.Change in delivery dates
6.Consignee changes
7.Packing Method Changes
8.Style change(Rare case)
All these amendments if done needs approval by  MD

### Who & When
- **Q:** Once an order is confirmed, who is responsible for managing it day-to-day — amendments, T&A updates, and delivery tracking?
  **A:** [MUST HAVE] Merchandiser owns it end-to-end

### True Goal
- **Q:** Moving to Order Management. Once a buyer confirms an order — what is the biggest operational headache between order confirmation and shipment?
  **A:** [MUST HAVE] Something else... - I have all the three headaches. so i need solution for all the three options you have provided.

### Edge Cases
- **Q:** Let's think about unusual-but-real scenarios in Order Management. Which of these happens at Raagam?
  **A:** [MUST HAVE] Something else... - All the three options scenarios happens in Raagam now. Also Ho is a separate GST entity and Unit 2 is a separate GST entity. We get approval from client for single entity and we work(Production) with  both the entities internally for our convenience. But shipped under only one name to which we received the order from the client.

### Happy Path
- **Q:** In the new system, when a buyer confirms an order — how should the Sales Order record be created?
  **A:** [MUST HAVE] Something else... - We need all the option 1 and 2 and 3
- **Q:** Once the order is in the system, how should the Time & Action plan be created? NEXT orders especially have tight lead times — how do you want to build the T&A?
  **A:** [MUST HAVE] Something else... - The system should ask should i go for auto-generate from order option or  should i go for Template based option. The merchandiser should have the option to choose one among these two  options

### Connections & Integrations
- **Q:** When an order is confirmed and the T&A is set — which other parts of the system should automatically receive this information?
  **A:** [MUST HAVE] Something else... - We need to group various orders in to this shipment plan and create BOM orderwise and create the budget as per the grouped shipment plan. This help us in reducing our overheads by grouping similar orders to  purchase required materials and further process (Knitting,dying  up to finished fabric)

### Current State
- **Q:** Today, how does Raagam currently track amendments received from a buyer like NEXT, and how is the T&A plan maintained?
  **A:** [MUST HAVE] EDP2 for orders, Excel for T&A

### UI / Data Display
- **Q:** When a merchandiser opens Order Management, what should be the most important screen they see first?
  **A:** [MUST HAVE] Order dashboard with T&A traffic lights

### Permissions & Roles
- **Q:** You mentioned all amendments need MD approval. Who is allowed to INITIATE an amendment request in the system — before it goes to the MD?
  **A:** [MUST HAVE] Something else... - we need amendment rights to be assigned by  the admin user. He can assign any one like merchandiser or MD or himself to do the amendment.

---

## Feature: Process Planning
Questions answered: 11

### Success Criteria
- **Q:** How will you know Process Planning is working well — what outcome defines success? (This also covers edge_cases and who_can_do_what — both will follow admin-configurable model already established, and edge cases mirror DC tracking already captured.)
  **A:** [MUST HAVE] Both success measures

### Recovery
- **Q:** When processed fabric (knitted or dyed) returns from an external processor — what should the system capture at receipt?
  **A:** [MUST HAVE] Both — quality check at receipt AND loss recording against BOM

### Sad Path / Error Handling
- **Q:** What is the most common problem when material comes back from an external processor (knitter/dye house)?
  **A:** [MUST HAVE] Something else... - All three options are happening in raagam

### Who & When
- **Q:** For Process Planning — is knitting and dyeing done in-house at Raagam's own machines, or outsourced to external processors like Nivedha Knits?
  **A:** [MUST HAVE] Outsourced — sent to external knitters and dye houses by DC

### True Goal
- **Q:** Process Planning covers knitting and dyeing operations — the fabric production stage. What is the biggest pain in managing these processes today?
  **A:** [MUST HAVE] Something else... - options 1 and 2

### Edge Cases
- **Q:** What should happen if a staff member tries to save a process plan that has missing or incomplete details?
  **A:** Allow saving as a draft with a warning message

### Happy Path
- **Q:** In the new system, how should a knitting or dyeing job order be created for an external processor?
  **A:** [MUST HAVE] Manual job order creation by the planner

### Connections & Integrations
- **Q:** For Process Planning — how should access work, and how should completed jobs connect to Stores and BOM? (covering who_can_do_what, connections, edge_cases, and success in one question)
  **A:** [MUST HAVE] Both answers — admin-configurable AND auto-updates to store and BOM

### Current State
- **Q:** Since knitting and dyeing are fully outsourced — does Process Planning need its own dedicated module beyond the DC tracking we already covered in Materials & Purchase?
  **A:** [MUST HAVE] Both overlap but process planning adds quality and loss tracking

### UI / Data Display
- **Q:** For the final 5 Process Planning territories at once — what's the most important screen, and how does it connect to BOM? (I'll combine remaining questions here for efficiency.)
  **A:** [MUST HAVE] Both as tabs

### Permissions & Roles
- **Q:** Apart from the admin, who else should be able to view process plans in the system?
  **A:** Something else: Admin decides who views and who can edit. All rights are assigned by admin

---

## Feature: Store Management
Questions answered: 11

### Success Criteria
- **Q:** How will you know the Store Management module is working well — what is the measure of success?
  **A:** [MUST HAVE] Zero stock discrepancies in periodic audit

### Recovery
- **Q:** When a store keeper accidentally tries to issue more than what's in stock — should the system block the transaction, or allow it with a warning?
  **A:** [MUST HAVE] Block the issue if stock is insufficient - Allow until stock is available. Dont allow more than the stock.

### Sad Path / Error Handling
- **Q:** What is the most common error that happens during material issuance from store to production at Raagam?
  **A:** [MUST HAVE] Stock goes negative

### Who & When
- **Q:** Who manages the 5 stores at Raagam? Is there dedicated store staff per store type, or does one person handle multiple stores?
  **A:** [MUST HAVE] Each store has a dedicated store keeper

### True Goal
- **Q:** You have 5 store types: Purchase Store, Processing Store, Material Store, Rejection Store, and Surplus Store. What is the single biggest problem in how these stores are managed today?
  **A:** [MUST HAVE] Something else... - All of the above options

### Edge Cases
- **Q:** Which unusual store scenario is most common at Raagam that the system must handle?
  **A:** [MUST HAVE] Something else... - i need all three options

### Happy Path
- **Q:** Let's clarify how each of the 5 stores works. Which best describes the relationship between the store types?
  **A:** [MUST HAVE] Common transactions, different item types

### Connections & Integrations
- **Q:** How should the 5 store types connect to the Production tracking module?
  **A:** [MUST HAVE] Both — issuance flows to Production AND returns update order records

### Current State
- **Q:** How are stock movements in the 5 stores managed today — specifically material inward (GRN) and outward (issue to production)?
  **A:** [MUST HAVE] EDP2 for both inward and outward

### UI / Data Display
- **Q:** What is the most important view for a store keeper's daily work — what should they see when they open their store module?
  **A:** [MUST HAVE] Both — live balance card + transaction ledger

### Permissions & Roles
- **Q:** Since each store has a dedicated keeper — how should access be controlled between store types?
  **A:** [MUST HAVE] Store keeper limited to their own store only - But admin can change or give access to stores as per their changing requirement

---

## Feature: Sales & Marketing
Questions answered: 13

### Success Criteria
- **Q:** Finally — how will you know if the Sales & Marketing module is working well? What number or outcome would tell you "yes, this is delivering value"?
  **A:** [MUST HAVE] All three matter

### Recovery
- **Q:** When a buyer counters with a lower target FOB, the merchandiser needs to rework the costing. How should the system handle this revision — to make sure the original quote isn't lost?
  **A:** [MUST HAVE] Clone and revise

### Sad Path / Error Handling
- **Q:** Now let's think about what can go wrong. What is the most common problem that breaks the flow between sending a quote and getting an order confirmed?
  **A:** [MUST HAVE] Buyer rejects the quote and counters

### Who & When
- **Q:** Now let's understand who's involved. When a buyer sends an enquiry for a new style, who in your team handles it — and how is the work split?
  **A:** [MUST HAVE] Merchandiser handles it all

### True Goal
- **Q:** Let's start at the beginning of your business cycle. When a buyer like NEXT (UK) or ABASIC (Spain) first shows interest in a new style, what is the single biggest problem you face TODAY in managing that opportunity through to a confirmed order?
  **A:** [MUST HAVE] No single place to track it
- **Q:** You mentioned everything is scattered — opportunities, samples, costings in different places. If we solve ONLY this "single place to track it" problem, what would that unlock for your business? What becomes possible that isn't possible today?
  **A:** [MUST HAVE] All of the above

### Edge Cases
- **Q:** Let's think about edge cases. Which of these unusual-but-real scenarios happens at Raagam that the system must handle?
  **A:** [MUST HAVE] One buyer, multiple styles, one season

### Happy Path
- **Q:** Let's walk through the ideal flow in the new system. When a buyer sends a new enquiry, what should the merchandiser do FIRST in the system?
  **A:** [MUST HAVE] Style details first, then costs
- **Q:** When a merchandiser logs a style (say a T-shirt for NEXT), what information must be captured at that first step? Which details are essential before any costing can start?
  **A:** [MUST HAVE] Both — style card approach

### Connections & Integrations
- **Q:** When a buyer confirms an order after we've won the quote — how should Sales & Marketing connect to the rest of the system?
  **A:** [MUST HAVE] Something else... - some buyer asks for both quotation and sample delivery together for order confirmation. So we need options to provide samples along with quotation

### Current State
- **Q:** Today, before we build the new system — how does a merchandiser actually track an enquiry and build a cost sheet? What tools do they use right now?
  **A:** [MUST HAVE] Excel + Email only

### UI / Data Display
- **Q:** What should a merchandiser see when they open the Sales & Marketing section of the new system? What's the most important screen for their daily work?
  **A:** [MUST HAVE] Both — pipeline list + detailed cost sheet

### Permissions & Roles
- **Q:** Who should have permission to approve and send a cost sheet to a buyer like NEXT? Is there any sign-off required before it goes out?
  **A:** [MUST HAVE] Merchandiser creates, manager approves

---

## Feature: System Integration
Questions answered: 28

### Success Criteria
- **Q:** System Integration Question 3 of 3 — Throughout this interview, the MD appears as the approver for amendments, POs, budgets, and payroll. Should there be a unified approval dashboard for the MD showing everything pending across all modules?
  **A:** [MUST HAVE] MD/Management gets a daily alert of anything in the system needing their approval
- **Q:** Walkthrough 3 — It's Friday and your stakeholders ask: "How's the ERP going?" What information do you pull from the system to answer that question?
  **A:** [MUST HAVE] Both — shipment performance AND order pipeline health

### Recovery
- **Q:** If a Tally data export fails or some records are not transferred correctly, what should the system do?
  **A:** Show an error message and let admin retry manually

### Sad Path / Error Handling
- **Q:** Walkthrough 2 — Something goes wrong: a NEXT T&A milestone was missed, a vendor PO is 3 days overdue, and production output is 20% below target. How do you want to find out about these problems, and what's your first move?
  **A:** [MUST HAVE] Receive a daily crisis summary at the start of each day

### Who & When
- **Q:** How often should data be exported to Tally, and who should trigger the export?
  **A:** Admin or accounts staff triggers it manually whenever needed

### True Goal
- **Q:** What is the main problem you are trying to solve by integrating Raagam Exports with other systems?
  **A:** Something else: we need to transfer the data to tally for sending to CA to make them to undersand

### Edge Cases
- **Q:** System Integration Question 2 of 3 — When Production, Store, Payroll, and Finance all share data from the same order, what is the most likely conflict that the system must automatically detect and resolve?
  **A:** [MUST HAVE] Both conflicts can occur — system should handle both

### Happy Path
- **Q:** Walkthrough 1 — It's Monday morning at Raagam Exports and you open the new ERP for the first time that week. Walk me through the first 10 minutes. What do you do FIRST?
  **A:** [MUST HAVE] Check the order T&A dashboard — which milestones are due this week and which are overdue

### Connections & Integrations
- **Q:** System Integration Question 1 of 3 — When the MD approves an order amendment (say a quantity increase after production has started), how should this cascade through the connected modules: BOM, Purchase, Store, and Production?
  **A:** [MUST HAVE] Amendment cascades automatically to BOM, Budget, Purchase, Production, and T&A
- **Q:** What type of business data from Raagam Exports should be sent to Tally for your CA?
  **A:** Sales invoices and customer orders<|SEP|>Purchase orders and supplier payments

### Current State
- **Q:** How does your team currently send business data (invoices, purchases) to Tally or your CA right now?
  **A:** Manual entry in Tally

### UI / Data Display
- **Q:** How packed with information should each screen be? Raagam's team manages complex data — how much should be visible at once?
  **A:** [MUST HAVE] Dense and data-rich
- **Q:** When a user saves a cost sheet or confirms an order, how should the system respond to confirm it worked?
  **A:** [MUST HAVE] Clear and confirming
- **Q:** Your team spans office staff (merchandisers, accounts) and factory floor supervisors. Which best describes how they'll access the system?
  **A:** [MUST HAVE] Equal priority
- **Q:** If the new ERP had a personality — how should it feel to use every day? Think about your 50-100 staff ranging from factory supervisors to accounts team.
  **A:** [MUST HAVE] Friendly and approachable
- **Q:** When a supervisor enters a sewing output count or a store staff logs a material issue — how fast does the screen need to respond?
  **A:** [MUST HAVE] Instant
- **Q:** Think of the best software tool your team uses today — what makes it feel great to use? What quality do you most want in the new ERP?
  **A:** [MUST HAVE] Something else... - I want all the above
- **Q:** When data is exported to Tally, which details should be included for each transaction?
  **A:** All of the above

### tech_decisions
- **Q:** Tech Decisions — How should this ERP be built technically? You have both office staff (on computers) and factory floor supervisors (on phones). What's your preferred approach?
  **A:** [MUST HAVE] Both web and mobile
- **Q:** You've chosen both web and mobile. For the mobile app — should it work offline when WiFi is unavailable on the factory floor?
  **A:** [MUST HAVE] Should work offline for basic functions
- **Q:** Your operation involves significant payments — weekly worker wages (two accounts), vendor PO payments, and forex collections from NEXT/ABASIC. How should the ERP handle payments?
  **A:** [MUST HAVE] No payment integration yet — we'll handle payments outside the system
- **Q:** How should Raagam's 50-100 staff log into the new ERP? You have both office staff and factory floor supervisors with different preferences.
  **A:** [MUST HAVE] Multiple options — let users choose email/password or phone OTP
- **Q:** Where should the Raagam ERP be hosted? Since you export to UK and Europe and handle GST/EPFO compliance in India, where your data lives matters.
  **A:** [MUST HAVE] Cloud-hosted — auto-managed (Vercel + Supabase)
- **Q:** How many people will actively use this ERP at Raagam — both now and in the next 2-3 years?
  **A:** [MUST HAVE] Under 500 users, stable
- **Q:** For notifications — you mentioned daily crisis summaries and MD approval alerts. How should the ERP notify people?
  **A:** [MUST HAVE] Both SMS and Email — critical alerts via SMS, reports via email
- **Q:** Final tech decision — What level of compliance and security does this ERP need? It handles ESI/PF, worker wages, GST, export receivables, and profit data.
  **A:** [MUST HAVE] Both — standard security plus financial audit trails
- **Q:** Last tech decision — given the scale and complexity of this ERP, what is your build priority? This is a large system covering 11 capabilities.
  **A:** [MUST HAVE] MVP first, then full system — phased approach

### Permissions & Roles
- **Q:** Who in your team should be allowed to send data to Tally for your CA?
  **A:** Admin and accounts staff

---

## Feature: Production Tracking
Questions answered: 11

### Success Criteria
- **Q:** How will you know the Production Tracking module is delivering value — what number or outcome shows it's working?
  **A:** [MUST HAVE] Zero untracked pieces

### Recovery
- **Q:** When sewing output and packing count don't match — what should the system do to resolve the discrepancy?
  **A:** [MUST HAVE] Reject and rework workflow

### Sad Path / Error Handling
- **Q:** What is the most common production failure that causes either a delay or an inaccurate shipment quantity?
  **A:** [MUST HAVE] Something else... - All the three options happen here in Ragam

### Who & When
- **Q:** For sewing line output — who enters the daily production count into the system, and when?
  **A:** [MUST HAVE] Two-step: supervisor records, manager confirms

### True Goal
- **Q:** Now let's cover Production Tracking across Cutting, Sewing, and Packing. You have sewing lines at both HO (teams A1-C6) and Unit 2 (teams IIA1-C1). What is the biggest visibility gap in production today?
  **A:** [MUST HAVE] Something else... - I have all the three options

### Edge Cases
- **Q:** Which unusual-but-real production scenario must the system handle at Raagam?
  **A:** [MUST HAVE] Something else... - We need all three options.

### Happy Path
- **Q:** Walk me through the ideal production tracking flow in the new system. How should pieces flow from Cutting to Sewing to Packing in the system?
  **A:** [MUST HAVE] Both together as the correct sequence

### Connections & Integrations
- **Q:** Production data is clearly critical for HR payroll (piece-rate workers). How should Production Tracking connect to other modules?
  **A:** [MUST HAVE] Both — feeds Payroll AND updates Order T&A milestones

### Current State
- **Q:** Today, how does Raagam track production output across Cutting, Sewing, and Packing?
  **A:** [MUST HAVE] EDP2 for all three stages but not linked

### UI / Data Display
- **Q:** What is the most important production screen — and for which user?
  **A:** [MUST HAVE] Both — line dashboard for managers + order progress for merchandisers

### Permissions & Roles
- **Q:** Who should be able to enter and confirm production data — and should it be the same for all three stages (Cutting, Sewing, Packing)?
  **A:** [MUST HAVE] Admin-configurable per module as with other modules

---

## Feature: Materials & Purchase
Questions answered: 11

### Success Criteria
- **Q:** How will you know the Materials & Purchase module is working well — what is the key measure of success?
  **A:** [MUST HAVE] Full traceability: DC out and back - we need option 1 also

### Recovery
- **Q:** When a vendor delivers only part of a PO (say 350 kg of 500 kg ordered), how should the system handle the open balance?
  **A:** [MUST HAVE] Keep PO open, accept partial GRN, track balance

### Sad Path / Error Handling
- **Q:** What is the most common problem that occurs between raising a PO and completing the final GRN at the store gate?
  **A:** [MUST HAVE] Vendor delivers partial quantity

### Who & When
- **Q:** Who at Raagam raises Purchase Orders, and who does the GRN (Goods Receipt Note) when materials arrive?
  **A:** [MUST HAVE] Same person handles PO and GRN - But we may check the quality of materials after receiving and we may reject some materials(This may be due to our mistake due to wrong material ordered in po). In this case we may need to make new po again.  Or we may ask for replacement of some materials in the po due to vendor mistake. In this case same po exists.only replacement occurs.

### True Goal
- **Q:** Now let's cover Materials & Purchase. You have vendors like Nivedha Knits, SD Textile, Shree Knit Impex. What is the biggest pain in your purchasing process today?
  **A:** [MUST HAVE] PO to GRN is disconnected - Which receiving at the gate we may receive multiple GRN's for the same PO. Also we may get a single GRN for multiple PO's

### Edge Cases
- **Q:** Which unusual but real purchase scenario must the new system handle at Raagam?
  **A:** [MUST HAVE] Material received from processor after DC - we do splitting only after finished fabric. We donot split the received yarn in to different BOMS at this stage

### Happy Path
- **Q:** When an approved budget triggers purchase activity — what is the ideal step-by-step flow for raising a PO and receiving materials?
  **A:** [MUST HAVE] Budget approved → PO directly → GRN → Invoice match - But  PO will be different from budget based on vendor quotation. So when store manager prepares PO it should be approved by MD/other person as decided by admin before proceeding with the purchase

### Connections & Integrations
- **Q:** When a GRN is completed and materials are received — which other parts of the system should automatically get updated?
  **A:** [MUST HAVE] Both — GRN updates Store AND triggers Finance

### Current State
- **Q:** Today, how does Raagam handle the vendor selection and PO process — from choosing a vendor to raising the actual Purchase Order?
  **A:** [MUST HAVE] Fully in EDP2 with PO prints

### UI / Data Display
- **Q:** What should the purchase officer see as the main working screen when they open the Materials & Purchase module each morning?
  **A:** [MUST HAVE] Both — PO tracker and DC tracker as separate tabs

### Permissions & Roles
- **Q:** You mentioned PO approval is required before purchase proceeds. Who in the system should have the authority to approve a Purchase Order?
  **A:** [MUST HAVE] Admin-configurable, same as other modules

---

## Feature: Embroidery Operations
Questions answered: 13

### Success Criteria
- **Q:** Since the embroidery module is not needed, what is the most important thing your ERP should help you track day-to-day?
  **A:** All of the above equally

### Recovery
- **Q:** After records are successfully exported to Tally, how should they appear in the ERP system?
  **A:** Move them to a separate 'Exported' section

### Sad Path / Error Handling
- **Q:** When a problem occurs during embroidery production — such as a machine breakdown, thread snap, or wrong design loaded — what should the system do?
  **A:** Something else: we do not need embroidery module in erp

### Who & When
- **Q:** Embroidery Operations — is embroidery done in-house at Raagam or outsourced to external embroidery units?
  **A:** [MUST HAVE] Something else... - No Embroidery operations in raagam. Remove it

### True Goal
- **Q:** What is the most important business outcome you want from the Embroidery Operations module?
  **A:** Something else: We do not need embroidery module in our erp

### Edge Cases
- **Q:** If the same invoice or purchase record is accidentally exported to Tally a second time, what should the system do?
  **A:** Something else: While Exporting new Invoice and purchase records should be exported to tally and other old records should be replaced again.

### Happy Path
- **Q:** When an embroidery order runs smoothly from start to finish, which steps does your team follow?
  **A:** Something else: we do not need embroidery module in erp

### Connections & Integrations
- **Q:** Apart from Tally, does your business need to connect with any other system or service?
  **A:** No, only Tally is needed
- **Q:** In what format should the system create the export file so your CA can load it into Tally easily?
  **A:** Tally XML file

### Current State
- **Q:** How are sales invoices and purchase orders created in your business today?
  **A:** A mix of paper and digital

### UI / Data Display
- **Q:** Before the admin or accounts staff clicks 'Export to Tally', what should they be able to see and check on screen?
  **A:** All of the above on one screen

### Permissions & Roles
- **Q:** Who in your team should be allowed to make changes to production orders, machine assignments, and system settings?
  **A:** Something else: Only admin
- **Q:** Since some of your records are still on paper, who will be responsible for typing those paper records into the ERP system?
  **A:** We plan to go fully digital soon

---

## Feature: System Administration
Questions answered: 11

### Success Criteria
- **Q:** For System Administration — what does success look like? (This also captures who_can_do_what and edge_cases: all follow the same super-admin model confirmed throughout.)
  **A:** [MUST HAVE] Both — stability AND security

### Recovery
- **Q:** For recovery, permissions, edge cases, and success in System Administration — what are the critical safeguards needed? (Combined question to complete the final territories)
  **A:** [MUST HAVE] Both — backup alerts AND strict admin-only access

### Sad Path / Error Handling
- **Q:** What is the most critical system administration failure that could cause real business damage?
  **A:** [MUST HAVE] Data backup fails silently

### Who & When
- **Q:** Who should be the system administrator for the new ERP? We've confirmed throughout this interview that admin controls everything — how should admin access be structured?
  **A:** [MUST HAVE] One super-admin — probably the MD or IT person

### True Goal
- **Q:** Last capability — System Administration. Given you have 50-100 staff, two GST entities, and a complex operation, what is the most critical administration need?
  **A:** [MUST HAVE] Something else... - All three options are needed

### Edge Cases
- **Q:** If the main admin is unavailable — travelling, sick, or has left the company — how should system access be managed?
  **A:** Contact the software support team to restore admin access

### Happy Path
- **Q:** For System Administration — across user management, master data, backups, and audit trails — what should the admin panel contain and how should the overall admin experience work? (I'll cover happy_path, what_they_see, recovery, edge_cases, connections, and success together here for efficiency)
  **A:** [MUST HAVE] Something else... - We need both options

### Connections & Integrations
- **Q:** For system-level connections — the new ERP needs to integrate with existing infrastructure. Which integrations are critical?
  **A:** [MUST HAVE] Both are critical system integrations

### Current State
- **Q:** How is system administration currently handled in EDP2 — who manages users, master data, and data backup today?
  **A:** [MUST HAVE] Everything in EDP2 — which is being replaced

### UI / Data Display
- **Q:** For System Administration — what should the admin see on their home screen, and what does admin success look like? (This also covers sad_path, recovery, edge_cases, who_can_do_what, what_they_see, and success for this module.)
  **A:** [MUST HAVE] Something else... - both options needed

### Permissions & Roles
- **Q:** What should regular (non-admin) staff be able to do when they log into the system?
  **A:** Something else: Individual user rights are provided by admin only.

---

## Feature: Logistics & Export Documentation
Questions answered: 11

### Success Criteria
- **Q:** How will you know Logistics & Export Documentation is working well in the new system?
  **A:** [MUST HAVE] Both

### Recovery
- **Q:** If an export document needs to be corrected after it has been generated — say the consignee address was wrong in the commercial invoice — how should it be fixed?
  **A:** [MUST HAVE] Re-generate all documents from the same shipment record

### Sad Path / Error Handling
- **Q:** What is the most common logistics failure that causes a shipment delay or buyer rejection?
  **A:** [MUST HAVE] Something else... - Nothing in this list

### Who & When
- **Q:** Who at Raagam handles the export documentation — packing list, commercial invoice, bill of lading, and DGFT filings?
  **A:** [MUST HAVE] Dedicated logistics/export team

### True Goal
- **Q:** Logistics & Export Documentation — you export to UK and Europe through Tuticorin Port. What is the biggest pain in the export documentation and logistics process today?
  **A:** [MUST HAVE] Export documents are manual and error-prone

### Edge Cases
- **Q:** Which unusual export/shipment scenario does Raagam deal with that the logistics system must handle?
  **A:** [MUST HAVE] Something else... - Both option 1 and 2

### Happy Path
- **Q:** In the new system, what is the ideal process for generating the full set of export documents for a NEXT shipment?
  **A:** [MUST HAVE] Both, in sequence

### Connections & Integrations
- **Q:** When a shipment is confirmed and the goods leave Tuticorin Port — what should the system automatically update in other modules?
  **A:** [MUST HAVE] Shipment completion triggers Finance receivable

### Current State
- **Q:** How are export documents currently generated at Raagam — packing list, commercial invoice, GST invoice?
  **A:** [MUST HAVE] All in Word/Excel templates

### UI / Data Display
- **Q:** What is the most important Logistics screen for the export documentation team's daily work?
  **A:** [MUST HAVE] Both — shipment register + per-shipment checklist

### Permissions & Roles
- **Q:** Who should have access to generate and approve export documents — and is any approval required before submission to the freight forwarder?
  **A:** [MUST HAVE] Admin-configurable — same principle as all other modules

---

## Design DNA

_Design preferences that apply to the entire solution._

- **How packed with information should each screen be? Raagam's team manages complex data — how much should be visible at once?**
  [MUST HAVE] Dense and data-rich
- **When a user saves a cost sheet or confirms an order, how should the system respond to confirm it worked?**
  [MUST HAVE] Clear and confirming
- **Your team spans office staff (merchandisers, accounts) and factory floor supervisors. Which best describes how they'll access the system?**
  [MUST HAVE] Equal priority
- **If the new ERP had a personality — how should it feel to use every day? Think about your 50-100 staff ranging from factory supervisors to accounts team.**
  [MUST HAVE] Friendly and approachable
- **When a supervisor enters a sewing output count or a store staff logs a material issue — how fast does the screen need to respond?**
  [MUST HAVE] Instant
- **Think of the best software tool your team uses today — what makes it feel great to use? What quality do you most want in the new ERP?**
  [MUST HAVE] Something else... - I want all the above
- **When data is exported to Tally, which details should be included for each transaction?**
  All of the above

---

## Cross-Feature Interactions

### Data Flows
- **Q:** System Integration Question 1 of 3 — When the MD approves an order amendment (say a quantity increase after production has started), how should this cascade through the connected modules: BOM, Purchase, Store, and Production?
  **A:** [MUST HAVE] Amendment cascades automatically to BOM, Budget, Purchase, Production, and T&A
- **Q:** What type of business data from Raagam Exports should be sent to Tally for your CA?
  **A:** Sales invoices and customer orders<|SEP|>Purchase orders and supplier payments

### Permission Inheritance
- **Q:** Who in your team should be allowed to send data to Tally for your CA?
  **A:** Admin and accounts staff

### Conflict Rules
- **Q:** System Integration Question 2 of 3 — When Production, Store, Payroll, and Finance all share data from the same order, what is the most likely conflict that the system must automatically detect and resolve?
  **A:** [MUST HAVE] Both conflicts can occur — system should handle both

---

## System-Level Journeys

_How the user interacts with the solution as a whole, across features._

- **Q:** Walkthrough 1 — It's Monday morning at Raagam Exports and you open the new ERP for the first time that week. Walk me through the first 10 minutes. What do you do FIRST?
  **A:** [MUST HAVE] Check the order T&A dashboard — which milestones are due this week and which are overdue
- **Q:** Walkthrough 2 — Something goes wrong: a NEXT T&A milestone was missed, a vendor PO is 3 days overdue, and production output is 20% below target. How do you want to find out about these problems, and what's your first move?
  **A:** [MUST HAVE] Receive a daily crisis summary at the start of each day
- **Q:** System Integration Question 3 of 3 — Throughout this interview, the MD appears as the approver for amendments, POs, budgets, and payroll. Should there be a unified approval dashboard for the MD showing everything pending across all modules?
  **A:** [MUST HAVE] MD/Management gets a daily alert of anything in the system needing their approval
- **Q:** Walkthrough 3 — It's Friday and your stakeholders ask: "How's the ERP going?" What information do you pull from the system to answer that question?
  **A:** [MUST HAVE] Both — shipment performance AND order pipeline health

---

## Builder Notes

This spec captures the user's intent through exhaustive structured questioning. When building:
- Use component-based architecture (easy to rearrange after user review)
- Keep business logic in services (easy to change rules)
- Log every assumption not covered by specs in ASSUMPTIONS.md
- Build for rapid iteration — the user will discover new intent after seeing the software

---

## Schema Dependency Report


### New Tables Required

_Run "Synthesize Build Sections" in admin to infer required tables from interview data._

---

## 5-Layer Build Checklist

### Layer 1: Types (TypeScript Definitions)
- [ ] Define types for Finance
- [ ] Define types for Planning
- [ ] Define types for HR & Payroll
- [ ] Define types for Order Management
- [ ] Define types for Process Planning
- [ ] Define types for Store Management
- [ ] Define types for Sales & Marketing
- [ ] Define types for System Integration
- [ ] Define types for Production Tracking
- [ ] Define types for Materials & Purchase
- [ ] Define types for Embroidery Operations
- [ ] Define types for System Administration
- [ ] Define types for Logistics & Export Documentation
- [ ] Define enums for statuses, roles, categories
- [ ] Define Zod validation schemas

### Layer 2: Database (Migrations)
- [ ] Create tables for Finance
- [ ] Create tables for Planning
- [ ] Create tables for HR & Payroll
- [ ] Create tables for Order Management
- [ ] Create tables for Process Planning
- [ ] Create tables for Store Management
- [ ] Create tables for Sales & Marketing
- [ ] Create tables for System Integration
- [ ] Create tables for Production Tracking
- [ ] Create tables for Materials & Purchase
- [ ] Create tables for Embroidery Operations
- [ ] Create tables for System Administration
- [ ] Create tables for Logistics & Export Documentation
- [ ] Add RLS policies per role
- [ ] Add indexes for common queries
- [ ] Write DOWN migration for rollback

### Layer 3: Services (Business Logic)
- [ ] CRUD operations for Finance
- [ ] CRUD operations for Planning
- [ ] CRUD operations for HR & Payroll
- [ ] CRUD operations for Order Management
- [ ] CRUD operations for Process Planning
- [ ] CRUD operations for Store Management
- [ ] CRUD operations for Sales & Marketing
- [ ] CRUD operations for System Integration
- [ ] CRUD operations for Production Tracking
- [ ] CRUD operations for Materials & Purchase
- [ ] CRUD operations for Embroidery Operations
- [ ] CRUD operations for System Administration
- [ ] CRUD operations for Logistics & Export Documentation
- [ ] Permission checks per role
- [ ] Validation and business rules

### Layer 4: Hooks (React Query)
- [ ] useQuery hooks for Finance
- [ ] useMutation hooks for Finance
- [ ] useQuery hooks for Planning
- [ ] useMutation hooks for Planning
- [ ] useQuery hooks for HR & Payroll
- [ ] useMutation hooks for HR & Payroll
- [ ] useQuery hooks for Order Management
- [ ] useMutation hooks for Order Management
- [ ] useQuery hooks for Process Planning
- [ ] useMutation hooks for Process Planning
- [ ] useQuery hooks for Store Management
- [ ] useMutation hooks for Store Management
- [ ] useQuery hooks for Sales & Marketing
- [ ] useMutation hooks for Sales & Marketing
- [ ] useQuery hooks for System Integration
- [ ] useMutation hooks for System Integration
- [ ] useQuery hooks for Production Tracking
- [ ] useMutation hooks for Production Tracking
- [ ] useQuery hooks for Materials & Purchase
- [ ] useMutation hooks for Materials & Purchase
- [ ] useQuery hooks for Embroidery Operations
- [ ] useMutation hooks for Embroidery Operations
- [ ] useQuery hooks for System Administration
- [ ] useMutation hooks for System Administration
- [ ] useQuery hooks for Logistics & Export Documentation
- [ ] useMutation hooks for Logistics & Export Documentation
- [ ] Error handling and loading states

### Layer 5: Pages (Next.js Routes)
- [ ] List page for Finance
- [ ] Detail/edit page for Finance
- [ ] List page for Planning
- [ ] Detail/edit page for Planning
- [ ] List page for HR & Payroll
- [ ] Detail/edit page for HR & Payroll
- [ ] List page for Order Management
- [ ] Detail/edit page for Order Management
- [ ] List page for Process Planning
- [ ] Detail/edit page for Process Planning
- [ ] List page for Store Management
- [ ] Detail/edit page for Store Management
- [ ] List page for Sales & Marketing
- [ ] Detail/edit page for Sales & Marketing
- [ ] List page for System Integration
- [ ] Detail/edit page for System Integration
- [ ] List page for Production Tracking
- [ ] Detail/edit page for Production Tracking
- [ ] List page for Materials & Purchase
- [ ] Detail/edit page for Materials & Purchase
- [ ] List page for Embroidery Operations
- [ ] Detail/edit page for Embroidery Operations
- [ ] List page for System Administration
- [ ] Detail/edit page for System Administration
- [ ] List page for Logistics & Export Documentation
- [ ] Detail/edit page for Logistics & Export Documentation
- [ ] Dashboard widgets
- [ ] Mobile-responsive layouts

---

## Role Access Matrix

| Feature | Admin | Manager | User | Guest |
|---------|---|---|---|---|
| Finance | TBD | TBD | TBD | TBD |
| Planning | TBD | TBD | TBD | TBD |
| HR & Payroll | TBD | TBD | TBD | TBD |
| Order Management | TBD | TBD | TBD | TBD |
| Process Planning | TBD | TBD | TBD | TBD |
| Store Management | TBD | TBD | TBD | TBD |
| Sales & Marketing | TBD | TBD | TBD | TBD |
| System Integration | TBD | TBD | TBD | TBD |
| Production Tracking | TBD | TBD | TBD | TBD |
| Materials & Purchase | TBD | TBD | TBD | TBD |
| Embroidery Operations | TBD | TBD | TBD | TBD |
| System Administration | TBD | TBD | TBD | TBD |
| Logistics & Export Documentation | TBD | TBD | TBD | TBD |

_Run "Synthesize Build Sections" in admin to populate this matrix from interview answers._

specs-raagam.md
Displaying specs-raagam.md. Inserted interview-platform.