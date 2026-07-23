Raagam ERP – Client Discussion Notes (UI & Master Data Updates)
Discussion Date: Today
1. Item Class Master
Create a new master (child) called Item Class.
This table should contain only the following fields:
Item Class Name
Has Attribute (Yes/No)
2. Separate Item Class and Attribute Masters
Item Class and Attribute should be maintained as separate masters.
Currently, both are stored in the same table. This needs to be separated.
3. Attribute Visibility Based on Item Class
The Attribute section should be displayed only if the selected Item Class has Has Attribute = Yes.
If Has Attribute = No, the option to add attributes should be hidden.
4. Deactivate Instead of Delete
Replace the Delete option with Deactivate for records that are already used elsewhere in the system.
If a record is in use, it should automatically be marked as Inactive instead of being deleted.
If the record is not referenced anywhere, allow deletion after displaying a confirmation warning message.
5. Duplicate Validation
Currently, the duplicate validation message appears only after clicking Save.
Improve the user experience by validating duplicates while the user is typing (real-time validation).
6. Category Master
Remove the following sections from the Category master:
Costing
Additional
7. Material Master – Name Fields
Currently, the Material master contains both Short Name and Name.
Merge these into a single Name field.
8. Blocking Option
The Blocking option is currently displayed before the record is created.
Display the Blocking option only after the record has been created.
9. Item Class Selection
Instead of opening a separate screen to select an Item Class, provide it as a dropdown selection.
10. Full-Screen Form
The current side panel makes it difficult for users to navigate because of excessive scrolling.
Open the form in full-screen mode for better usability.
11. Material – Yarn Item Class Updates
Remove the Ply field from the Material – Yarn Item Class form.
For the Natural category:
Hide the Using Items section.
For the Mixing category:
Display the Using Items section with the following fields:
Yarn 
Mixing %
Shade
12. Yarn Name Generation
The yarn name is currently generated as a suggested value, requiring the user to click Add to populate the Name field.
Instead, the generated yarn name should be rendered automatically in the Name field without requiring any additional action.
13. Yarn Type-Based Form Behavior
The Type field should include the following options:
Grey
Melange
Twisted
Doubling
When Grey or Melange is selected:
Display the Details tab only.
Hide the Mixing (Using Items) section.
When Twisted or Doubling is selected:
Display the Mixing (Using Items) section.
14. Mixing Section Based on Yarn Category
The visibility of the Mixing (Using Items) section should also depend on the selected yarn category:
Natural – Hide the Mixing section.
Manmade – Hide the Mixing section.
Mixed – Display the Mixing section.
This rule should work together with the selected Type to ensure the correct form fields are displayed.
15. Default UOM for Yarn
The default UOM (Unit of Measure) for all Yarn items should be KGS.
When creating a Yarn item, the KGS unit should be automatically selected by default.
If the KGS unit is not available in the database, create it for testing purposes so the default selection can function correctly.
16. Category Type Mapping for Yarn
In the Category master, while creating a category for the Yarn Item Class, provide a Category Type field with the following options:
Natural
Mixed
Manmade
In the Material master, when the Yarn Item Class is selected and a category is chosen, the Category Type should be automatically retrieved from the selected category.
The system should use this Category Type to determine the form behavior, such as whether the Mixing (Using Items) section should be displayed or hidden.

Step 1: Category Master (The Definition): When you create a record in the Category Master for the "Yarn" item class, you must define its nature. The system specifically asks if the category is Natural, Man-made, or Mixed,. For example, a category named "Thiru Cotton" might be saved as "Natural", while another called "Thiru Cotton Mix" would be saved as "Mixed".
Step 2: Material Master (The Selection): When you later move to the Material Master to create a specific yarn item, you select the previously created Category from a list.
Step 3: Direct Display and Validation: Once you select the Category in the Material Master, the system directly shows the type (Natural, Mixed, or Man-made) associated with it.
Fixed Data Logic: The sources emphasize that this information is displayed but cannot be changed in the Material Master screen. Because the nature of the yarn was already "fixed" in the Category Master, the Material Master simply pulls that data to ensure consistency and prevent errors.
If you select a category that was defined as "Mixed" in the child master, the Material Master will then dynamically display the extra fields for Mixing Percentages and components,,.
Fabric Item Class – Client Discussion Notes
17. Fabric Type
The Fabric Item Class should support the following types:
Circular – Default UOM: KGS
Flat – UOM: Number and KGS
Woven – UOM: Meter and KGS
Business Usage:
Circular – Approximately 90% of usage.
Flat – Approximately 10% of usage.
Woven – Used rarely.

18. Structure Field
The Structure field values should be populated from the Category master.
Only categories created for the Fabric Item Class should be listed.

19. Remove Unused Fields
Remove the following fields from the Fabric master:
Short Specification
Levy Description
Commodity
Budget section

20. Fabric Category Type
While creating a Category for the Fabric Item Class, include a Fabric Type with the following options:
Circular
Flat
Woven
In the Material master, when the Fabric Item Class is selected, only the categories created for the Fabric Item Class should be displayed.
Example:
Single Jersey is a category under the Fabric Item Class and should be available for selection.

21. Fabric Type Options
The Fabric Type field should include:
Melange
Solid
Yarn Dyed

22. Direct Purchase
Add a Direct Purchase option.
If enabled, the system should not require yarn selection, as the fabric is purchased directly instead of being manufactured.

23. Yarn Selection Based on Fabric Type
Depending on the selected Fabric Type, the system should allow:
Single Yarn
Multiple Yarns
The form should dynamically support the appropriate yarn selection.

24. Automatic Fabric Name Generation
The Fabric name should be automatically generated and displayed below the Name field based on the selected values.
The generated name should update automatically without requiring any manual action.

25. Yarn Consumption Calculation
The system should calculate yarn consumption based on the entered blend percentages.
Example:
If 1 kg of fabric is required and multiple yarns are selected with percentage allocations, the system should automatically calculate the quantity required for each yarn based on its percentage.

26. Yarn Master Integration
The Yarn field in the Fabric master should list data from the Yarn master.
The Count field should retrieve its values from the Count master.

27. Category Filtering
Each Item Class should display only its own categories.
Example:
When Fabric is selected, only Fabric categories should be shown.
When Yarn is selected, only Yarn categories should be shown.

28. Melange Shared Field
Provide the required shared field(s) specifically for the Melange Fabric Type as per the client requirement.

29. Duplicate Validation
Duplicate validation should occur while the user is typing.
If the entered record already exists, the system should immediately display a validation message instead of showing it only after clicking Save.

30. Yarn Blend vs Fabric Yarn Selection
In the Yarn master, the Mixing section represents the Blend of a single yarn.
Example: One yarn may consist of Polyester + Cotton as its blend.
In the Fabric master, multiple yarns can be selected to manufacture a fabric.
The system should clearly differentiate between:
Yarn Blend (multiple fibers within one yarn)
Fabric Composition (multiple yarns used to produce one fabric)




