Configuring Masters for Material and Process Data Management
1 source
·
14 Jul 2026
This transcript details a technical discussion regarding the configuration of a Material Master database within an industrial software system. The participants focus on defining the logical parameters for fabrics and yarns, specifically how different knitting types—such as circular and flat—dictate units of measurement like kilograms or numbers. They address the necessity of automated naming conventions to prevent duplicate data entries and ensure inventory accuracy across purchasing and production. The dialogue also covers the setup of ancillary materials like labels and threads, alongside the integration of taxation levies and process master settings for activities like printing and dyeing. Finally, the conversation highlights the importance of blocking versus deleting records to maintain data integrity once items are linked to active purchase orders.

Today • 10:44
summarize the full flow

The full flow for configuring masters for material and process data management follows a structured logic designed to ensure data consistency, prevent duplicates, and automate calculations for production and procurement.
1. Foundational Configuration (Category Master)
The flow begins with the Category Master, which acts as a template for defining the attributes required for different materials
.
Defining Questions: For each category (e.g., fabric or trims), users define specific "questions" or attributes that must be answered during material creation, such as the material type or finishing
.
Validation: Fields can be marked as mandatory to ensure essential data is always captured
.
2. Material Master Configuration
This is the core of the system where different item classes are defined with specific logic:
Fabric Master:
Type Selection: Users choose between Circular Knit (billed in KG), Flat Knit (billed in numbers and weight), or Woven (billed in meters and KG)
.
Structure and Category: Names like "Single Jersey" are pulled from the Category Master to maintain standard naming conventions
.
Yarn Integration: Fabrics are linked to yarns using either a Single or Multiple yarn selection
. For blended fabrics, users define percentages (e.g., 60% Cotton, 40% Polyester) so the system can automatically calculate how much of each raw material to purchase based on the total fabric required
.
Yarn Master:
Auto-Generation of Names: To prevent duplicate records caused by minor typing variations (e.g., "30s Cotton" vs. "30 S Cotton"), the system generates yarn names based on fixed parameters: count, category, and purity
.
Categories: Yarns are classified as Natural (Cotton, Linen), Man-made (Polyester, Rayon), or Mixed
.
Sewing Accessories (Trims):
Attribute-Based Setup: Items like labels or thread are created by answering predefined questions about their type (printed vs. laminated) and material
.
Units of Measure (UOM): The system supports alternate UOMs, such as tracking sewing thread by "cones" for purchasing while planning consumption in "meters"
.
3. Process Master and Components
Process Definition: Manufacturing steps (e.g., printing, dyeing) are recorded with both long and short descriptions for report formatting
.
Billing Logic: A critical setting determines if a process is billed based on Inward or Outward quantity
. For instance, dyeing might be billed on the weight sent in, whereas printing is typically billed only for the successful pieces delivered out
.
Component Master: Defines garment coordinates (e.g., top, bottom) and their relationship to specific styles
.
4. Commercial and Financial Masters
Levi (GST) Master: Configures tax percentages (CGST, SGST, IGST) based on whether the vendor is intra-state or inter-state, which then automatically calculates values in Purchase Orders (POs)
.
Terms and Conditions: Predefined conditions can be created for different material classes (e.g., Fabric vs. Trims) to be printed automatically on DCs and POs
.
5. Data Integrity and Maintenance
Blocking Records: Instead of deleting a master record that is already linked to a transaction (which would cause errors in historical data), the system uses a Block feature
. This prevents the item from being used in future orders while keeping the record intact for past transactions
.
Add-on-the-fly: Users can add new structures or categories directly from the material creation screens if they have the necessary permissions, avoiding the need to navigate back to the main master screens
.
1000 - button remove
master data click sidebar clcike needs from that arrow i fthey click the sidebar menu its not now opening make if the manu is clicked can open the sub modules
fab -type :circulr knit -kg
fab -type :flat knit -clor
fab -type : woven -meter or kg
Circular knit widely using type
strutuer field value from category master
uom tab -remove budget section
yarn form material deatail- item class- - yarn
in yarn based on yarn count- category -mixing percentage -each fields value from comes from stored data with add ,update,delete option befro deleting ask warning message


curd function
blocked if the item is not used means can delete if we used before any where instead of deleting can block it for maintaining the history of the item -this is the current system using what can we do better think -the notes taken  by me while in this meeting dicaussion is this help full

Your notes from the meeting discussion are highly accurate and capture the critical logic changes discussed. Based on the sources, here is a summary of the flow and technical requirements, followed by some insights on how to improve the current system.
UI and Navigation Adjustments
Button Removal: You are correct in noting the removal of the "Tava" button (தவ பட்டன்) located at the top of the Material Master screen, as it is no longer needed
.
Sidebar Logic: Currently, the sidebar menu requires clicking the small arrow to reveal sub-modules. The requirement is to make the entire sidebar menu item clickable so that the menu expands when the text itself is clicked
.
UOM Tab: The "Budget" section should be removed from the Unit of Measure (UOM) tab for all materials, including fabrics and sewing accessories, as it is not currently required for the accounting or planning flow
.
Fabric Master Logic
The system distinguishes fabric types based on billing units and usage
:
Circular Knit: Billed strictly in KG. This is the most widely used type, accounting for approximately 90% of usage
.
Flat Knit (e.g., Collars/Cuffs): Billed in both Numbers and Weight (e.g., 10 collars = 1 KG)
.
Woven: Billed in Meters and KG
.
Data Integrity: The "Structure" field must pull its values directly from the Category Master to ensure consistent naming (e.g., "Single Jersey")
.
Yarn Master and Auto-Generation
Item Class: To create yarn, the Item Class must be set to "Yarn" within the Material Master
.
Attribute Selection: Yarn names should be auto-generated based on:
Count (from Count Master)
.
Category (Natural, Man-made, or Mixed)
.
Mixing Percentage (for blended yarns like Poly-Cotton)
.
Prevention of Duplicates: The sources emphasize that users should select attributes from predefined lists rather than typing names manually
. This prevents duplicate records caused by variations like "30s", "30 S", or "30-S"
.
Data Lifecycle (CRUD and Blocking)
Your notes on the "Delete vs. Block" logic align perfectly with the source
:
Delete: Only permitted if the record has not been used in any transaction or linked to another module
.
Block: If an item is already linked to an order or Purchase Order (PO), it cannot be deleted. Instead, it should be blocked so it no longer appears for future selection while preserving the history for past transactions
.
How to Make the System Better
While your notes are helpful, the discussion suggests a few ways to enhance the "current system":
Enforce Strict Naming Conventions: To improve data analytics, the system should strictly block manual typing for yarn and material names
. By only allowing selections from the Count, Category, and Purity masters, you ensure that stock reports are always accurate and free of duplicates
.
Usage Transparency: Before a user attempts to delete a record, the system could provide a "View Usage" report. Instead of just a warning message, it could show exactly which PO or Style is preventing the deletion, making it easier for the user to understand why they must "Block" instead of "Delete"
.
Process-Based Billing Logic: Ensure the "Inward/Outward" billing logic for processes is automated
. For example, the system should automatically know that Dyeing is billed on inward weight while Printing is billed on successful outward pieces, reducing manual errors during invoice verification
.
Add-on-the-fly with Permissions: While the "Add" button in material creation is helpful for speed, it should be restricted by user roles to prevent unauthorized users from creating new categories or structures that might bypass standard protocols
.
Tell me more about the Inward/Outward billing logic.

The Inward/Outward billing logic is a critical configuration within the Process Master that defines how a vendor is paid based on the quantity of material handled during a specific manufacturing stage
. This setting ensures that the system automatically validates and calculates the correct payable amounts when bills are submitted
.
The Two Types of Billing Logic
The logic distinguishes between the quantity sent to a processor and the quantity received back:
Based on Inward Quantity: Billing is calculated on the amount of material sent out for processing
.
Example (Dyeing): If 500kg of fabric is sent for dyeing and only 450kg is received back (due to shrinkage or process loss), the system will bill for the original 500kg sent inward to the process
.
Based on Outward Quantity: Billing is calculated only on the successful quantity received back after the process is completed
.
Example (Printing): If 500 garment pieces are sent for printing and only 450 pieces are successfully printed and returned, the vendor is paid only for the 450 pieces delivered outward from their facility
.
Implementation in the System
Process Master Setup: This logic is predefined for every manufacturing step, such as knitting, dyeing, or printing
.
Automatic Validation: When a user enters a bill or processes an order, the system refers to these master settings to determine whether to allow billing for the inward or outward quantity
.
Data Accuracy: By defining this at the master level, the system prevents manual errors, such as overpaying for failed prints or underpaying for fabric that naturally lost weight during a chemical process like dyeing
.
Application to Items: This logic is typically mapped to processes involving specific item classes, such as fabrics, yarns, or garment components
.
Tell me more about the single and multiple yarn selection.

In the fabric master configuration, the selection between single and multiple yarns is a critical step that determines how the system calculates raw material requirements and consumption.
Single Yarn Selection
Definition: This is used when the fabric is knitted using only one type of physical yarn
.
Composition: Even if the yarn itself is a blend (e.g., 60% Polyester and 40% Cotton), it is still considered a single yarn selection because the mixing happens within that one thread
.
Usage: Most standard fabrics, like a basic 100% Combed Cotton Single Jersey, fall under this category
.
Multiple Yarn Selection
Definition: This refers to using two or more physically distinct yarns simultaneously during the knitting process
.
Example (Rib Fabric): A common example is "Rib" fabric used for collars or neckbands, where a standard cotton yarn is knitted together with a separate elastic or elastane yarn
.
Complexity: Users can define multiple yarns (e.g., two, three, or four) to create specific fabric structures
.
System Logic and Calculations
The primary purpose of these selections is to automate the procurement and planning process:
Percentage-Based Splitting: When setting up multiple yarns, you assign a percentage to each (e.g., 60% of Yarn A and 40% of Yarn B)
.
Automated Requirements: If a garment requires 1kg of fabric, the system uses these master settings to automatically calculate that it needs to purchase or issue 600g of Yarn A and 400g of Yarn B
.
Auto-Naming: As you select yarns and define their percentages, the system automatically generates the fabric name (e.g., "60% Combed Cotton / 40% Cotton Slub") to ensure consistency and prevent duplicate records
.
tell me about yarn type and quantity choosing the caulation

In the material management system, the selection of yarn types and the subsequent quantity calculations are designed to automate procurement and ensure data consistency.
1. Yarn Selection Types in Fabric Creation
When creating a fabric master, you must define the "Using" field to specify how many distinct physical yarns are required for the knitting process
:
Single Yarn Selection: This is used for fabrics knitted with a single type of thread
. Even if that thread is a blend of different fibers (like Polycotton), it is still considered a single selection because it is one physical yarn being knitted
.
Multiple Yarn Selection: This is used for fabrics that require two or more physically distinct yarns to be knitted together
. A common example is "Rib" fabric, where a cotton yarn and an elastane (elastic) yarn are used simultaneously
.
2. Internal Yarn Blending (Mixed Yarns)
Aside from the fabric's yarn selection, individual yarns can be classified by their fiber composition in the Yarn Master
:
Natural: 100% natural fibers like Cotton or Linen
.
Man-made: Synthetic fibers like Polyester or Rayon
.
Mixed: A blend of different fibers within a single thread (e.g., 60% Polyester and 40% Cotton)
.
3. Automated Quantity Calculations
The system uses the percentages defined in the master data to automatically calculate raw material requirements for production and procurement
.
Percentage-Based Splitting: When setting up a fabric or a mixed yarn, you define the percentage split (e.g., 60% of Yarn A and 40% of Yarn B)
.
Automated Requirements: If a style requires a specific total weight of fabric—for example, 1kg of fabric—the system refers to the master percentages to split the requirement
.
Calculation Result: In a 60/40 split, the system will automatically determine that 600g of Yarn A and 400g of Yarn B must be issued or purchased
.
4. Data Integrity and Auto-Naming
To prevent errors in these calculations caused by duplicate records, the system automatically generates the names for fabrics and yarns based on the selected attributes and percentages
. This ensures that the same material is not created multiple times under slightly different names (e.g., "30s" vs "30 S"), which would otherwise make it impossible to track accurate stock and consumption
.
How does the system ensure data integrity and naming conventions?

The system ensures data integrity and strict naming conventions through a combination of automated name generation, attribute-based selection, and a "block" logic for historical maintenance.
1. Automated Naming Conventions
To prevent the creation of duplicate records caused by manual typing variations (such as "30s Cotton" versus "30 S Cotton" or "30-S"), the system auto-generates names based on predefined attributes
.
Yarn Names: These are formed by combining the Count, Category, and Purity/Mixing Percentage selected from master lists
.
Fabric Names: As a user selects yarns and assigns their respective percentages (e.g., 60% Cotton / 40% Polyester), the system automatically compiles the fabric name to ensure consistency across all records
.
Short Names/Specs: For formatting on Delivery Challans (DCs) or reports where space is limited, the system uses Short Specs to ensure the core identification of the material remains clear without being cut off
.
2. Attribute-Based Data Entry
Instead of allowing free-text entry, the system forces users to select values from established master records, which acts as a validation layer:
Category Master Integration: The "Structure" and "Category" fields in the Material Master pull directly from the Category Master
.
Mandatory Fields: Within the Category Master, specific attributes (questions) can be marked as mandatory, ensuring that essential data like material type or finishing is never missed during creation
.
Fixed Billing Logic: Fabric types are strictly tied to specific units of measure (e.g., Circular Knit is always billed in KG), which prevents errors in stock management and financial reporting
.
3. Preservation of History (Block vs. Delete)
To maintain the integrity of historical transactions, the system restricts the deletion of data:
Conditional Deletion: A record can only be deleted if it has never been used in any transaction or linked to another module
.
Blocking Logic: If a material or process has already been used in an order or Purchase Order (PO), the system will not allow it to be deleted as this would break the links in past records
. Instead, the item is blocked, which prevents it from being selected for any future orders while keeping the historical data intact
.
4. System-Driven Calculations
Integrity is further maintained by automating the relationship between materials:
Mixed Yarn Validation: For blended yarns, the system requires fiber percentages that must total 100%, ensuring procurement calculations for raw materials are always accurate
.
Component Mapping: The system can be configured to restrict specific components (like "Tops") to certain styles, preventing users from accidentally selecting incompatible coordinates during order entry
.
Tell me more about the internal yarn blending and mixed yarns.

Internal yarn blending and mixed yarns refer to the process of combining different types of fibers into a single physical thread. This is a key configuration in the Material Master that ensures accurate naming, stock tracking, and procurement.
Categorisation of Yarn Fibres
The system classifies yarns into three primary categories based on their fiber content:
Natural Yarns: These consist of 100% natural fibers, such as Cotton or Linen
.
Man-made Yarns: These are composed of synthetic fibers like Polyester or Rayon
.
Mixed Yarns: These are created by blending different fibers together within the same thread, such as Poly-cotton (a mix of Polyester and Cotton)
.
Configuring Blending Percentages
When a user selects the "Mixed" category in the system, a specific validation logic is triggered:
Mandatory Mixing Fields: The system prompts the user to define exactly which fibers are being used and their respective percentages
.
The 100% Rule: For a mixed yarn to be valid, the total percentage of all blended fibers must equal 100%
. For example, a common blend might be defined as 60% Polyester and 40% Cotton
.
The "Single Physical Yarn" Logic
It is important to distinguish between mixed yarns and multiple yarn selection:
A mixed yarn is treated as a single yarn during the fabric knitting process because it arrives as one physical strand of thread, regardless of its internal fiber blend
.
This differs from "Multiple Yarn Selection," where two or more physically separate threads (e.g., one cotton thread and one elastane thread) are knitted together to form a fabric like Rib
.
Data Integrity and Auto-Naming
To maintain data integrity, the system auto-generates the name of mixed yarns based on the selected attributes:
Components of the Name: The generated name includes the Count, the Category, and the Blending Percentages
.
Purpose of Naming: This allows staff to identify the exact composition of the yarn (e.g., a 60/40 blend vs. a 50/50 blend) directly from a list or a Purchase Order (PO) without having to open the individual record
.
Prevention of Duplicates: By using predefined selections for count and category, the system prevents users from creating duplicate records through manual typing variations (e.g., "PC" vs. "Poly-Cotton")
.
Can we configure GST percentages for specific vendors and regions?

Yes, you can configure GST percentages based on regions and vendors through the Levi (GST) Master
.
The system uses specific logic to handle different tax requirements depending on where the vendor is located:
Intra-state (Within the same state): For vendors located in the same state (e.g., within Tamil Nadu), the system is configured to split the total GST percentage into CGST and SGST
. For instance, an 18% tax rate would be automatically divided into 9% CGST and 9% SGST
.
Inter-state (Different states): For vendors located in a different state, the system applies the IGST (Integrated GST) logic
.
Application in Transactions: These configurations are not used in the initial style or order entry but are specifically selected during the creation of a Purchase Order (PO)
. Based on the vendor's location and the selected tax category, the system automatically calculates the appropriate tax amounts to be included in the purchase value
.
By setting these up in the Master, the system ensures that the correct tax breakdown is applied automatically during procurement without manual calculation
.
Can users add new categories during material creation?

Yes, users can add new data, such as structures, directly from the material creation screen without needing to navigate back to the primary master settings
.
The sources highlight several details regarding this "add-on-the-fly" functionality:
Ease of Use: The system includes an "Add" button within the Material Master to allow users to create a new structure if it does not already appear in the dropdown list
. This is designed to make the workflow more efficient so users don't have to leave their current screen
.
Yarn Creation: Similarly, when creating a fabric, if a specific yarn needed for the composition is missing from the list, the user can click "Add" to open a screen and create that yarn immediately
. Once saved, it will automatically appear in the list for selection
.
Permissions: It is noted that this ability to add new master-level data like structures directly from the material screen is typically intended for admin users
.
Data Source: While these attributes are added "on the fly," they are still linked to the Category Master, which is the central location where these names and structures are officially stored
.
This feature ensures that production workflows are not interrupted by missing master records while still maintaining the overall data structure
.
How do short specifications work for long material names?

Short specifications (or "short specs") are designed as a functional workaround for handling material names that are too long to be properly displayed or printed
.
Based on the sources, here is how they work:
Handling Print Constraints: The primary reason for short specs is that full material names can sometimes be very lengthy
. If these long names were used on documents like Delivery Challans (DCs), they might not fit the layout or could be cut off during printing
.
System Logic: By defining a short spec, the system has an alternative, concise name to pull for specific reports and printouts, ensuring the information remains legible and fits within the designated space
.
Programming and Formatting: For certain modules—like manufacturing processes where names can reach up to 200 characters—the software may not allow the selection of the full long name in specific fields
. The short version is used to facilitate smoother data handling and selection within the software's interface
.
Usage Policy: While the feature exists to maintain professional formatting on documents, the sources mention that for new data entries, users may not always find it necessary to fill out unless they anticipate a specific need for it on their printed forms
.
Explain the difference between natural and mixed yarns.

Based on the sources, the difference between natural and mixed yarns lies in their fiber composition and how the system handles their data entry.
1. Composition and Examples
Natural Yarns: These consist of 100% natural fibers. Common examples mentioned include Cotton and Linen
.
Mixed Yarns: These are created by blending different fibers—often combining natural and man-made fibers—into a single physical thread. A common example is Poly-cotton, which blends Polyester and Cotton
.
2. System Logic and Validation
The system treats these categories differently during the yarn creation process:
No Mixing Required for Natural: When a user selects a natural yarn (like 100% Cotton), the system does not ask for a mixing percentage because the purity is understood to be 100% of that single fiber
.
Mandatory Percentages for Mixed: If the "Mixed" category is selected, the system triggers a validation requirement where the user must specify the fibers being used and their respective percentages (e.g., 60% Polyester and 40% Cotton)
. The system enforces a "100% Rule," meaning the total of all blended fibers must equal exactly 100% to be valid
.
3. Physical State in Production
Despite the internal difference in fibers, both are considered a single yarn in the context of fabric knitting
.
A natural yarn is a single thread of 100% cotton
.
A mixed yarn is also a single physical thread, but the blending (like Poly-cotton) happens inside that one thread
.
This is distinct from "Multiple Yarn Selection," where two or more physically separate threads are knitted together to create a fabric
.
What is the impact of selecting a conversion process?

Based on the sources, the conversion process is identified as a necessary field within the Process Master configuration
.
However, the specific impact of selecting this option is not detailed in the provided transcript. When the topic is raised, the speaker notes that the conversion process is a required feature but explicitly defers the explanation, stating they will describe how it works at a later time when it becomes relevant to the workflow
.
Outside of the Process Master, the term "converted" also appears in the context of sewing accessories (trims)
. In that module, users must categorize an item—such as a label—as being either "purchase," "converted," or "production"
. While the transcript does not explain the functional impact of these selections, it suggests that "conversion" is a primary way the system classifies how materials are handled or acquired beyond simple purchasing or internal production
.
What is the difference between purchase, converted, and production items?

For sewing accessories (trims), such as labels, the system classifies items into three types: purchase, converted, and production
. This classification determines how the item is handled within the procurement and manufacturing workflow.
1. Purchase Items
These are materials that are bought directly as finished products from a vendor
.
Configuration: When an item is marked as "purchase," the system requires the user to define it by answering specific attribute-based questions
.
Attributes: For a label, this includes selecting the label category (e.g., main label), the type (e.g., printed or laminated), the material (e.g., canvas), and the finishing (e.g., roll form or cut and seal)
.
Logic: The system uses these answers to generate the item's unique identity and prevent duplicates
.
2. Converted Items
These are items that undergo a transformation process before they are ready for use
.
Process Integration: The sources indicate that a "conversion process" is a mandatory configuration field within the Process Master
.
Functional Impact: While the specific technical logic for how "converted" items behave differently from purchase items is noted as a topic for a later discussion, the classification suggests they are tracked through specific manufacturing conversions rather than simple procurement
.
3. Production Items
These are items that are manufactured or processed internally or through a series of production steps rather than being acquired as finished goods
.
Contrast with Purchase: In the fabric master, a similar logic is applied where "direct purchase" means buying the finished fabric directly without needing to specify yarn
.
Workflow: Conversely, a production-style item (as seen in the fabric flow) would involve buying raw materials (like yarn) and then putting them through stages such as knitting, dyeing, and processing
.
Note: While the sources list these three categories as the primary types for sewing accessories, the detailed functional differences for "converted" and "production" items specifically within the trims module are not fully elaborated upon in the provided transcript
.
Tell me more about the Inward/Outward billing logic

The Inward/Outward billing logic is a configuration within the Process Master that determines whether a vendor is paid based on the quantity of material sent to them or the quantity successfully received back after processing
. This ensures that the system handles billing correctly for different types of manufacturing steps.
Inward Quantity Billing
Definition: Billing is calculated based on the quantity of material sent into the process
.
Usage Case (Dyeing): This is typically used for processes where natural weight loss or shrinkage occurs
.
Example: If you send 500kg of fabric for dyeing and only 450kg is received back due to the nature of the chemical process, the vendor is still paid for the original 500kg that was sent inward
.
Outward Quantity Billing
Definition: Billing is calculated only on the successful quantity received back (the outward flow) from the vendor
.
Usage Case (Printing): This is used for processes where the vendor is responsible for the successful output of specific units
.
Example: If you send 500 garment pieces for printing and the vendor only returns 450 successfully printed pieces, the system will only allow billing for the 450 pieces received outward
.
System Impact
Automated Validation: By setting this logic in the Process Master, the system automatically controls how bills are allowed and how quantities are calculated during the invoicing phase
.
Process Specifics: This setting can be mapped differently depending on whether the process involves yarn, fabric, trims, or garment components
. For example, printing is most commonly associated with garment components
.
so atmoste we dicuased all the recording notes arenot

Yes, your notes capture the vast majority of the critical technical requirements discussed in the recording. They align well with the core logic for the fabric master, yarn master, and the block/delete functionality.
To ensure your documentation is 100% complete based on the sources, here are a few additional details from the discussion that you might want to include in your "full flow":
1. Mixed Yarn Validation (The 100% Rule)
While you noted the mixing percentage for yarns, the recording highlights a specific validation rule: for mixed yarns (like Poly-cotton), the total of the fiber percentages must equal exactly 100% to be saved
.
2. Process Master Billing Logic
A significant part of the discussion focused on how vendors are billed for processes like dyeing and printing:
Inward Quantity: Billing is based on what you send (e.g., dyeing is billed on the 500kg sent, even if only 450kg is received back)
.
Outward Quantity: Billing is based only on successful output (e.g., printing is billed only for the 450 successful pieces received back)
.
3. Short Specifications for Printing
The recording mentions that "Short Specs" are necessary because full material or process names can be too long (up to 200 characters)
. These short names ensure that data fits properly on Delivery Challans (DCs) and other printed reports without being cut off
.
4. Commercial Masters (GST & Terms)
Levi (GST) Master: Taxes are split into CGST/SGST for intra-state vendors and IGST for inter-state vendors, which is automatically calculated during Purchase Order (PO) creation
.
Terms and Conditions: You can pre-set specific conditions for different material classes (like fabrics vs. trims) so they print automatically on the relevant documents
.
5. Component Mapping
In the Component Master, there is a feature to restrict certain parts (like "Tops") to specific styles or coordinates, ensuring that only the correct components are selectable during order entry
.
Conclusion: Your notes are a great summary of the immediate UI and data entry changes. Adding these extra points—specifically the Inward/Outward billing and the 100% rule for yarn—would make your "full flow" documentation complete
.
How does the system prevent naming duplicates in masters?

The system prevents naming duplicates in the masters by using automated name generation based on predefined attributes rather than allowing users to type names manually
. This structure ensures that materials are recorded consistently across the entire database.
1. Attribute-Based Selection
Instead of free-text entry, which often leads to variations like "30s," "30 S," or "30-S," the system requires users to select specific values from established master lists
.
Yarn Names: These are automatically compiled by the system using the Count (from the Count Master), the Category (e.g., Natural, Man-made), and the Purity or Mixing Percentage
.
Fabric Names: The fabric name is generated based on the selected Structure and the specific Yarn(s) and percentages assigned to it
.
2. Automated Validation and Error Messaging
The system includes built-in checks to identify if a specific combination of attributes has already been registered.
Duplicate Detection: If a user attempts to create a yarn that exactly matches an existing record's attributes (e.g., the same count, category, and purity), the system will flag that it has already been created and prevent the user from saving a duplicate entry
.
Data Consistency: By forcing selections from a fixed list, the system ensures that stock reports and data analytics remain accurate, as all transactions for a specific material will link back to a single, unique master record
.
3. Controlled Additions ("Add-on-the-fly")
While the system allows users to add new structures or yarns directly from the material creation screen (to avoid leaving the workflow), these additions are still funneled through the same attribute-based logic
. This feature is typically restricted to admin users to maintain oversight and prevent the unnecessary proliferation of categories
.
4. Short Specifications
For materials with exceptionally long names (up to 200 characters), the system uses Short Specs
. This allows the software to handle a concise version of the name for specific printouts or report layouts where the full, auto-generated name might be cut off, while still maintaining the primary unique record in the master
.
Why are short specifications used for delivery challans?

Short specifications (or "short specs") are primarily used for Delivery Challans (DCs) to address layout and printing constraints caused by lengthy material or process names
,
.
According to the sources, these short names serve several functional purposes:
Fitting Print Layouts: Full names can sometimes be extremely long, making it impossible to print them clearly on a standard DC
. Using a short specification ensures that the material's identification fits within the designated space on the document
.
Handling Character Limits: Some process names can reach up to 200 characters
. The sources note that the software may not allow the selection or display of such long names in certain "important places" or during specific programming tasks
.
Ensuring Legibility: By providing a concise version of the name, the system ensures that the core description of the item or process is not cut off, maintaining professional formatting on printed forms
,
.
While the system supports these short specs for formatting reasons, it is also noted that they may not be mandatory for every new entry unless there is a specific need for that name to appear on a printed report
.
What is the purpose of the 100% rule for yarns?

The 100% rule for yarns is a system validation requirement specifically used when creating mixed yarns (blended fibers within a single thread). Its purpose is to ensure data integrity and accurate material tracking in several ways:
Validation of Fiber Composition: For mixed yarns, such as Poly-cotton, the system requires users to define the specific fibers being used
. The rule mandates that the sum of these individual fiber percentages must equal exactly 100% for the record to be valid and saved
.
Defining a Single Physical Entity: The rule serves to confirm that, despite being a blend of different materials (e.g., 60% Polyester and 40% Cotton), the resulting product is one single physical yarn
. This distinguishes mixed yarns from "multiple yarn selection," where separate threads are knitted together
.
Accurate Procurement and Naming: By enforcing the 100% total, the system can automatically generate precise names that reflect the exact blend
. This allows staff to identify the specific composition (such as a 70/30 vs. a 50/50 blend) directly from a list or Purchase Order, which is essential for identifying the correct stock and calculating raw material requirements
.
Preventing Data Duplication: Ensuring that every yarn has a complete and standardized percentage breakdown helps prevent users from creating duplicate records with minor variations, which would otherwise make it impossible to track accurate stock levels
.
Tell me more about the 100% rule for yarns.
How does the system prevent naming duplicates in masters?
Why are short specifications used for delivery challans?