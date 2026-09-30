# Permission Overrides — how to use them

A **permission override** lets a named person correct an **approved** order in place — a
missing rate, a wrong delivery date, a BOM line — without raising an Order Revision and
waiting for the MD. The change goes straight into the approved version, and every changed
field is recorded for the MD.

Use it for small corrections. Anything that needs the MD's decision still goes through
**Orders ▸ Order Management ▸ Order Revisions**.

## Who can do what

| Person | Can |
|---|---|
| Administrator or Managing Director | Grant, renew and revoke overrides; read the Override Edit Report |
| The person granted access | Edit the granted modules of approved orders until the access expires |
| Everyone else | Sees a note on the order's reports when override edits exist |

You cannot grant an override to yourself. The person must already be able to edit
orders — an override only lifts the approval lock.

## Grant access

1. Open **Administration ▸ Access Control ▸ Permission Overrides**.
2. Press **+ Grant Access**.
3. Pick the **User**. A user shown greyed out cannot edit orders at all; give them an
   order role first.
4. Tick the **Modules** — the same choices as Raise Revision:
   - Order Entry: Quantity Addition · Quantity Cancellation · Price Change ·
     Delivery Date Extension · Combo / Color Change
   - Material BOM · Fabric BOM · Order Budget
5. Set **Expires** — use 1 day / 3 days / 7 days, or pick a date and time. At most 30 days.
6. Write the **Reason** (at least 10 characters) and press **Grant access**.

**Renew** (↻ on the row) grants the same person again with a new expiry. **Revoke** (⊘)
takes the access away at once — the person's very next save is refused. **History** shows
every grant, renewal and revoke on that row. Grants are never deleted.

## Make a change (the person granted access)

1. Open the approved order in **Order Entry**, **Fabric BOM**, **Material BOM** or
   **Budgeting**. A yellow band reads *"Override edit mode — changes save directly to
   approved version Vn. Access expires …"*.
2. Only the sections your modules cover can be edited. Price Change, for example, unlocks
   the price sections and nothing else. Calculated figures stay read-only.
3. Press **Commit Changes (Override)**, write why, and confirm.

Some rules are checked for you:
- A **Delivery Date Extension** only moves the date later.
- A **Quantity Addition** only raises the total pieces; a **Quantity Cancellation** only
  lowers it.
- An order under a revision, or whose budget is with the MD, cannot be overridden — make
  the change inside the revision, or wait for the decision.
- If your access expires or is revoked while you are editing, the save is refused and
  what you typed stays on screen so you can copy it.

## Review the changes (MD and administrators)

**Reports ▸ Override Edit Report** lists every field changed under an override — old and
new value, who, why, when, on which order and version — newest first, one save's fields
together. Filter by date, RE No, user or module; export to Excel or PDF.

Every report of an order with override edits also carries the line *"This version
includes N post-approval override edit(s). See Override Edit Report."*
