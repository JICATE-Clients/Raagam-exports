# Resolve Hub — Stage 3: Service Desk (IT ticketing) — plan + build contract

Spec: `doc/Reslove hub.md/ticket system.md` ("Enterprise IT Support Ticketing
System"). The Resolve Hub section list (`resolvehub.md` line 6) already names
**Service Requests** as a section; this stage builds it. Stages 1–2 (Broken,
Complaints) are in `doc/resolve/resolve-hub-plan.md` — read §2–§5 there first,
everything below EXTENDS that contract and never re-states it. If the code must
deviate, change THIS file in the same edit and say why.

## 0. Brainstorm — what the spec asks, what already exists, what is new

The spec is a generic ITSM text. Most of it is already Resolve Hub; the job is to
add the IT-shaped half without building a second ticket system.

| Spec (§) | Already built (Broken) | New for the Service Desk |
|---|---|---|
| §1.2 tracking, audit trail | `rh_tickets`, append-only `rh_ticket_activity` | — reuse |
| §1.2 "pop-up" when a ticket is stagnant 3–4 days | daily overdue escalation (days late) | **Stale clock**: no activity for 3 days → reminder to the technician; 4 days → desk manager (§5.2). Delivered as in-app + web push AND a live pop-up toast |
| §2 intake: portal, phone, email, chat, WhatsApp | form / QR / AI | Portal form; **"Log a call"** — an agent raises a ticket ON BEHALF of a caller (`source = phone`). Email/Chat/WhatsApp are recorded source values only — no provider exists in this app (same truth as SMS in stage 1) |
| §2.2 one normalised ticket | unified `rh_tickets` | `kind = 'service'` on the same table |
| §3.1 Incident / Service / Change | trades | `ticket_type` column + **service categories** (Hardware, Software, Network, Email & Accounts, ERP Access, …), each routed to a team (skill-based routing, §4.2) |
| §3.2 FIFO + priority override (financial risk / executive directive) | triage score | Queue is **FIFO inside priority**; an **Urgent override** (with the reason) jumps the line. Starting the urgent ticket offers to put your current ticket **On hold with a courteous message** to its requester (the §3.2 soft-skills paragraph), and to resume it after |
| §4.1 six-stage lifecycle with the "fix unsuccessful" loop | open→…→closed, dispute | New / Assigned / In Progress / On Hold / Resolved / Closed. Resolved waits for the **requester to confirm** (or reopen); silence for 3 days auto-closes |
| §4.2 manual dispatch + skill routing | claim / assign / routing | reuse the team model; categories pick the team |
| §5.1 queues: team volume, technician backlog, pending escalations | Workload | **Helpdesk dashboard** (live) |
| §6.1 First-response SLA 10 min–1 h; resolution 30 min–4 h | due dates in DAYS | **SLA matrix in MINUTES per priority**, two clocks (response, resolution). On Hold pauses the resolution clock |
| §6.2 FRT, ART, CSAT | ratings 1–5, analytics | **Technician performance** (FRT, ART, SLA met %, CSAT, reopen, KB written) — the §1.2 "increment evaluations" record |
| §7.1 resolution logging + KB articles | fix note optional | **Root cause + resolution steps are mandatory** to resolve. **Knowledge Base**: write an article from a resolved ticket (title, problem, numbered steps); published articles are **suggested to the requester while they type** and to the technician on the ticket |
| §7.2 shift-start queue review | My Work | Desk "Mine" tab opens with a **Start of shift** line: carried over from earlier days, stale, breaching |
| §8.1 real-time dashboards | (static pages) | **Realtime**: every Resolve Hub list and ticket page refreshes itself when a ticket changes (Supabase Realtime on `rh_tickets`) |
| §8.2 Jira server admin, AD sync, email-in-the-tool | — | **Out of scope** — those are integrations with systems this ERP does not run |

"Build it in realtime" is read as BOTH: build it now, and make it live-updating.

## 1. Decisions (made, with the reason — none needs the client before building)

1. **Same table, own statuses.** `kind = 'service'`, statuses `open` (label "New"),
   `assigned, in_progress, on_hold, resolved, closed, cancelled, withdrawn`. The
   status check stays per kind (0745's shape). Broken screens filter
   `kind = 'broken'` already, so nothing leaks into them.
2. **One ref series `SD-2026-000123`**, not INC/SRQ/CHG — the type can be
   reclassified after submit, and a receipt number must never change.
3. **The requester states IMPACT, never priority** (stage-1 rule kept): "I cannot
   work at all" → High, "Working with difficulty" → Medium, "Just a request" → Low;
   the category's default is the floor. **Urgent exists only by override**, set by
   triage with a reason — that is the spec's §3.2 rule.
4. **SLA is wall-clock 24×7**, matrix per unit (editable): Urgent 10 min / 30 min,
   High 20 / 60, Medium 30 / 120, Low 60 / 240 (response / resolution, minutes) —
   the spec's own ranges. On Hold pauses resolution only; response is never paused.
5. **First response = the first thing a TECHNICIAN does** (claim, start, hold,
   resolve, or a requester-visible reply). A manager assigning it is not a
   response — the spec says "technical agent acknowledgment".
6. **Stale clock counts PEOPLE's activity only.** System rows (sweep, escalation)
   have `actor_id NULL` and do not reset it, or the reminder would silence itself.
7. **Knowledge base is shared across units** (knowledge is master data: "master
   data is shared"), keyed by category CODE (codes are seeded identically per unit).
8. **Agent-logged calls skip the 10/24 h rate limit** — it guards self-service spam,
   not a desk taking calls. Logging on behalf needs `resolve:edit`.
9. **Desk manager** = `rh_unit_settings.desk_manager_id` (falls back to unit head).
   Escalations go there. They must also hold `resolve:approve` to open the ticket;
   Unit Settings warns when they do not.
10. Permissions reuse stage 1's map: requester `view`, technician `edit` + team
    member, desk manager `approve`, performance/analytics `export`, setup `create`.

## 2. Data (migration A: `07xx_resolve_service_desk_schema.sql`)

Numbers from the LEDGER at apply time.

- `rh_tickets`
  - kind check + `'service'`; source check + `'phone','email','chat','whatsapp'`
    (`form` = portal); closure_kind + `'requester_confirmed','auto_timeout'`.
  - status check: service branch `open, assigned, in_progress, on_hold, resolved,
    closed, cancelled, withdrawn`.
  - pause check widened: `(status in ('blocked','on_hold')) = (paused_at is not null)`.
  - new columns: `ticket_type text check in ('incident','service','change')`,
    `impact text check in ('cannot_work','degraded','request')`,
    `sd_category_id uuid → rh_sd_categories`, `root_cause text`,
    `kb_article_id uuid → rh_kb_articles`, `override_kind text check in
    ('financial_risk','executive_directive')`, `override_note text`,
    `overridden_at timestamptz`, `overridden_by uuid → profiles` (FIFTH profiles FK —
    embeds name the column), `preempted_by uuid → rh_tickets` (this ticket was put
    on hold for that urgent one), `last_activity_at timestamptz not null default now()`,
    `stale_reminded_at`, `stale_escalated_at`, `sla_warned_at`,
    `response_breached_at`, `resolution_breached_at` (each stamp makes the sweep
    idempotent; reopen clears the resolution ones).
  - shape: `kind <> 'service' or (sd_category_id is not null and ticket_type is not null
    and impact is not null and trade_id is null and category_id is null)`.
- `rh_ref_counters.prefix` + `'SD','KB'`.
- `rh_unit_settings` + `desk_manager_id → profiles`, `sd_auto_close_days int 3`,
  `sd_stale_remind_days int 3`, `sd_stale_escalate_days int 4`, `sd_reopen_days int 7`.
- **rh_sd_sla** `(location_id, priority, response_minutes, resolution_minutes)`,
  PK (location_id, priority); seeded for every unit; RLS = configuration
  (select `view`, write `create`, current unit).
- **rh_sd_categories** `(id, location_id, code, name, description, ticket_type,
  team_id → rh_teams null, default_priority ('high','medium','low') default 'low',
  inactive, created_by, created_at)`, unique (location_id, code) and (location_id, name).
  Seeded per unit, all routed to a seeded team **IT SERVICE DESK** (trade `IT`):
  HW HARDWARE (incident, medium) · SW SOFTWARE (incident, low) · NET NETWORK &
  INTERNET (incident, medium) · PRN PRINTER & SCANNER (incident, low) ·
  ERP ERP ERRORS (incident, medium) · ACC EMAIL & ACCOUNTS (service, low) ·
  PRM ERP ACCESS & PERMISSIONS (service, low) · DEV NEW DEVICE / INSTALLATION
  (service, low) · MOV WORKSTATION MOVE (change, low) · SRV SERVER CHANGE (change, low).
- **rh_kb_articles** `(id, code 'KB-000123', title, problem, steps text[] (≥1),
  tags text[], category_code text null, status ('draft','published','retired'),
  source_ticket_id → rh_tickets null, author_id → profiles, published_at,
  used_count int 0, helpful_count int 0, not_helpful_count int 0, created_at,
  updated_at, search tsvector GENERATED (simple: title A, problem+tags B, steps C))`,
  GIN on search. Shared (no unit). `location-scope: exempt -- shared knowledge`.
  RLS select: `published` to `view`; any status to `edit`. No write policy — RPCs.
- **rh_kb_feedback** `(article_id, profile_id, helpful bool, ticket_id null,
  created_at)` unique (article_id, profile_id). No client policy.
- Realtime: `alter publication supabase_realtime add table public.rh_tickets`
  (guarded `do` block like 0737). Realtime applies `rh_tickets_select` per
  subscriber, and `current_location()` reads `profiles`, so unit scoping holds.

## 3. Functions (migration B: `07xx_resolve_service_desk_functions.sql`)

All SECURITY DEFINER, `search_path = ''`, `revoke all … from public, anon`, grant
`authenticated` unless "service_role". Each transition locks with `rh_lock`, checks
`rh_require(t, '<action>', '<words>')`, updates, writes ONE `rh_log` row.
**Re-created from their LATEST bodies (0746/0747)**: `rh_actions_of` (+ service branch
first), `rh_activity_outbox` (+ service branch).

Internal: `rh__desk_actions(t, uid) → text[]`, `rh__sd_route(location, category)
→ (owner_id, team_id, reason)` (category team lead → first active member → desk
manager → unit head → NULL + needs_sorting; leave hop via `rh_on_leave` /
`rh_manager_of` as stage 1), `rh__sd_due(location, priority, from) → (response_due,
resolution_due)`, `rh__sd_ack(ticket_id)` (sets first_response_at if null).

| Action (from `rh__desk_actions`) | Who | RPC | Effect |
|---|---|---|---|
| — | `view` | `rh_sd_categories_open()` → (id, code, name, description, ticket_type) | form list |
| — | `view`; on behalf needs `edit` | `rh_sd_submit(p_category_id, p_title, p_description, p_impact, p_photo_path default null, p_source default 'form', p_requester_id default null)` → `{ticket_id, ref_no, owner_name, team_name, priority, response_due_at, due_at, needs_sorting}` | rate limit (self only), route, SLA, `SD` ref, ledger, photo, activity `created` meta `{source, on_behalf_by}` |
| `sd_claim` | `edit` + team member, unassigned, open/assigned | `rh_sd_claim(id)` | assignee := me, status `assigned`, ack |
| `sd_assign` | triage or owner, live | `rh_sd_assign(id, assignee)` | assignee must be active member of a unit team or the owner; status `assigned` (not an ack) |
| `sd_start` | owner/assignee, open/assigned | `rh_sd_start(id, p_pause_ticket_id default null, p_pause_message default null)` | → in_progress, ack. If pause id: that ticket must be MY in_progress service ticket → on_hold, `preempted_by = id`, requester-visible note = message, activity `held` meta `{preempted_by_ref}` |
| `sd_hold` | owner/assignee, open/assigned/in_progress | `rh_sd_hold(id, reason)` | → on_hold, paused_at, ack |
| `sd_resume` | owner/assignee/triage, on_hold | `rh_sd_resume(id)` | → in_progress, due_at += pause, paused_seconds +=, preempted_by := null |
| `sd_resolve` | owner/assignee, in_progress | `rh_sd_resolve(id, p_root_cause, p_resolution, p_kb_article_id default null)` | both texts required (≥ 10 chars each); → resolved, resolved_at, ack; kb used_count+1 |
| `sd_confirm` | reporter, resolved | `rh_sd_confirm(id)` | → closed, closure_kind `requester_confirmed` |
| `sd_reopen` | reporter, resolved, or closed ≤ sd_reopen_days | `rh_sd_reopen(id, reason)` | → in_progress, fix_round+1, reopen_count+1, fresh resolution due from now, breach/warn stamps cleared |
| `sd_override` | triage, live, not already overridden | `rh_sd_override(id, p_kind, p_note)` | priority urgent, severity critical, stamps, due dates re-cut from NOW on the Urgent row (response only if not yet responded) |
| `sd_reclassify` | triage or owner, live | `rh_sd_reclassify(id, p_category_id default null, p_ticket_type default null, p_priority default null)` | category change re-routes (assignee cleared if team changes); priority change re-cuts dues from created_at (+paused); `urgent` refused here (override only) |
| `sd_cancel` | triage, open/assigned | `rh_sd_cancel(id, reason)` | → cancelled |
| `sd_withdraw` | reporter, open/assigned | `rh_sd_withdraw(id)` | → withdrawn, withdrawn_at |
| `note_internal` / `note_reporter` | as stage 1 | existing `rh_add_note` | a trigger on `rh_ticket_notes` (service only) bumps `last_activity_at`; a REPORTER-visible note also writes activity `replied` (meta `{by_staff}`) and, by staff, acks |
| `rate` | reporter, closed, once per round | existing `rh_rate` | CSAT |
| `kb_draft` | `edit` + staff on it, resolved/closed | (UI action) | opens the KB editor pre-filled |

Queues and boards:
- `rh_sd_queue(p_tab text)` tabs `unassigned` (assignee null, live), `mine`
  (assignee or owner = me, live), `team` (my teams, live), `breaching` (breached or
  at risk, live), `all` (live), `done` (resolved/closed/cancelled/withdrawn in 30 days)
  → `table(id, ref_no, status, ticket_type, title, priority, category_name, team_name,
  reporter_name, assignee_id, assignee_name, owner_name, created_at, response_due_at,
  first_response_at, due_at, paused_at, last_activity_at, overridden boolean,
  override_kind, response_state ('met','pending','breached'), resolution_state
  ('on_track','at_risk','breached','paused','done'), minutes_left int, stale_days int)`.
  **Order: overridden first, then priority rank, then created_at (FIFO).**
  Access `edit` or `approve` or `export`; rows scoped like `rh__staff_row`.
  SLA states computed in SQL (never `Date.now()` in a render).
  At risk = ≥ 80 % of the resolution window used.
- `rh_sd_shift_summary()` → `{carried_over, stale, breaching, new_since_last_shift}`
  for the caller (mine + my teams). "Last shift" = the caller's last activity before
  today (local), else 24 h.
- `rh_sd_dashboard()` → jsonb `{open, unassigned, on_hold, at_risk,
  breached_response, breached_resolution, resolved_today, escalations,
  by_technician:[{profile_id, name, assigned, in_progress, on_hold, breached}],
  by_priority:[{priority, open}], by_type:[{ticket_type, open}],
  trend:{daily:[{d, created, resolved}] (14), weekly (12), monthly (12)}}`.
  Access edit/approve/export; current unit.
- `rh_sd_performance(p_from date, p_to date)` → `table(profile_id, name, resolved,
  avg_first_response_min, avg_resolution_min, response_met_pct, resolution_met_pct,
  csat_avg, csat_count, reopened, kb_authored)` + one row with profile_id NULL =
  the desk total. Access `export`. Resolution minutes exclude paused time.
- KB: `rh_kb_search(p_q text, p_category_code text default null, p_limit int default 5)`
  → (id, code, title, problem, steps, rank) published only, `websearch_to_tsquery
  ('simple')` OR trigram-free ILIKE fallback on title; `rh_kb_list(p_status text
  default 'published', p_q text default null)`; `rh_kb_get(p_id)`;
  `rh_kb_save(p_id, p_title, p_problem, p_steps text[], p_tags text[],
  p_category_code, p_source_ticket_id)` → id (edit; creates draft, `KB` ref);
  `rh_kb_publish(p_id)`, `rh_kb_retire(p_id)` (edit);
  `rh_kb_feedback(p_id, p_helpful, p_ticket_id default null)` (view; one per person,
  upsert adjusts counters).
- Sweep `rh_sd_sweep()` **service_role**, every 5 min → `{response_breached,
  resolution_breached, warned, stale_reminded, stale_escalated, auto_closed}`.
  Writes activity rows with `actor_id NULL`: `sla_warning`, `sla_breached`
  (meta `{clock, recipients}`), `stale` (meta `{level:'remind'|'escalate', days,
  recipients}`), `auto_closed`. Recipients: response breach → owner/assignee +
  desk manager; resolution warn → assignee/owner; resolution breach → assignee/owner
  + desk manager; stale remind → assignee, else owner, else team members; stale
  escalate → desk manager (else unit head); auto-close → reporter.

## 4. Notifications (registry + `notification_event_settings` seeds)

`resolve.sd_new` (owner + team pool; mandatory), `resolve.sd_reply` (the other
side of a requester-visible reply), `resolve.sd_update` (requester: on hold with
the reason / preempted message), `resolve.sd_resolved` (requester: "confirm or
reopen"), `resolve.sd_reopened` (assignee/owner), `resolve.sd_urgent` (override →
assignee/owner/team; mandatory), `resolve.sd_breach` (recipients from meta;
mandatory), `resolve.sd_warning`, `resolve.sd_stale` (recipients from meta).
Reused: `resolve.assigned`, `resolve.closed`, `resolve.rated`.
The actor is never a recipient (stage 1 rule).

**Pop-up:** `components/resolve/live/resolve-popup.tsx`, mounted once in the app
shell beside the bell, shows a toast for a NEW notification whose event key starts
`resolve.sd_` (breach, stale, urgent, new) with an Open button. It reads the same
realtime stream as the bell (`useNotifications` exposes an `onInsert` callback);
no second subscription.

## 5. Realtime (whole hub)

`components/resolve/live/use-live-refresh.ts` — `useLiveRefresh(filter)` where filter
is `{ locationId }`, `{ ticketId }` or `{ reporterId }`: one channel per mounted
caller (`useId`, the bell's 2026-10-01 lesson), `postgres_changes` `*` on
`public.rh_tickets` with that filter, debounced 500 ms `router.refresh()`, refetch on
tab refocus. `<LiveBadge />` shows "Live" (green dot) / "Reconnecting…".
Mounted on: desk queue, desk dashboard, ticket detail, My Reports, My Work, Triage,
All Jobs, Complaints queue. Ticket detail of a service ticket refreshes on notes too,
because the notes trigger bumps `last_activity_at` (a row UPDATE).

## 6. Screens and nav

Nav (`lib/nav/module-groups.ts`, `/resolve`): new group **`desk` "Service Desk"**
(hub `/resolve/desk-hub`) → Desk Queue `/resolve/desk`, Desk Dashboard
`/resolve/desk/dashboard`, Log a Call `/resolve/desk/log`, Knowledge Base `/resolve/kb`,
Performance `/resolve/desk/performance`. Reporting group gains **IT Help Request**
`/resolve/report/service`. Administration gains **Service Categories**
`/resolve/setup/service-categories` and **Service SLA** `/resolve/setup/service-sla`.
Screen catalog entries for each. Run `npm run check:nav` + `check:nav-paths`.

- **Chooser** `/resolve/report`: fourth card "Need IT help" → `/resolve/report/service`.
- **Request form**: Category (picker), Title, What happened / what you need,
  Impact (three words, Segmented), optional screenshot (reuse `photo-capture` +
  `encode-jpeg` → JPEG, server strips metadata as stage 1). **KB suggestions** under
  the title as the requester types (debounced `rh_kb_search`), each opening the
  steps inline with "This solved it" (feedback helpful, no ticket) / "Still need help".
  Receipt: ref, team, priority, "first response by HH:MM".
- **My Reports** lists service tickets too (kind column / type pill), live.
- **Ticket detail** `kind = 'service'`: type, category, priority (+ override banner
  with reason), two SLA clocks (response, resolution) with state tones, requester,
  assignee, conversation (requester-visible notes as a thread), internal notes,
  root cause + resolution block, linked KB article, timeline. Actions from
  `rh_ticket_actions` only. Resolve sheet = root cause + steps + "pick a KB article"
  (search) + "Write a KB article from this" after. Start sheet when the technician
  already has an in-progress ticket: "Put SD-… on hold?" with the pre-written
  message (editable): *"Hello — I have had to pause your request briefly to deal
  with an urgent, business-critical issue. I will come back to it as soon as that
  is done. Thank you for your patience."* After resolving an urgent ticket that
  preempted one: banner "You paused SD-… for this — Resume it".
- **Desk Queue** `/resolve/desk`: tabs Unassigned · Mine · Team · Breaching · All ·
  Done; Start-of-shift line on Mine; columns Ref, Type, Title, Priority (Urgent
  override flagged), Requester, Assignee, Response clock, Resolution clock, Age /
  stale days; bulk assign for triage; live.
- **Desk Dashboard**: tiles (Open, Unassigned, At risk, Breached, On hold, Resolved
  today), technician allocation table, priority + type distribution, trend chart
  with Daily / Weekly / Monthly `ToggleGroup`, escalations list; live.
- **Log a Call**: requester picker (people), channel (Phone / Email / Chat /
  WhatsApp), then the same form fields; receipt read back to the caller.
- **Knowledge Base** `/resolve/kb`: search + list (published; drafts tab for `edit`),
  article page (numbered steps, helpful yes/no, used count), editor sheet
  (title, problem, steps as a ChildGrid with a tail row, tags, category).
- **Performance** (export): date range, per-technician table + desk total, CSV.
- **Admin**: Service Categories (code, name, type, team, default priority, Active
  first) and Service SLA (4 rows × response / resolution minutes); Unit Settings
  gains Desk manager, auto-close / stale / reopen days.

All screens follow AGENTS.md standing rules: hooks above early returns,
`useUnsavedGuard`, Tab contract, `required` once, capitals (KB steps are prose but
the client chose capitals everywhere — keep default), `statusTone`, row actions
icons, Created columns, compact widths (`check:grid-budget`).

## 7. Files and lanes (never edit another lane's files)

| Lane | Owns |
|---|---|
| **db** (lead) | `supabase/migrations/07xx_resolve_service_desk_*.sql`, `scripts/resolve-smoke-test.sql` (new block), apply + catalog verification |
| **server** | `lib/resolve/desk-types.ts`, `lib/resolve/desk-service.ts`, `lib/resolve/desk-actions.ts`, `lib/resolve/desk-schemas.ts`, `lib/resolve/kb-*.ts`, `lib/resolve/sla.ts` (desk helpers appended), `lib/notifications/events.ts` (sd events), `lib/jobs/{registry,sweeps}.ts` + `app/api/cron/resolve-desk/route.ts` + `vercel.json`, `lib/ui/status-tone.ts` (service statuses), `lib/resolve/outbox.ts` (messages for sd events), `lib/resolve/messages.ts`, `scripts/check-resolve.mts` vectors |
| **requester-ui** | `app/(app)/resolve/report/**` (chooser card + `service/`), `app/(app)/resolve/my-reports/**`, `app/(app)/resolve/tickets/**`, `app/(app)/resolve/kb/**`, `components/resolve/service/**`, `components/resolve/ticket/**`, `components/resolve/kb/**`, `components/resolve/live/**`, `lib/notifications/use-notifications.ts` (`onInsert` only), shell mount of the pop-up |
| **desk-ui** | `app/(app)/resolve/desk*/**`, `app/(app)/resolve/setup/service-*/**`, `components/resolve/desk/**`, `components/resolve/admin/service-*.tsx`, `components/resolve/admin/unit-settings-screen.tsx`, nav files (`lib/nav/module-groups.ts`, `lib/nav/group-hub-icons.ts`, `lib/permissions/screen-catalog.ts`), mounting `useLiveRefresh` on existing work screens (`components/resolve/work/**`, `components/resolve/complaints/complaints-screen.tsx`) |

Verification: `npx tsc --noEmit` (read error PATHS — shared tree), eslint on own
paths, `npm run check:hooks`, `check:resolve`, `check:nav`, `check:nav-paths`,
`check:notification-events`, `check:jobs`, `check:status-tone`,
`check:button-shape`, `check:grid-budget`, smoke SQL "0 FAIL". Never `npm run build`,
never `git add -A` / `stash`.

## 8. As built

(filled in by each lane when it lands)

**db lane — 0749 · 0750, applied 2026-10-26, verified from the catalog**
- `rh_kb_articles.search` joins arrays through `rh__kb_join(text[])` (immutable
  wrapper): `array_to_string` is only STABLE and a generated column refuses it.
- The 0739 pause check was the unnamed `rh_tickets_check1`; it is now the named
  `rh_tickets_paused_check` (blocked OR on_hold ⇔ paused_at).
- Extra return fields beyond §3: `rh_sd_dashboard().escalation_list` (top 10:
  id, ref_no, title, priority, reason stale|resolution|response, at,
  assignee_name); `rh_sd_queue` rows carry `source`; `rh_sd_shift_summary()`
  carries `since`; `rh_sd_resolve` returns `{status, preempted:[{id, ref_no, title}]}`.
- `rh_sd_resolve` sets `assignee_id := coalesce(assignee_id, me)`, so an owner who
  resolves without claiming is credited in Performance.
- The pause message on a preempted ticket is a requester-visible NOTE written under
  `rh.quiet_note = on`, so the requester gets ONE notice (the `held` row), not two.
- `kb_written` is logged on the source ticket when an article is drafted from it.
- Ledger: 0750 was applied as four `execute_sql` create-or-replace parts (§1–§8)
  plus one `apply_migration` (§9–§11) after a single large call failed in transit;
  the repo file is the whole migration and the source of truth.
- `scripts/resolve-desk-smoke-test.sql` (rolled back): 44 checks, run 2026-10-26 —
  43 passed on the first run, D44 failed on a test-date bug (fixed), then the
  performance block re-run separately: 0 FAIL.

**desk-finish (desk-ui lane) — 2026-10-26**
- `/resolve/desk/dashboard` renders `desk-dashboard.tsx`; the Escalations panel
  now reads `rh_sd_dashboard().escalation_list` (why + when each went up), not
  the breaching queue. `DeskEscalation` / `ESCALATION_REASON_LABEL` added to
  `desk-types.ts` and the mapping to `getDeskDashboard` (it had dropped the key).
  The `escalations` tile counts LIVE escalated tickets, not "today" — subtitle says so.
- `/resolve/desk/log` is its own screen (`log-call-screen.tsx`), not the
  requester form's `logCall` mode: it STAYS on the page and shows a receipt card
  (ref, team, owner, priority, first reply by, resolve by) for the agent to read
  back, then "Log another call". KB suggestions under the title; "This solved it"
  ends the call with no ticket. No photo box (nothing to attach on a call).
- `/resolve/desk/performance` — range in the URL (`?from=&to=`, default this
  month on the business-local `lib/calendar` today), Show button navigates,
  desk total last with a strong rule, client-side CSV of raw minutes / percent.
- Service Categories = `SimpleMasterScreen` sheet (trades pattern). The CODE is
  typed and `lockedOnEdit` — the KB is keyed by category code (§1.7). Off teams
  are not offered except the one a category already routes to.
- Service SLA = a fixed four-row `ChildGrid` (`hideAdd` / `hideRemove`,
  default-row exempt), minutes as text, the schema's rules mirrored under each box.
- Unit Settings gains a Service Desk card saved through `saveDeskUnitSettings`
  only when that half is dirty. The desk-manager warning uses
  `listDeskApproverIds()` (new, `desk-service.ts`) = `users_with_permission
  ('resolve','approve')` — one call; a failed read hides the warning.
- Live (`useLiveRefresh({locationId})` + `LiveBadge`) mounted on My Work,
  Triage, All Jobs and Complaints.
- Nav: every desk / setup route was already in `module-groups.ts`; the setup
  hub is a `GroupHub`, and `screen-catalog.ts` is DERIVED from module-groups, so
  neither needed an edit (`check:screen-catalog` passes).

**kb-ticket (requester-ui ticket page + KB, server-lane wording and job) — 2026-10-26**
- Ticket page: `kind === 'service'` branches in `app/(app)/resolve/tickets/[id]/page.tsx`
  to `ServiceTicketView` (`components/resolve/ticket/service-ticket-detail.tsx`);
  Broken and complaints still render `TicketDetailView`, untouched apart from
  `Pair` / `Section` / `Photos` now being exported. Live via `<LiveRefresh
  filter={{ticketId}}>` in the header band.
- Panel `service-ticket-actions.tsx` draws only `rh_ticket_actions`. Start's
  pause offer reads the technician's OTHER in-progress tickets from
  `listDeskQueue("mine")` (no new RPC); it defaults to "Put it on hold" only when
  this ticket is overridden (spec §3.2), else "Keep both going". The "You paused
  SD-… — Resume" banner merges `extras.paused_for_this` (server) with the
  `preempted` list `rh_sd_resolve` returned, so it shows once either way.
- Resolve's KB picker is a native Select fed by `extras.kb_suggestions` plus a
  debounced `searchKnowledgeBase` box (`type="search"`) — keyboard-reachable,
  no hand-rolled listbox.
- Conversation (`service-conversation.tsx`): reporter-visible notes as a
  two-sided thread + reply box (`note_reporter`); internal notes amber, staff
  only. `replied` rows are dropped from the History (the thread carries them).
  `TicketTimeline` gained the service verbs and an optional `statusLabels` (New).
- `kb_draft` opens `KbEditorSheet` pre-filled: title, root cause → problem,
  resolution split into steps (`stepsFromText`: lines, else sentences).
- KB: `/resolve/kb` (search filters loaded rows; Drafts / Retired as `?status=`
  for `resolve:edit`, anything else falls back to Published) and
  `/resolve/kb/[id]` (steps, used count, Yes/No feedback, Edit / Publish /
  Retire with confirms). Saving always makes / keeps a DRAFT until Publish.
  Steps grid = `ChildGrid tailRow` (blank end row, dropped by the schema); one
  flexible column, so `check:grid-budget` has nothing to measure (it skips < 2
  columns). `published` tone = success via the named `kbStatusTone` override.
- Wording: `lib/resolve/messages.ts` gained `action` and `due_at` in the context
  (the outbox passes `row.action`, reads `due_at`); every `resolve.sd_*` key is
  worded, and `resolve.assigned` / `.closed` / `.rated` branch on
  `kind === 'service'` (claimed vs assigned, confirmed vs auto-closed). Service
  words still honour `hidesSubject` (unknown ticket ⇒ ref only).
- `resolve.sd_stale` registry `fallbackToAdmins` set to **false** to match the
  applied 0749 seed (check:notification-events failed on the mismatch).
- Job `resolve-desk`: `lib/resolve/desk-sweep.ts` (`rh_sd_sweep` as service role,
  then `drainOutbox({limit: 500})`), route `app/api/cron/resolve-desk`, registry,
  `JOB_SWEEPS`, `vercel.json` `*/5 * * * *`.
- `lib/resolve/sla.ts` `resolutionState`: the at-risk threshold is now
  `Math.round(...)` — exactly 80 % used read on_track in floating point while the
  SQL said at_risk (found by the new check:resolve vector). Still differs from
  `rh__sd_clock` in one place: SQL calls the RESPONSE clock `met` on a
  cancelled / withdrawn ticket; `responseState` takes no status, so a ticket page
  of a cancelled, never-answered request can read "Response overdue".
