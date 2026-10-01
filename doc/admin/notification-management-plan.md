# Administration ▸ System ▸ Notifications — plan

Status: **Phases 0–3 BUILT 2026-10-01.** Phase 3: 0677 `job_runs`, retention
singleton + `notification_purge()`; every cron route records through `runJob`;
Administration ▸ System ▸ Scheduled Jobs (late/failed/never, Run now); a nightly
`housekeeping` cron (03:00 IST); Notifications ▸ Settings (retention, count-then-clean);
`check:jobs`; AGENTS.md STANDING section. Phase 4 pending.
Earlier: Phase 0: 0673, registry,
`notify(key, …)`, dispatch log, `check:notification-events`. Phase 1: 0675's four
admin readers, Administration ▸ System ▸ Notifications (Overview · Log · Devices).
Phase 2: 0676 writers — each alert's switches + CC (pencil on Overview), Send
(Test, Announcement), Take back (Log), Remove device. Phases 3–4 pending.

Built differently from §5, on purpose:
- **No separate Events tab** — the pencil is on the Overview's "Every alert"
  table, which already listed every alert. One list, not two.
- **CC is Roles + People only.** A permission CC is supported by the table and
  left untouched by a save, but not offered: two pickers an admin understands
  beat a third that needs the permission model explained.
- **Push on an announcement follows the `admin.broadcast` switch**, not a
  per-send toggle — one place decides, the same as every other alert.
- **A taken-back alert leaves open bells live**: the bell hook now listens for
  DELETE (Realtime sends only the id under RLS, so it is harmless unfiltered). Ask: "notification management child inside
the administrator module — the administrator can do everything regarding notifications."

---

## 1. What exists today (measured, not assumed)

The pipeline is sound and small:

| Piece | Where | What it does |
|---|---|---|
| `notify(target, payload, opts)` | `lib/notifications/notify.ts` | resolves recipients → inserts one `notifications` row each → web push to their devices; never throws |
| Targets | same | `userId` · `userIds` · `role` · `permission` · `employeeIds` (0660) |
| Fallback | 0660 `notification_fallback_recipients()` | an alert that reaches nobody goes to Administrator + super admins, prefixed |
| In-app | `notifications` (0040) + Realtime + `NotificationsBell` | RLS: a user reads only their own rows |
| Device | `push_subscriptions` + `lib/pwa/push.ts` + `PushPrompt` / `PushToggle` | one row per (user, endpoint); 404/410 pruned |
| Email | `lib/email/send.ts` (Resend) | used by welcome mail and buyer approval links — **not** by `notify()` |
| Clocks | `vercel.json` crons: approval-sla (5 min), work-flow (hourly), order-risk, approval-links (daily) | each guarded by `CRON_SECRET` |

**14 alert kinds, raised from 9 files, each a hand-typed title string.** None carries a
name the system can recognise:

| Proposed key | Raised in | Goes to (decided in code) |
|---|---|---|
| `approval.pending` | `lib/approvals/notify.ts` notifyCurrentApprovers | the current step's approvers |
| `approval.revision_pending` | same | approvers of a Revision (margin-down flag) |
| `approval.decided` | same, notifyRequesterOfDecision | requester + the orders' merchandisers |
| `approval.sla_escalated` | `lib/approvals/sla.ts` | requester |
| `approval.sla_missed` | same | missed approvers (only where the STEP says so, 0603) |
| `cad.new_order` | `lib/orders/cad/notify.ts` | role CAD Technician |
| `cad.weights_ready` | same | merchandiser, else `orders:edit` |
| `cad.pattern_ready` | `lib/orders/cad-lifecycle/notify.ts` | merchandiser, else `orders:edit` |
| `order.community_message` | `lib/orders/community/bot.ts` | thread participants (fallback off) |
| `order.risk` | `lib/orders/progress/sweep.ts` | merchandiser + Managing Director |
| `workflow.milestone_overdue` | `lib/orders/work-flow/sweep.ts` | milestone owner |
| `workflow.milestones_escalated` | same | Managing Director (digest) |
| `ta.buyer_response` | `lib/ta/approval-links-service.ts` | merchandiser / `orders:edit` |
| `system.fallback` | `notify()` itself | admins (meta — the unrouted copy) |

Live data, 2026-10-01: 49 rows to 3 of 6 active logins, 24 unread, 5 devices.
12 of the 49 read "CAD Completion overdue for …" — **checked: twelve different orders,
not repeats**. Every sweep already claims its row once (`overdue_notified_at`,
`escalated_at`, `order_risk_alerts`), so the repeat window this plan first proposed
answered a problem the data does not have. It was dropped.

### What an administrator cannot do today

1. **See** anything beyond their own bell — not what was sent, to whom, whether push
   worked, whether it fell back. (`notifications` RLS is own-rows-only, correctly.)
2. **Know an alert is unroutable** before it happens — "CAD Technician has nobody" is
   discovered only when the fallback copy lands.
3. **Turn anything off, up, or down** — every switch is a code change.
4. **Add someone** to an alert (copy the Factory Manager on order-risk).
5. **Check the plumbing** — VAPID keys, `CRON_SECRET`, `RESEND_API_KEY` unset are all
   silent. (The SLA section of AGENTS.md: "nothing ever escalates — and nothing looks
   wrong".)
6. **Send** an announcement, or a test to a device that "doesn't buzz".
7. **Manage devices** — revoke a lost phone, see who never turned alerts on.
8. **Clean up** — `notifications` grows forever; nothing purges.

The screen below answers all eight. It is built on one structural change (§2) without
which every one of them is a screen of guesses.

---

## 2. The one structural change: every alert gets a NAME

**An alert the system cannot name is an alert nobody can configure.** Today the only
identity a notification has is its title text, which changes per order. So:

- `lib/notifications/events.ts` — **the event registry, declared once in TS**, same
  shape as `ORDER_REPORTS` / `MODULE_GROUPS`:

  ```ts
  export const NOTIFICATION_EVENTS = {
    "approval.pending": {
      module: "approvals",
      label: "Approval needed",
      audience: "The approvers of the current step",   // what the CODE decides
      staticAudience: null,                             // or { role: "CAD Technician" }
      mandatory: true,                                  // see §4
      defaultType: "info",
      defaults: { push: true, email: false, repeatMinutes: 0, fallbackToAdmins: true },
    },
    …
  } as const satisfies Record<string, NotificationEventDef>;
  export type NotificationEventKey = keyof typeof NOTIFICATION_EVENTS;
  ```

- `notify()` takes the key first: `notify("cad.new_order", target, payload, opts)`.
  A typo is a type error; a new alert without a registry entry does not compile.
- The DB carries **only what the admin can change** (`notification_event_settings`),
  seeded from the registry. The registry owns meaning (label, audience text, mandatory);
  the table owns policy (on/off, channels, CC, repeat window).
- **Gate: `npm run check:notification-events`** (inside `build:check`) — every `notify(`
  call passes a literal registered key; every registry key has a seed row in the
  migrations; no settings row names a key the registry dropped. Verify by making it FAIL
  first (a `notify("cad.new_ordr", …)` and an unseeded key) before trusting it.

---

## 3. Data model — migration **0673** (ledger checked: 0672 is the latest)

All add-only. Every function: `revoke all … from public, anon;` (Function grants rule).
Admin tables read/write through `has_permission('system_admin', …)`.

**`notification_event_settings`** — one row per key
`event_key pk · mandatory (copied from the registry, not updatable — column grants) ·
enabled · push · email · fallback_to_admins · updated_by · updated_at`, with
`check (not mandatory or enabled)`. The bell row is always written for an enabled event.

**`notification_event_cc`** — extra audiences an admin adds
`id · event_key · kind ('role'|'user'|'permission') · role_id | user_id | module+action ·
created_by · created_at`. **Additive only** — see §4.

**`notification_dispatches`** — ONE row per `notify()` call. This is the log the admin
actually needs ("did it go, to whom, why not"):
`id · event_key · title · body · href · type · target jsonb (what the code asked for) ·
primary_count · cc_count · fallback_used · suppressed ('disabled'|'repeat'|'no_recipients'|null) ·
push_attempted · push_sent · push_pruned · push_failed · email_sent · email_failed ·
error · source ('action'|'cron'|'admin') · created_by · created_at`

**`notifications`** gains `event_key` and `dispatch_id` (nullable — old rows stay), so a
dispatch drills down to each recipient's read state.

**`push_subscriptions`** gains `last_success_at · last_failure_at · failure_count` —
"this phone has failed 9 times since 12/09" is the answer to "my phone doesn't buzz".

**`job_runs`** — `job · started_at · finished_at · ok · summary jsonb · error · trigger
('cron'|'manual'|'opportunistic')`. Written by each `/api/cron/*` route. The first time
the app can say "the SLA sweep last ran 3 days ago".

**`notification_settings`** — singleton: `read_retention_days (90) ·
unread_retention_days (365) · dispatch_retention_days (180)`.

Admin-side reads go through `SECURITY DEFINER` RPCs that check
`has_permission('system_admin','view')` — **never** a widened RLS policy on
`notifications`, which Realtime also reads (a looser select policy there would stream
everyone's alerts into every admin's open tab).

PostgREST note: `notification_dispatches.created_by` and `notifications.user_id` both
point at `profiles`; `notifications` → `notification_dispatches` is a single FK. Name
embeds by column anyway (`profiles!created_by(...)`) and add the pair to
`check-embeds.mjs` if a second FK to the same table ever lands.

---

## 4. Rules the admin CANNOT break (the senior part)

These are the places "the admin can do everything" has to stop, each for a reason this
repo has already paid for once:

1. **A MANDATORY ALERT CANNOT BE SWITCHED OFF.** `approval.pending`,
   `approval.revision_pending` and `approval.decided` are how a document leaves a queue;
   `approval.sla_escalated` is the fourth, because `lib/approvals/sla.ts` already
   records it as "not configurable and should not be".
   Turning them off does not quiet the app; it strands budgets — the "escalating into a
   void" lesson in a new hat. Mandatory = enabled + in-app locked on; **push and email
   stay switchable**. The switch renders greyed with the reason, never hidden (same rule
   as the locked pencil in Row actions).
2. **CC IS ADDITIVE; THE CODE'S RECIPIENT IS NEVER REMOVED.** "The merchandiser of this
   order" is per-record knowledge the admin cannot express in a role picker. An admin can
   add people; replacing the primary audience would let a config row route an order's
   alerts away from the one person responsible for it.
3. **THE STEP FLAG STAYS ON THE STEP.** `notify_missed_approver` lives on the approval
   flow step because runs freeze their steps (0603). The event-level switch is a global
   kill switch on top; it does not replace or mirror the per-step tick. Two places
   competing to be "the" setting is the `sla_hours` lie the SLA section describes.
4. **NO REPEAT WINDOW** — see §1: the sweeps already send each alert once.
5. **DISABLING IS LOGGED TOO.** A disabled event still writes its dispatch row with
   `suppressed='disabled'`, so "why didn't I get it?" has an answer on screen.
6. **CONFIG READ MUST NOT COST A ROUND TRIP PER ALERT.** Server actions are queued
   (~260 ms per serial await, see the load-time note); `notify()` reads settings through
   a per-instance cache with a 60 s TTL, invalidated by the admin's own save. Sweeps
   loading 40 overdue milestones read it once.
7. **`notify()` STILL NEVER THROWS.** Every new step (settings, CC, dispatch log)
   sits inside the existing try. A failed dispatch-log insert must not cancel the alert
   itself — write the notifications first, log after, log failures into `error`.
8. **A PUSH CANNOT BE RECALLED.** "Recall broadcast" deletes the in-app rows; the screen
   says plainly that phones which already buzzed keep it.

---

## 5. The screen

**Placement.** A new Administration group **System** (`slug: "system"`) with two leaves
— **Notifications** (`/admin/notifications`) and **Scheduled Jobs** (`/admin/jobs`).
Jobs is its own row because the sweeps run approvals, not only alerts. Registering in
`MODULE_GROUPS` puts both in the sidebar, the hub, nav search **and the permission tree**
(`screen-catalog.ts` derives from it) with no other edit. `npm run check:nav` must pass
(hub page `/admin/system` via `GroupHub`).

**Permissions** (`system_admin`): `view` — every tab read-only · `edit` — Events,
Settings, devices · `create` — Test, Broadcast · `delete` — recall, purge now.

### Notifications — tabs

**Overview** (health first, because the failures here are silent)
- Plumbing: VAPID keys · `CRON_SECRET` · `RESEND_API_KEY` · service worker — ✓ / ✗,
  never the values. Each ✗ says what stops working.
- Coverage: active logins · with a device · never turned alerts on (list, with "send a
  reminder" = a targeted test).
- **Routing gaps:** every event with a `staticAudience` resolved TODAY — "cad.new_order
  → CAD Technician — **0 holders**". Dynamic audiences show their last-30-day fallback
  rate instead. This is the one panel that prevents the 2026-09-30 audit's finding.
- Last 7 days: sent / suppressed / fell back / push failed, per event.

**Events** — the catalog, one row per key, grouped by module (accordion — Folds rule).
Columns: Event · Goes to (registry text) · Push · Email · CC · Fallback · Last sent. Row edit opens a `size="sm"` sheet (sub-detail rule) with the CC
grid (`ChildGrid`, seeded row, role/user/permission picker — pickers obey the Disabled
rows rule). `useUnsavedGuard(dirty || isPending)`.

**Log** — dispatches, newest first (this one is a log, so it keeps `created_at desc` —
the entry-order rule exempts logs). **Server-side keyset paging in the service**, not
`DataTable`'s display slice — this table reaches thousands of rows, exactly the case the
Pagination section names. `paginate={false}` on the table, the service owns the pager.
Filters: event · status (sent / disabled / reached nobody / fell back / push failed) · recipient ·
Created Date (shared `lib/date-filter.ts`). Click a row → recipients with read time and
device outcome. Created columns: a cron dispatch's creator reads "System".

**Devices** — every `push_subscriptions` row: user · device (parsed UA) · added · last
success · failures. Revoke (lost phone). Sort failures-first.

**Send** — two forms on one tab:
- *Test*: pick a user (default me) → `admin.test` event → shows per-device result inline.
- *Broadcast*: audience (all / roles / users), title, body, type, optional link, push
  on/off → confirm with recipient count → `admin.broadcast`. Rate-limited
  (`lib/rate-limit.ts`). Recall from the Log row.

**Settings** — retention days, "purge now" (shows what it would delete first).

### Scheduled Jobs
One row per cron (approval-sla, work-flow, order-risk, approval-links, housekeeping):
schedule · last run · result summary · last error · **Run now** (confirm; calls the same
sweep function server-side under `system_admin:edit` — not the HTTP route, so
`CRON_SECRET` never reaches the browser). A job whose last run is older than 3× its
schedule turns red: that is the "nothing escalates and nothing looks wrong" detector.

---

## 6. Phases (each ships alone and leaves the app working)

| Phase | Builds | Visible result | Gate |
|---|---|---|---|
| **0 — Name every alert** ✅ | registry, `notify(key, …)` across the 9 files, 0673 tables, dispatch logging, push stats | nothing changes for operators | `check:notification-events` made to fail first (3 faults), then passes; in `build:check` |
| **1 — See** ✅ | System group + hub, Overview, Log, Devices (all read-only); 0675 readers | admin sees every alert and every gap — on day one it flagged CAD Technician as an empty role | `check:nav`, `check:screen-catalog`, layout audits; seen in the browser, one real test alert end to end (push 1 of 1) |
| **2 — Control** ✅ | alert sheet (switches + CC), Test, Announcement, take back, remove device; 0676 | admin changes behaviour without a deploy | mandatory lock asserted in a vector script |
| **3 — Clocks & cleanup** ✅ | `job_runs` via `runJob` in each cron route, Scheduled Jobs screen, Run now, housekeeping cron, retention settings | stale cron is red; table stops growing | `check:jobs` made to fail first (2 faults); anon has no execute on any `notification_*` function |
| **4 — Reach** | email channel in `notify()` (per event, default OFF), `email_log` written by `sendEmail` (welcome + buyer links included), per-user mute of non-mandatory events on My Profile + admin view of it | alerts can email; "did the welcome mail go?" answered | — |

Deliberately **not** planned: SMS / WhatsApp (no provider, cost per message), quiet
hours and daily digests (wait until Phase 1's log shows which events actually annoy),
an editable title/body template per event (titles are built from per-record facts in
code; a template engine is a second place for that logic to drift).

---

## 7. Decisions needed from the client / user

1. **May an admin read alert BODIES of other users?** Some bodies name fines, salaries
   or margins. Recommended: yes for Administrator/super admin (they already hold
   `system_admin`), and the Log shows bodies only to `system_admin:edit`.
2. **Which alerts are mandatory?** Built: the three approval alerts + `sla_escalated`.
3. ~~Repeat window~~ — dropped, see §1.
4. **Broadcast to "All users" — allowed for Administrator, or super admin only?**
   Recommended: Administrator, with the recipient count in the confirm.
5. **Email channel** — needs a verified sending domain in Resend before Phase 4.
