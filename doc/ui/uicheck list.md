If you're improving the **user experience (UX)** of an ERP, here are practical, user-friendly enhancements that make data entry much faster and reduce mouse clicks.

## Keyboard Navigation

> As shipped. The authoritative version, with the reasoning and the failure modes,
> is `.claude/skills/raagam-keyboard-contract`; it is implemented once in
> `lib/focus.ts` and delivered app-wide by `components/shell/keyboard-nav-provider.tsx`.

* **Tab / Shift + Tab** → Move to the next / previous field. Nothing else — Tab never opens a list.
* **↓** → Open this field's list of values; on a field with no list, move to the field below.
* **↑** → Move to the field above.
* **← / →** → Move to the field left / right, once the text caret has reached the edge.
* **Enter** → Pick the highlighted row when a list is open; on a tick box or radio, toggle it;
  otherwise **save the record**.
* **Space** → Tick a checkbox, or open a picker (it is a button). Enter does both jobs too.
* **Esc** → Close the list, then the form (asking if there is unsaved work), then leave the page.
* **Ctrl + S** → Save.
* **Ctrl + N** → Create new record.
* **Ctrl + F** → Search within the page.
* **Ctrl + /** → Show keyboard shortcuts.

---

## Dropdown Improvements

Instead of:

1. Click dropdown
2. Select value
3. Click **OK**

Use:

* Open dropdown automatically.
* Arrow keys to navigate.
* Press **Enter** to select.
* Auto-close the dropdown after selection.
* No separate **OK** button.

Example:

```
Status

↓ Pending
  Approved
  Rejected

↓ + Enter
Selected: Approved
```

---

## Better Focus & Active State

* Highlight the currently active field.
* Automatically move focus to the next input after selection.
* Keep the cursor in the first editable field when a page opens.

Example:

```
Customer Name  [ ACTIVE ]

Phone

Email
```

---

## Auto Focus

When opening:

* Create Customer
* Create Purchase Order
* Create Sales Order

Automatically focus on the first required field.

---

## Smart Auto Complete

Instead of scrolling through long lists:

Type:

```
Cus
```

Suggestions:

```
Customer A
Customer B
Customer C
```

Press **↓** then **Enter**.

---

## Inline Editing

Instead of opening another popup:

| Qty | Rate | Amount |
| --- | ---- | ------ |
| 10  | 250  | 2500   |

Click Qty → edit directly.

---

## Auto Save (Draft)

While filling a large form:

* Save automatically every few seconds or after important changes.
* Recover unsaved work after accidental browser close or refresh.

---

## Required Field Indicators

* Mark required fields with a red `*`.
* Validate immediately when leaving the field, instead of only after clicking Save.

Example:

```
Customer Name *

❌ Customer Name is required.
```

---

## Instant Validation

Instead of showing all errors after Save:

When leaving the field:

```
Phone Number

❌ Enter a valid 10-digit number.
```

---

## Smart Default Values

Automatically fill common values.

Examples:

* Current Date
* Current User
* Default Warehouse
* Default Currency
* Last Selected Company

---

## Type-Ahead Search

Searching for:

```
Cot
```

Shows:

* Cotton
* Cotton 40s
* Cotton Combed
* Cotton Organic

---

## Better Table Navigation

In grids:

* Tab → Next cell
* Enter → Next row; on the last row, add a row
* ↑ / ↓ → Previous / next row, same column
* ← / → → Previous / next column
* ↓ on a picker cell → Open its list (↑ and Enter still move rows from that cell)
* Tick-box cells navigate like any other column; Enter on one ticks it. Radios are the
  exception — ↑/↓ there move within the radio group, as they do natively.
* Ctrl + C / Ctrl + V → Copy and paste rows or cells
* Delete → Clear selected value

Similar to Excel. Note this is the one place Enter does **not** save: inside a grid
the operator is entering line items, and stepping to the next row is what they mean.

---

## Sticky Action Buttons

Keep **Save**, **Cancel**, and **Submit** visible while scrolling long forms.

---

## Multi-Select Without Popup

Instead of:

```
Select Vendor
Click OK
```

Use checkboxes:

```
☑ Vendor A
☑ Vendor B
☐ Vendor C
```

Press **Enter** to confirm.

---

## Loading Improvements

* Show skeleton loaders instead of blank screens.
* Disable only the Save button while saving, not the whole page.

---

## Confirmation Messages

Replace intrusive popups with small toast notifications:

```
✔ Purchase Order Saved Successfully
```

---

## Undo Instead of Confirmation

Instead of asking:

> "Are you sure you want to delete?"

Delete immediately and show:

```
Item Deleted
Undo
```

---

## Responsive Layout

* Reduce unnecessary scrolling.
* Group related fields into collapsible sections.
* Use two or three-column layouts on desktop where appropriate.

---

## Quick Actions

View / Edit / Delete are the row's own icon buttons, not menu items — see
`doc/ui/LAYOUT.md` §6a. The three-dot menu carries only the extras:

* Duplicate
* Print
* Export

> Delete was originally listed here. It is deliberately **not** in the menu: it is the one
> irreversible action on the row, and putting it a click deeper than Edit inverted the risk.
> It stays a first-class icon with its confirm step inline.

---

## Favorites & Recent Items

* Pin frequently used modules.
* Show recently opened records.
* Display recent searches.

---

## Bulk Operations

Allow users to:

* Select multiple rows.
* Delete multiple records.
* Update status in bulk.
* Export selected records.

---

## Overall UX Checklist

* ✅ Full keyboard navigation (Tab, Enter, Arrow keys)
* ✅ Auto-select dropdown values (no OK button)
* ✅ Clear active field highlighting
* ✅ Auto focus on first input
* ✅ Smart autocomplete
* ✅ Inline editing
* ✅ Instant validation
* ✅ Auto-save drafts
* ✅ Keyboard shortcuts
* ✅ Excel-like table navigation
* ✅ Sticky Save/Cancel buttons
* ✅ Toast notifications instead of popups
* ✅ Undo for delete actions
* ✅ Bulk actions
* ✅ Favorites and recent records
* ✅ Responsive, uncluttered layouts

These improvements can significantly reduce clicks, speed up data entry, and make your ERP feel much more modern and efficient for daily users.
