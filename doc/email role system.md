# Implementation Spec — Email-Based Permission Overrides (Raagam ERP)

| | |
|---|---|
| **Version** | v1.0 (29 Sep 2026) |
| **Prepared by** | Jicate Solutions — Mohanraj Venkatesan |
| **For** | Claude Code (implementation agent) and the reviewing developer |
| **Source** | "Technical Specification: Email-Based Permission Overrides for Raagam ERP Access Control" (business spec) |
| **Status** | Ready to implement once the decisions in §11 are confirmed |

---

## 0. How to use this document (read first, Claude Code)

1. **Do not start coding immediately.** Run Phase 0 (§9) first: explore the codebase and write `docs/override-feature/FINDINGS.md`. Then stop and wait for the developer to confirm.
2. The business spec refers to "Source 5" (Order Amendments screen) and "Source 8" (Staff Master). These are **existing parts of the Raagam ERP codebase**, not files you have. Find them in Phase 0.
3. SQL below is written for **MySQL 8 / MariaDB 10.6+**. If the project uses a different database or an ORM with its own migration format, translate it — keep the columns, constraints and behaviour identical.
4. Rules are numbered (`R-1`, `R-2`…). Reference them in code comments, commit messages and tests so the reviewer can trace every change back to this spec.
5. When something in the codebase contradicts this spec, **do not guess** — record it in `FINDINGS.md` under "Conflicts" and ask.
6. Work phase by phase. Each phase ends with passing tests and a short summary of files changed.

---

## 1. Feature summary

Approved orders (V1, V2 …) are locked. Changing them today requires a formal amendment with MD approval, which blocks small corrections (a missing rate, a BOM error) and can stall production.

This feature lets an administrator grant **named users (identified by email)** a time-limited right to edit specific locked modules **in place**, without creating a new amendment version and without MD approval. Every such edit is fully audited and visible to the MD.

**Modules in scope:** Order Entry (5 sub-types), Material BOM, Fabric BOM, Order Budget.

**Out of scope (v1):** approving amendments via override, PO generation rules, any module not listed above, email/notification sending.

---

## 2. Business rules

| ID | Rule |
|---|---|
| **R-1** | An override is identified by `(user_email, module_key)`. Emails are stored and compared **lower-cased and trimmed**. |
| **R-2** | An override is **active** only if: `can_edit = TRUE` AND `revoked_at IS NULL` AND (`override_expiry IS NULL` OR `override_expiry > now`) AND the user exists and is active in the users table. |
| **R-3** | Overrides **only elevate** access. An override row can never make a user's access lower than their role would give. *(Fixes a bug in the source resolver — see §12.)* |
| **R-4** | Effective edit access for a module on an order is: `(order is unlocked AND role allows edit)` OR `(override is active for that module)`. |
| **R-5** | "Locked" means order state is **Approved**, **Pending MD Approval**, or **Waiting Amendment**, or the header `is_submitted = TRUE`. "Unlocked" means Draft or Draft Amendment. *(Confirm exact state values in Phase 0.)* |
| **R-6** | An override edit modifies the **current approved version in place**. It does **not** increment the version number and does **not** create an amendment record. |
| **R-7** | Every field changed under an override writes one row to `override_audit_trail` (old value, new value, user email, timestamp, order, version, module) **in the same database transaction** as the change. If the audit insert fails, the edit is rolled back. |
| **R-8** | System-calculated fields (e.g. Fabric BOM process weights from L1/L2 compounding) remain read-only under an override, unless that module already supports a manual mode and the row is in manual mode. |
| **R-9** | All permission checks run **on the server for every write request** (POST/PUT/PATCH/DELETE). Hiding buttons in the UI is a convenience, not the control. |
| **R-10** | Permissions are resolved **per request with no caching** beyond that request, so expiry and revocation take effect immediately. |
| **R-11** | Expiry is compared using the **database clock** (`UTC_TIMESTAMP()`); all override timestamps are stored in UTC. |
| **R-12** | Revocation is a **soft revoke** (`revoked_at`, `revoked_by`). Rows are never hard-deleted, so the history of who had access, and when, is kept. |
| **R-13** | Re-granting an expired or revoked override **updates the existing row** (`INSERT … ON DUPLICATE KEY UPDATE`); it never creates a duplicate. |
| **R-14** | Every grant, renewal and revocation is recorded in `override_grant_history` (who, to whom, which module, expiry, reason). |
| **R-15** | Only users with the **Admin** role (and MD, if confirmed in §11) can create, renew or revoke overrides. An admin **cannot grant an override to themselves** (D-5). |
| **R-16** | A `reason` (free text, min 10 characters) is **mandatory** on every grant and on every override commit. |
| **R-17** | `order_entry` sub-keys are independent. A user with `order_entry.price_change` can edit price fields only, not quantities or dates. The field-to-key mapping lives in one place (§5.3). |
| **R-18** | The MD can view a report of all override ("Direct-to-Master") edits, filterable by date range, order, user and module. |
| **R-19** | While an order has a **pending amendment**, an override edit is blocked on any field that the pending amendment is also changing (D-2). Other fields remain editable. |
| **R-20** | `can_approve` is stored but has **no effect in v1**. Overrides never approve amendments or bypass MD approval of an amendment (D-4). |

### 2.1 Permission matrix (replaces the one in the source spec)

| Order state | Role allows edit? | Active override for module? | Result | Audited as bypass? |
|---|---|---|---|---|
| Draft / Draft Amendment | Yes | any | Editable | No |
| Draft / Draft Amendment | No | Yes | Editable | Yes |
| Draft / Draft Amendment | No | No | Read-only | — |
| Approved (locked) | any | No | Read-only | — |
| Approved (locked) | any | Yes | Editable (bypass) | Yes |
| Pending MD Approval / Waiting Amendment | any | No | Frozen | — |
| Pending MD Approval / Waiting Amendment | any | Yes | Editable except fields in the pending amendment (R-19) | Yes |
| any | any | Expired / revoked / `can_edit=false` | Fall back to the role result | — |

---

## 3. Data model

### 3.1 Module keys (single source of truth)

Define these as constants/enum in one file (e.g. `permissions/overrideModules.*`). Do not scatter string literals.

| module_key | Label in UI | Parent |
|---|---|---|
| `order_entry.qty_add` | Quantity Addition | Order Entry |
| `order_entry.qty_cancel` | Quantity Cancellation | Order Entry |
| `order_entry.price_change` | Price Change | Order Entry |
| `order_entry.delivery_ext` | Delivery Date Extension | Order Entry |
| `order_entry.combo_color` | Combo / Color Change | Order Entry |
| `material_bom` | Material BOM | — |
| `fabric_bom` | Fabric BOM | — |
| `order_budget` | Order Budget | — |

If the existing "Raise Amendment" screen already uses keys for these sub-types, **reuse its keys** and record the mapping in `FINDINGS.md`.

### 3.2 Migration SQL

```sql
-- 1. Override grants
CREATE TABLE user_email_permission_overrides (
    id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    user_email       VARCHAR(255) NOT NULL,              -- lower-cased, trimmed (R-1)
    module_key       VARCHAR(50)  NOT NULL,              -- from §3.1
    can_edit         BOOLEAN      NOT NULL DEFAULT FALSE,
    can_approve      BOOLEAN      NOT NULL DEFAULT FALSE, -- reserved, no effect in v1 (R-20)
    override_expiry  DATETIME     NULL,                  -- UTC; NULL = no expiry (see D-3)
    reason           VARCHAR(500) NOT NULL,
    granted_by_email VARCHAR(255) NOT NULL,
    revoked_at       DATETIME     NULL,                  -- UTC (R-12)
    revoked_by_email VARCHAR(255) NULL,
    created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
    UNIQUE KEY uq_override_email_module (user_email, module_key),
    KEY idx_override_expiry (override_expiry)
);

-- 2. Field-level audit of edits made under an override (R-7)
CREATE TABLE override_audit_trail (
    id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    commit_id        CHAR(36)     NOT NULL,              -- UUID shared by all fields in one save
    order_id         INT          NOT NULL,              -- match the orders PK type
    order_version    VARCHAR(20)  NOT NULL,              -- e.g. 'V2' — the version edited in place
    order_state      VARCHAR(40)  NOT NULL,              -- state at time of edit
    user_email       VARCHAR(255) NOT NULL,
    module_key       VARCHAR(50)  NOT NULL,
    entity_table     VARCHAR(64)  NOT NULL,              -- e.g. 'fabric_bom_lines'
    entity_row_id    VARCHAR(64)  NULL,                  -- PK of the edited row
    field_name       VARCHAR(100) NOT NULL,
    old_value        TEXT         NULL,
    new_value        TEXT         NULL,
    reason           VARCHAR(500) NOT NULL,
    client_ip        VARCHAR(45)  NULL,
    is_bypass_flag   BOOLEAN      NOT NULL DEFAULT TRUE,
    action_timestamp DATETIME(3)  NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
    KEY idx_audit_order (order_id, action_timestamp),
    KEY idx_audit_user  (user_email, action_timestamp),
    KEY idx_audit_commit (commit_id)
);

-- 3. History of grants / renewals / revocations (R-14)
CREATE TABLE override_grant_history (
    id               BIGINT UNSIGNED PRIMARY KEY AUTO_INCREMENT,
    override_id      BIGINT UNSIGNED NOT NULL,
    action           ENUM('GRANT','RENEW','REVOKE') NOT NULL,
    user_email       VARCHAR(255) NOT NULL,
    module_key       VARCHAR(50)  NOT NULL,
    can_edit         BOOLEAN      NOT NULL,
    override_expiry  DATETIME     NULL,
    reason           VARCHAR(500) NOT NULL,
    actor_email      VARCHAR(255) NOT NULL,
    action_timestamp DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_grant_hist_override (override_id)
);
```

Notes:
- `override_audit_trail` and `override_grant_history` are **append-only**. The application DB user should not need UPDATE/DELETE on them; if the project manages DB grants, restrict them.
- Do not add a foreign key from `user_email` to `users.email` unless `users.email` is unique and consistently lower-cased — check in Phase 0.

---

## 4. Permission resolution

### 4.1 Active-override query

```sql
-- Returns one row if the user has an ACTIVE override for the module (R-2), else no rows.
SELECT o.id, o.module_key, o.override_expiry
FROM   users u
JOIN   user_email_permission_overrides o
       ON o.user_email = LOWER(TRIM(u.email))
WHERE  u.id          = :current_user_id
  AND  u.is_active   = TRUE                     -- adapt to the real column
  AND  o.module_key  = :module_key
  AND  o.can_edit    = TRUE
  AND  o.revoked_at  IS NULL
  AND  (o.override_expiry IS NULL OR o.override_expiry > UTC_TIMESTAMP());
```

**Do not** use the source spec's `COALESCE(override.can_edit, roles.default_can_edit)`: an override row with `can_edit = FALSE` would *lower* a user's role access (breaks R-3). Combine in application code instead (§4.2).

### 4.2 Permission service (pseudocode)

Implement one service, e.g. `OverridePermissionService`, used by every write path in scope.

```text
resolveEditAccess(user, order, moduleKey) -> { allowed: bool, isBypass: bool, overrideId?: id }

    roleAllows   = existing RBAC check (user.role, moduleKey)          // reuse existing code
    locked       = isLocked(order)                                    // R-5
    override     = findActiveOverride(user.id, moduleKey)             // §4.1, no cache (R-10)

    if not locked and roleAllows:  return { allowed: true,  isBypass: false }
    if override:                   return { allowed: true,  isBypass: true, overrideId }
    return                                { allowed: false, isBypass: false }


assertCanEditFields(user, order, changes[])      // changes = [{moduleKey, table, rowId, field, old, new}]
    for each change:
        if isCalculatedField(change) and not inManualMode(change):   -> 403 CALCULATED_FIELD   (R-8)
        access = resolveEditAccess(user, order, change.moduleKey)
        if not access.allowed:                                          -> 403 LOCKED
        if access.isBypass and fieldInPendingAmendment(order, change):  -> 409 PENDING_AMENDMENT_CONFLICT (R-19)
    return accessPerChange
```

### 4.3 Where to plug it in

- Find every place that currently checks `is_submitted`, the Approved lock or the RE Status before a write in the four modules. Replace each with a call to the service. **Do not delete the existing lock checks for users without an override** — the service must reproduce today's behaviour exactly when no override exists.
- Record the list of call sites you changed in `FINDINGS.md` (file + function).

### 4.4 Field → module_key mapping (Order Entry)

Needed so that `order_entry.price_change` unlocks only price fields (R-17). Build this in Phase 0 from the actual order-entry columns and put it in the same constants file as §3.1. Example shape:

| module_key | Tables / fields it unlocks (to be filled from codebase) |
|---|---|
| `order_entry.qty_add` | order line quantity (increase only) |
| `order_entry.qty_cancel` | order line quantity (decrease only), cancelled qty |
| `order_entry.price_change` | unit price / rate fields |
| `order_entry.delivery_ext` | delivery / ship dates (later dates only — confirm D-6) |
| `order_entry.combo_color` | combo, colour, size-colour breakdown rows |

Any Order Entry field not in the mapping stays locked under all overrides.

---

## 5. Write path under an override

On save of an override edit, in **one DB transaction**:

1. `SELECT … FOR UPDATE` the order header (prevents a concurrent amendment approval / edit racing this save).
2. Re-run `assertCanEditFields` inside the transaction (R-9, R-10).
3. Compute the diff (only fields whose value actually changed).
4. Apply the changes to the approved version in place (R-6). Keep the version number unchanged.
5. Re-run the module's normal recalculation (e.g. BOM totals, budget totals) exactly as the standard edit path does.
6. Insert one `override_audit_trail` row per changed field, all with the same `commit_id` and the mandatory `reason` (R-7, R-16). Include rows for recalculated fields that changed as a side-effect, with `field_name` suffixed `(recalc)`.
7. Commit. On any failure, roll back everything.

Use optimistic concurrency if the project already has it (e.g. `updated_at` / row version check); otherwise the `FOR UPDATE` lock is sufficient.

---

## 6. API

Adapt paths and naming to the project's existing conventions.

### 6.1 Admin — overrides

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/admin/permission-overrides?email=&module_key=&status=active\|expired\|revoked` | List grants |
| POST | `/api/admin/permission-overrides` | Grant or renew (upsert). Body: `{ user_email, module_keys[], override_expiry, reason }` |
| POST | `/api/admin/permission-overrides/{id}/revoke` | Revoke. Body: `{ reason }` |
| GET | `/api/admin/permission-overrides/{id}/history` | Grant history rows |

Upsert SQL (R-13), one statement per module key, inside one transaction together with the history insert:

```sql
INSERT INTO user_email_permission_overrides
    (user_email, module_key, can_edit, can_approve, override_expiry, reason, granted_by_email)
VALUES
    (LOWER(TRIM(:user_email)), :module_key, TRUE, FALSE, :override_expiry, :reason, :actor_email)
ON DUPLICATE KEY UPDATE
    can_edit         = VALUES(can_edit),
    override_expiry  = VALUES(override_expiry),
    reason           = VALUES(reason),
    granted_by_email = VALUES(granted_by_email),
    revoked_at       = NULL,
    revoked_by_email = NULL;
```

Validation: caller has admin rights (R-15); `user_email` exists in Staff Master / users and is active; not the caller's own email (D-5); every `module_key` is in §3.1; `override_expiry` is in the future and within the maximum allowed window (D-3); `reason` ≥ 10 chars.

### 6.2 User — current permissions

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/orders/{orderId}/edit-permissions` | Returns, per module_key: `{ allowed, isBypass, expiresAt }`. Used by the UI only to show/hide controls (server still enforces R-9). |

### 6.3 Reports

| Method | Path | Purpose |
|---|---|---|
| GET | `/api/reports/override-edits?from=&to=&order_id=&user_email=&module_key=` | MD report (R-18), grouped by `commit_id`, CSV export if the project's reports support it |

---

## 7. UI

### 7.1 Admin screen — "Permission Overrides"

- **User picker** from Staff Master with **mandatory filters** before the list loads:
  Department (Merchandising / Planning / IT) and Designation (Senior Merchandiser / Merchandiser / Systems Architect). Use the Staff Master's real values; record them in `FINDINGS.md`.
- **Module picker:** checkboxes grouped as in §3.1 (Order Entry with its five sub-types, then Material BOM, Fabric BOM, Order Budget). Keep the same order and wording as the "Raise Amendment" screen.
- **Expiry:** date-time picker with quick options (1 day, 3 days, 7 days). Show times in IST; send UTC to the API.
- **Reason:** required text area.
- **Grants table:** user, module, status badge (Active / Expired / Revoked), expires, granted by, reason; actions **Renew** and **Revoke** (Revoke asks for a reason and confirmation).
- History drawer per row showing `override_grant_history`.

### 7.2 Order screens (Order Entry, Material BOM, Fabric BOM, Order Budget)

When the order is locked and the user has an active override for the module:
- Show a visible banner: *"Override edit mode — changes save directly to approved version Vn. Access expires {date time}."*
- Enable only the fields covered by the user's override keys (R-17); calculated fields stay disabled (R-8); fields in a pending amendment are disabled with a tooltip (R-19).
- In the "Next Box": replace the "Ready to send to MD" action with **"Commit Changes (Override)"**, which opens a dialog requiring a reason and showing a summary of changed fields before saving.
- Existing "Rates missing" / "BOMs out of date" warnings: see **D-1** (recommended: keep them visible but non-blocking).
- If the server returns 403 / 409 on save (e.g. override expired mid-session), show the message and reload the order read-only. Do not lose the user's unsaved values silently — keep them in the form so they can be copied.

### 7.3 Reports

- Printed "Approved Version" report: unchanged layout; the "Proposed Changes" banner is not shown for override edits (they are already committed). Add a footer line when the version has override edits: *"This version includes N post-approval override edit(s). See Override Edit Report."*
- Approved-version history report: mark override edits with a distinct label ("Direct edit — override") alongside normal amendments.
- New **Override Edit Report** for the MD (R-18): filters, grouped by commit, showing old → new per field, user, reason, timestamp (IST).

---

## 8. Acceptance criteria (each needs an automated test)

| # | Given | When | Then |
|---|---|---|---|
| AC-1 | Approved order, user without override | Save on Fabric BOM | 403; no data change; no audit row |
| AC-2 | Approved order, active `fabric_bom` override | Save a non-calculated Fabric BOM field | 200; value changed; version unchanged; 1 audit row per changed field, same `commit_id` |
| AC-3 | As AC-2 | Save a calculated process-weight field | 403 `CALCULATED_FIELD`; nothing saved |
| AC-4 | Active override, expiry passed 1 second ago | Save | 403; fallback to role behaviour (R-10, R-11) |
| AC-5 | Active override | Admin revokes, then user saves in the same session | 403 |
| AC-6 | Override row with `can_edit = FALSE`, Draft order, role allows edit | Save | 200 — override does not reduce access (R-3) |
| AC-7 | User has `order_entry.price_change` only | Save a quantity change | 403 (R-17) |
| AC-8 | Order Pending MD Approval, amendment changes delivery date, user has `order_entry.delivery_ext` + `price_change` | Save delivery date / save price | 409 / 200 respectively (R-19) |
| AC-9 | Audit insert forced to fail | Save | Whole transaction rolled back (R-7) |
| AC-10 | Expired override exists | Admin re-grants | Same row updated, `revoked_at` cleared, 1 new history row, no duplicate (R-13, R-14) |
| AC-11 | Admin | Grants override to own email | 400 (D-5) |
| AC-12 | Email stored as `Ravi@Raagam.in`, user email `ravi@raagam.in ` | Resolve | Override found (R-1) |
| AC-13 | Deactivated user with active override | Save | 403 (R-2) |
| AC-14 | Non-admin | Calls any admin endpoint | 403 (R-15) |
| AC-15 | Direct API call bypassing UI, no override | PATCH locked order | 403 (R-9) |
| AC-16 | Override edits exist | MD opens Override Edit Report | All edits listed with old/new, user, reason, time |
| AC-17 | No overrides anywhere | Full existing test suite | Passes unchanged — no regression in the amendment workflow |

---

## 9. Implementation phases for Claude Code

Each phase: implement → tests → short summary → wait for review before the next phase (unless the developer says to continue).

### Phase 0 — Discovery (no code changes)
Produce `docs/override-feature/FINDINGS.md` containing:
- Tech stack, framework, ORM, migration tool, test framework, DB engine/version.
- How auth works and how the current user and their role are obtained on the server.
- Order state machine: exact state names/values, where `is_submitted` and RE Status live, how versions (V1, V2) are stored.
- How amendments store proposed changes (needed for R-19).
- Every server-side write path for Order Entry, Material BOM, Fabric BOM, Order Budget, and where each currently enforces the lock.
- Which fields are system-calculated in each module and how manual mode is represented (R-8).
- Staff Master location and the real Department / Designation values.
- "Raise Amendment" screen sub-type keys; "Next Box" component location; approved-version report code.
- Draft field→module_key mapping for Order Entry (§4.4).
- Conflicts with this spec and open questions.

### Phase 1 — Schema
Migrations for §3.2 (up and down). Constants file for §3.1.

### Phase 2 — Permission service
`OverridePermissionService` (§4), unit tests for AC-4, 5, 6, 7, 12, 13.

### Phase 3 — Enforcement + audit on write paths
Wire the service into every write path found in Phase 0; implement §5. Tests AC-1, 2, 3, 8, 9, 15, 17.

### Phase 4 — Admin API + screen
§6.1 and §7.1. Tests AC-10, 11, 14.

### Phase 5 — Order screen changes
§6.2 and §7.2.

### Phase 6 — Reports
§6.3 and §7.3. Test AC-16.

### Phase 7 — Hardening
Run the full suite; verify no caching of permissions; check timezone handling end to end; update project README / docs with how to grant an override.

---

## 10. Suggested first prompt for Claude Code

```text
Read docs/override-feature/Raagam_Email_Override_Implementation_Spec_v1.0.md in full.
Do Phase 0 only: explore the codebase and write docs/override-feature/FINDINGS.md
covering every item listed under Phase 0. Do not modify any other files.
Where the codebase contradicts the spec, list it under "Conflicts" rather than
choosing. Stop when FINDINGS.md is complete and summarise the open questions.
```

For later phases: *"Implement Phase N of the spec. Follow the rule IDs, write the tests listed for this phase, run the full test suite, then summarise the files changed."*

---

## 11. Decisions to confirm before Phase 3

Defaults are what Claude Code should implement if not changed.

| ID | Question | Default |
|---|---|---|
| **D-1** | Source spec says suppress "Rates missing" / "BOMs out of date" warnings for override users. Hiding them can hide real data problems. | **Keep warnings visible but non-blocking** for override users. |
| **D-2** | What happens if an override edit touches a field that a pending amendment is also changing? (Source spec doesn't say; when the MD approves the amendment it could silently overwrite the override edit, or vice versa.) | **Block that field** (409) until the amendment is approved or rejected (R-19). |
| **D-3** | Source spec allows `override_expiry = NULL` (permanent). | **Expiry required, maximum 30 days.** NULL allowed only for Systems Architect designation, if at all. |
| **D-4** | Source spec has `can_approve` but never defines what it approves. | **Stored, no effect in v1** (R-20). |
| **D-5** | May an admin grant an override to themselves? | **No.** |
| **D-6** | Should `delivery_ext` allow only later dates, and `qty_add` / `qty_cancel` only increases / decreases? | **Yes**, enforce direction. |
| **D-7** | Who can open the Override Edit Report? | **MD and Admin.** |
| **D-8** | Should the MD be notified (email / in-app) on each override commit? | **Not in v1**; the report is the control. |
| **D-9** | Can an override edit affect POs already raised against the order (e.g. price change after PO)? | **No automatic PO changes.** Show a warning if POs exist for the edited lines. |

---

## 12. Changes from the source spec (for the reviewer)

1. **Resolver bug fixed.** `COALESCE(override.can_edit, role.default_can_edit)` lets an override row with `can_edit = FALSE` *remove* access the role grants. Replaced with "overrides only elevate" (R-3, AC-6).
2. **Order state separated from role.** The source query resolves role permission but never looks at the order's lock state; the service in §4.2 combines both.
3. **Soft revocation + grant history** added (R-12, R-14) so "who had access when" is auditable, not only "who edited what".
4. **Audit table extended** with `commit_id`, `order_version`, `order_state`, `entity_table`, `entity_row_id`, `reason`, `client_ip`, and made transactional (R-7).
5. **Pending-amendment conflict** handled (R-19) — not covered in the source.
6. **Email normalisation, deactivated users, UTC expiry, no caching** made explicit (R-1, R-2, R-10, R-11).
7. **Sub-module field mapping** required so Order Entry sub-keys are actually enforced (R-17, §4.4).
8. Warning suppression, permanent overrides and `can_approve` moved to decisions (D-1, D-3, D-4) instead of silently implemented.