# Resolve Hub — Phase 1 + Broken workflow: build contract

Spec: `doc/Reslove hub.md/resolvehub.md` (the spec calls it InstaSolver; the
module is **Resolve Hub**, route prefix `/resolve`, DB prefix `rh_`, permission
module `resolve`). This file is the contract every builder codes against. If the
code must deviate, change THIS file in the same edit and say why.

Scope of this release: Phase 1 foundations for ALL ticket kinds + the complete
**Broken** workflow end to end. Complaints (anonymous token, committee) and the
AI form-filler are the next stages — their columns/enum values exist so they
add without a rewrite, but no screen or RPC ships for them yet. "Need to buy
something" hands off to the EXISTING indent workflow (no new procurement table).

## 1. Repository assessment (discovery 2026-10-23)

| Spec concept | Raagam reality | Decision |
|---|---|---|
| Employee identity | `staff` is the person table (`employees` = 19 test rows). Login ↔ staff via `profiles.employee_code = staff.code`, else email (`employee_login_ids`, 0674; `resolveMyStaffId`). **0 profiles linked today.** | Every person column is `profiles.id` (= `auth.uid()`). Staff/manager/leave are OPTIONAL routing enrichments resolved through the 0674 link — never required. |
| Permission keys | `permissions(module, action)`, actions fixed to view/create/edit/delete/approve/export; tree UI reads them. | Module `resolve`. Mapping in `lib/resolve/permissions.ts` (`RH`), the ONLY place it is spelled. See §3. |
| College head / estate office | No unit-head role; `locations` has no head column; `departments` no head. | `rh_unit_settings` per location: `unit_head_id`, `estate_owner_id`, `director_ids[]`. |
| Places / assets | `assets` (admin module, `system_admin:*` RLS, free-text custodian); no room master. | New `rh_places` (location-scoped, optional `asset_id → assets`, `caretaker_id → profiles`, `qr_token`). |
| Reporting manager | `staff.manager_id → staff`; none set today. | Leave fallback: owner's staff → manager's staff → profile. Falls through to estate/unit head when absent. |
| Approved leave | `hr_leaves(employee_type='staff', employee_id, status='approved', from_date, to_date, is_encashment)`; RLS hr_payroll:view. | Read inside SECURITY DEFINER `rh_on_leave(profile)`; IST date. |
| Notifications | `notify(eventKey, target, payload, opts)` in-app + web push, logs `notification_dispatches`; no outbox, no SMS/WhatsApp. | `rh_outbox` filled by a trigger on `rh_ticket_activity` (durable, idempotent `dedupe_key`), drained by `lib/resolve/outbox.ts` through `notify()` with retries. External channel rows are recorded; with no provider configured they end `skipped` (truthful, never "sent"). |
| Cron | `runJob` + `/api/cron/<key>` + `vercel.json` + `CRON_SECRET`; no pg_cron. | Jobs `resolve-escalation` (daily) and `resolve-outbox` (every 5 min). |
| Counters | per-(location, fy) counter tables + upsert. | `rh_ref_counters(prefix, year)` → `BRK-2026-000123` (spec format, global per kind/year — the ref is a person-facing receipt, not a GST document). |
| Rate limit | `lib/rate-limit.ts` is in-memory per instance. | DB ledger `rh_report_ledger`; `pg_advisory_xact_lock` per user inside the submit tx. |
| Uploads | private buckets + signed URLs; no server image lib. | Private bucket `resolve-photos`, NO insert policy for `authenticated` — only the server action (service role) writes, after `lib/resolve/jpeg.ts` verifies magic bytes and strips APP1–APP15 + COM segments (EXIF/GPS). Reads via signed URLs after an RLS-checked read of the ticket. |
| Procurement | `purchase_indents` (`materials_purchase:create`), `/purchase/indents`. | Third card links there when `can('materials_purchase','create')`; otherwise explains who raises indents. |
| Public token routes | `proxy.ts` bypasses `/p/`; `/r/` not bypassed. | `/r/<token>` lives INSIDE `app/(app)` — a scan needs a login (redirect back after). No anonymous write path in this release. |
| Tests | No vitest/jest; checks are `scripts/check-*.mts` + SQL smoke blocks that end in `raise exception` ("0 FAIL"). | `scripts/check-resolve.mts` (pure TS: jpeg strip, SLA math, score) + `scripts/resolve-smoke-test.sql` (RLS, transitions, rate limit, counters). |

Shared-tree rules (AGENTS + memory): another session is editing purchase
files (`lib/nav/module-groups.ts`, `lib/purchase/po-service.ts`, 0737/0738).
Migration numbers come from the LEDGER (`name like '07%'` order by version),
not `ls`. Never `npm run build`, never `git add -A`/`stash`; verify with
`npx tsc --noEmit` + the named check scripts.

## 2. Data model (migrations 0739+; numbers re-read from the ledger at apply time)

Shared masters (no location, "master data is shared"): `rh_trades`.
Everything else carries `location_id uuid not null default public.current_location()`
with policies on `public.is_current_location(location_id)` (the 0594 shape), or
is a child that ANDs `public.lv_rh_<owner>(fk)`.

- **rh_unit_settings** (location_id PK→locations): unit_head_id, estate_owner_id
  (→profiles), director_ids uuid[], timezone text default 'Asia/Kolkata',
  escalation_hour int default 8, ordinary_days int 2, routine_days int 7,
  purchase_days int 7, dup_window_days int 14, dispute_window_days int 7,
  report_limit_24h int 10, spot_check_one_in int 10, page_cap_per_day int 20,
  suppress_notifications bool false, triage_weights jsonb (defaults §6), updated_at.
- **rh_trades**: code, name (CAPS), description, inactive, created_by/at.
- **rh_places**: location_id, code, name, kind ('building','floor','room','area','machine','asset'),
  parent_id → rh_places, asset_id → assets null, caretaker_id → profiles null,
  default_trade_id → rh_trades null, qr_token text unique (≥128-bit, base64url, set
  by `rh_issue_qr`), qr_printed_at, inactive, created_by/at.
- **rh_teams**: location_id, trade_id, name, lead_id → profiles, inactive.
- **rh_team_members**: team_id → rh_teams (cascade), profile_id, active; unique(team_id, profile_id). Child → `lv_rh_team`.
- **rh_routing_overrides**: location_id, trade_id null, place_id null, owner_id, note; (rule 1).
- **rh_tickets** (unified): location_id, kind ('broken','complaint','requirement'),
  ref_no unique, status, reporter_id → profiles (null only for anonymous complaint),
  place_id, trade_id, title, description, is_dangerous, severity
  ('critical','high','medium','low'), priority ('urgent','high','medium','low'),
  is_routine bool, source ('form','qr','ai'), gps_lat/gps_lng numeric(9,4) null,
  owner_id, owner_reason text (which routing rule fired), team_id, assignee_id,
  due_at timestamptz, paused_at timestamptz null, paused_seconds int 0,
  blocked_reason, fix_round int 1, dispute_count int 0, reopen_count int 0,
  fixed_at, closed_at, closure_kind ('auto_photo','spot_checked','owner_confirmed') null,
  spot_check_pending bool, cancel_reason, needs_sorting bool,
  -- complaint columns (no RPC yet): category_id, is_anonymous, about_superior, tracking_token_hash
  created_by default auth.uid(), created_at, updated_at.
  **No insert/update/delete policy** — every write is a guarded RPC.
- **rh_ticket_photos**: ticket_id, kind ('report','fix'), fix_round, path, uploaded_by, created_at.
- **rh_ticket_joiners**: ticket_id, profile_id, joined_at; unique pair.
- **rh_ticket_activity** (append-only; select policy only; trigger refuses UPDATE/DELETE):
  ticket_id, actor_id, action, from_status, to_status, note, meta jsonb, created_at.
- **rh_ticket_notes**: ticket_id, author_id, body, visibility ('internal','reporter'), created_at.
- **rh_ratings**: ticket_id, fix_round, rater_id, stars 1–5, comment; unique(ticket_id, fix_round).
- **rh_report_ledger**: profile_id, ticket_id, kind, created_at (rate limit; written in the submit tx).
- **rh_ref_counters**: prefix ('BRK','CMP','REQ'), year int, last_no; PK(prefix, year).
- **rh_outbox**: activity_id, ticket_id, location_id, event_key, recipient_id, channel
  ('in_app','sms'), dedupe_key unique, status ('pending','sent','failed','skipped','suppressed'),
  attempts, last_error, next_attempt_at, sent_at, created_at.
- **rh_escalations**: ticket_id, level (1,3,7), fix_round, created_at; unique(ticket_id, level, fix_round).

Statuses (broken): `open, in_progress, blocked, fixed, closed, cancelled, withdrawn`.
"Open" for counting = open/in_progress/blocked/fixed(spot-check pending).

## 3. Permissions (module `resolve`)

| Spec key | DB action | Who gets it by default |
|---|---|---|
| view (report, own reports) | `resolve:view` | EVERY role (seeded) — reporting is for everyone |
| work | `resolve:edit` | Supervisor, Manager, Store Keeper, Factory Manager, Administrator |
| triage | `resolve:approve` | Administrator, Factory Manager, Managing Director |
| analytics | `resolve:export` | Administrator, Managing Director, Factory Manager |
| admin | `resolve:create` | Administrator |

Row visibility (`rh_can_see(ticket)`): reporter or joiner (any unit) OR, in the
current unit: owner, assignee, member of the ticket's team with `resolve:edit`,
`resolve:approve`, `resolve:export`, or the unit's settings head/estate. Internal
notes need `rh_is_staff_on(ticket)` (everyone above EXCEPT a reporter/joiner who
is nothing else). Super admin = has_permission is true.

## 4. RPCs (all SECURITY DEFINER, `set search_path = ''`, `revoke all … from public, anon; grant execute … to authenticated`)

Every transition: `select … for update` the ticket, check status + actor, update,
insert ONE `rh_ticket_activity` row; raise with errcode 'P0001' and a sentence the
operator can read. Returns `jsonb` unless stated.

| RPC | Who | Effect |
|---|---|---|
| `rh_submit_broken(p_place_id, p_trade_id, p_title, p_description, p_is_dangerous, p_photo_path, p_gps_lat, p_gps_lng, p_source)` | resolve:view | rate limit (advisory lock + ledger), ref no, route, due, ticket + photo + ledger + activity('created'). Returns `{ticket_id, ref_no, owner_id, owner_name, owner_reason, due_at, needs_sorting}` |
| `rh_similar_open(p_place_id)` → table(id, ref_no, title, status, is_dangerous, created_at, joiners) | view | same location+place, open, within dup window |
| `rh_place_by_token(p_token)` → `{place_id, name, location_id, location_name, caretaker_name, recent_90d}` | view | refuses a unit the caller can't access |
| `rh_join(p_ticket_id)` | view | joiner row + activity('joined'); refuses own ticket / closed / dangerous-check none |
| `rh_claim(p_ticket_id)` | edit + team member | assignee := me |
| `rh_assign(p_ticket_id, p_assignee_id)` | approve | assignee (must be active member of a team at that unit, or owner) |
| `rh_start(p_ticket_id)` | owner/assignee | open→in_progress (assignee := me if null) |
| `rh_block(p_ticket_id, p_reason)` | owner/assignee | open/in_progress→blocked, paused_at=now |
| `rh_unblock(p_ticket_id)` | owner/assignee/triage | blocked→in_progress, due_at += pause, paused_seconds += pause |
| `rh_fix(p_ticket_id, p_photo_path, p_note)` | owner/assignee | in_progress→fixed; 1-in-N spot check (`random()`); else →closed `auto_photo`. Returns `{status, spot_check}` |
| `rh_spot_check(p_ticket_id, p_pass, p_note)` | approve | pass: fixed→closed `spot_checked`; fail: →in_progress, fix_round+1, fresh due |
| `rh_owner_confirm(p_ticket_id, p_note)` | owner or approve | fixed→closed `owner_confirmed` (excluded from verified fix-rate) |
| `rh_dispute(p_ticket_id, p_reason)` | reporter, ≤ dispute_window_days after closed_at | closed→in_progress, dispute_count+1, reopen_count+1, fix_round+1, fresh due |
| `rh_cancel(p_ticket_id, p_reason)` | approve | open→cancelled |
| `rh_withdraw(p_ticket_id)` | reporter | open (no assignee started)→withdrawn |
| `rh_edit_report(p_ticket_id, p_title, p_description)` | reporter while open | text only |
| `rh_reclassify(p_ticket_id, p_trade_id, p_severity, p_priority, p_is_routine)` | approve | re-route if trade changed; recompute due |
| `rh_add_note(p_ticket_id, p_body, p_visibility)` | can_see; internal needs staff_on | |
| `rh_rate(p_ticket_id, p_stars, p_comment)` | reporter, closed, once per fix_round | |
| `rh_ticket_actions(p_ticket_id)` → text[] | can_see | THE list the next-action panel renders (no UI re-derivation) |
| `rh_triage_queue(p_tab text)` → table(…ticket cols, score int, score_parts jsonb) | approve | tabs 'decide' (unassigned/needs_sorting/spot-check/disputed), 'open', 'all' |
| `rh_workload()` → table(team_id, team_name, profile_id, name, open, in_progress, blocked, overdue) | edit/approve/export | scoped |
| `rh_analytics(p_weeks int default 12)` | export | §7 metrics, current unit |
| `rh_issue_qr(p_place_id)` → text token | create | new token, qr_printed_at stays null |
| `rh_mark_qr_printed(p_place_ids uuid[])` | create | |
| `rh_escalation_sweep()` | service_role only | §5; returns `{level1, level3, level7}` |
| `rh_outbox_claim(p_limit)` / `rh_outbox_mark(p_id, p_status, p_error)` | service_role only | drain |

**As built (0739–0741, db lane) — where it differs from the table above:**
- Every `rh_submit_broken` arg has a default (call by name). No trade picked → the
  place's `default_trade_id` is used before falling to needs_sorting. With no trade,
  a place-only override and the QR caretaker still apply (they are place rules).
- `rh_add_note` writes NO activity row (a note is not a transition); returns `{note_id}`.
  Other transitions return `{status, …}`; `rh_join` → `{ticket_id, ref_no, joined}`.
- `rh_issue_qr` resets `qr_printed_at` to null (a new token is an unprinted sticker).
  `rh_mark_qr_printed` returns the row count (int).
- `rh_escalation_sweep` returns `{level1, level3, level7, digests}`. Level 7 writes no
  per-ticket activity; it is carried by ONE `digest` activity per director per unit
  per local day, whose `ticket_id` is NULL and `meta = {director_id, day, location_id,
  tickets:[{ticket_id, ref_no, title, days_late}]}`. So `rh_ticket_activity.ticket_id`
  and `rh_outbox.ticket_id` are nullable (digest only).
- `rh_outbox_claim(p_limit)` → table(id, activity_id, ticket_id, location_id, event_key,
  recipient_id, channel, attempts, ref_no, title, location_name, action, note, meta);
  claimed rows are LEASED 5 min (`next_attempt_at`), so overlapping drains never double
  send. `rh_outbox_mark(id, status, error)`: status ∈ sent | failed | skipped; failed →
  attempts+1, retry at now()+2^attempts min, `failed` for good at 5.
- `rh_ticket_actions` is computed by `rh_actions_of(ticket, uid)`, and every transition
  RPC checks the SAME function before writing — panel and guard cannot disagree.
- `rh_tickets` has four FKs to `profiles` — embeds must name the column
  (`profiles!owner_id(full_name)`), per AGENTS "A SECOND FK BREAKS EVERY EXISTING EMBED".
- `resolve:view` is seeded on every ROLE; a login holding no role at all has no
  `resolve:view` and cannot report.

Admin masters (trades, places, teams, members, overrides, unit settings) write
through ordinary tables with RLS `has_permission('resolve','create') and
is_current_location(location_id)` — they are configuration, not lifecycle.

## 5. Routing, SLA, escalation

Routing `rh_route(location, place, trade, source)` → (owner_id, team_id, reason), first hit wins:
1. `rh_routing_overrides` (place+trade, then place, then trade).
2. source='qr' and place.caretaker_id.
3. team of that trade at the unit: lead_id, else first active member.
4. unit settings estate_owner_id.
5. unit settings unit_head_id. (Nothing → owner NULL, needs_sorting = true; triage "Decide" tab.)
Leave: if the chosen owner is on approved leave today (`rh_on_leave`), use their
staff manager's login; else continue down the list. Reason text records the hop
("Team lead on leave → manager").
No trade picked → needs_sorting = true, rule 1 skipped for trade, falls to 4/5.

Due (in `timezone` of the unit): dangerous → 23:59:59 local today (if submitted
after 18:00 local → +4h floor); ordinary → now + ordinary_days; routine → + routine_days.
Severity/priority derive: dangerous → critical/urgent; ordinary → medium/medium;
routine → low/low. The reporter never chooses them.
SLA "late" = `now() > due_at` and status in (open, in_progress) — blocked never late;
unblock shifts `due_at` by the paused span, so paused time never counts.

Escalation (daily, `escalation_hour` local, job `resolve-escalation`):
overdue ≥1 day → owner's staff manager login, else estate_owner; ≥3 → unit_head;
≥7 → director digest (one notification per director listing the tickets).
`rh_escalations` unique row makes the sweep idempotent.

## 6. Triage score (defaults in `rh_unit_settings.triage_weights`)
severity critical 100/high 60/medium 30/low 10; priority urgent 80/high 50/
medium 20/low 5; 2 per day open (cap 60); reopened 70; disputed 90; same
place+trade with another ticket in 30 days 25; unassigned 15; closed/cancelled/
withdrawn = 0. `score_parts` = `[{label, points}]`, shown as the explanation.

## 7. Analytics formulas (current unit; joins never counted as tickets)
total = broken tickets created in range; open/late/blocked/fixed/closed counts;
reopened = reopen_count>0; disputed = dispute_count>0;
**verified fix rate** = verified closures (closure_kind in auto_photo, spot_checked)
that were never reopened ÷ all verified closures — owner_confirmed, cancelled and
withdrawn excluded (as written before, "verified ÷ (closed − owner_confirmed)" is
identically 1, so 0740 measures whether a verified fix HELD); reopen rate = reopened ÷ closed;
median days to fix = median(fixed_at − created_at − paused); avg resolution = mean(closed_at − created_at − paused);
weekly new vs fixed (12 weeks); late by place; top 20 place×trade repeats;
top 5 people by closed and by overdue (export permission); by source.

## 8. Notifications (events in `lib/notifications/events.ts`, module "resolve")
`resolve.ticket_routed` (owner/team), `resolve.dangerous` (owner, push + sms row,
page cap 20/unit/day — counted in SQL; if the count read fails → no sms row),
`resolve.assigned`, `resolve.joined`, `resolve.fixed` (reporter + joiners),
`resolve.closed`, `resolve.disputed` (owner; no reporter name; 2nd dispute also
unit_head), `resolve.rated` (fixer), `resolve.overdue` (escalation recipients),
`resolve.digest` (directors). The actor is never a recipient. Suppressed when
`rh_unit_settings.suppress_notifications` or `meta->>'suppress' = 'true'`.

## 9. Ownership (who writes which files — never edit another lane's files)

| Lane | Owns |
|---|---|
| **db** | `supabase/migrations/07xx_resolve_*.sql`, `scripts/resolve-smoke-test.sql` |
| **server** | `lib/resolve/**` (types already written by lead), `app/api/cron/resolve-*/route.ts`, edits to `lib/auth/types.ts`, `lib/notifications/events.ts`, `lib/jobs/{registry,sweeps}.ts`, `vercel.json`, `lib/ui/status-tone.ts`, `scripts/check-resolve.mts`, package.json script `check:resolve` |
| **report-ui** | `app/(app)/resolve/report/**`, `app/(app)/resolve/my-reports/**`, `app/(app)/resolve/tickets/**`, `app/(app)/r/**`, `components/resolve/report/**`, `components/resolve/ticket/**` |
| **work-ui** | `app/(app)/resolve/(everything else)`, `components/resolve/work/**`, `components/resolve/admin/**`, `components/resolve/analytics/**`, nav: `components/shell/nav.ts`, `lib/nav/module-groups.ts` (small surgical Edit — another session has it modified), `lib/nav/group-hub-icons.ts`, `lib/permissions/screen-catalog.ts`, `components/shell/mobile-nav.tsx`, `package.json` dep `qrcode` |

Nav shape: module `/resolve` (label "Resolve Hub"), groups:
`reporting` "Reporting" (hub `/resolve/reporting`) → Report a problem `/resolve/report`, My Reports `/resolve/my-reports`;
`work` "Work" (hub `/resolve/work`) → My Work `/resolve/my-work`, Triage Queue `/resolve/triage`, All Jobs `/resolve/jobs`, Workload `/resolve/workload`;
link → Analytics `/resolve/analytics`;
`setup` "Administration" → Trades, Places & QR, Teams, Routing, Unit Settings (`/resolve/setup/<x>`).
Ticket detail `/resolve/tickets/[id]`, receipt `/resolve/tickets/[id]?receipt=1`, QR `/r/[token]`.

## 10. Stage 2 — Complaints (spec §4 "Complaint report", §8 sensitive handlers)

Reuses `rh_tickets` with `kind = 'complaint'`, ref prefix `CMP` (`CMP-2026-000001`).
Statuses (complaint only): `open, assigned, in_progress, escalated, resolved, withdrawn`
— widen the status check per kind; Broken statuses are untouched.

### 10.1 Data (new migration(s), number from the ledger)
- **rh_complaint_categories** (location-scoped, admin-managed): code, name (CAPS),
  description, `is_sensitive` bool, `anonymous_allowed` bool, `handler_id → profiles`
  (default handler), `response_hours int default 72`, inactive. Seed per unit:
  GENERAL / WORKPLACE FACILITIES / SALARY & PAY / HARASSMENT (sensitive, anonymous) /
  DISCRIMINATION (sensitive, anonymous) / SAFETY CONCERN / OTHER.
- **rh_category_members**: category_id, profile_id, role `committee` | `oversight`; unique.
  Child → `lv_` predicate.
- `rh_unit_settings` + `superior_handler_id` (the configured independent handler for
  "about my superior"), `complaint_response_hours int default 72`.
- `rh_tickets` complaint columns already exist (category_id, is_anonymous,
  about_superior, tracking_token_hash) + add `resolution_message text`,
  `response_due_at timestamptz`, `first_response_at`, `resolved_at`, `withdrawn_at`.

### 10.2 Anonymity (the part that must never regress)
For an anonymous complaint NOTHING links it to the person:
`reporter_id NULL`, `created_by NULL` (explicitly — the column default is auth.uid()),
every activity row the complainant causes has `actor_id NULL`, the rate-limit ledger row
has `ticket_id NULL` and `created_at` truncated to the hour, the outbox never targets or
excludes the complainant, notifications never name them. The tracking token: 32 random
bytes (`gen_random_bytes`, 256 bits) → base64url, returned ONCE by the submit RPC,
only `sha256` hex stored in `tracking_token_hash`. The visibility helpers stay uid-free
(0744) — a uid-taking helper reachable by `authenticated` is an anonymity leak.
Non-anonymous complaints keep `reporter_id` and see their complaint in My Complaints.

### 10.3 Who sees a complaint (`rh__can_see` complaint branch)
- non-anonymous reporter: own complaint (never internal notes);
- the assigned handler (`owner_id`/`assignee_id`);
- category `committee` and `oversight` members;
- **non-sensitive only:** `resolve:approve` (triage) in the current unit;
- **sensitive:** nobody else — not triage, not analytics, not super admin unless listed
  as a member. (Super admin bypasses `has_permission`; the sensitive branch must test
  membership, not permissions.)
- An "about my superior" complaint is never visible to anyone in the reporter's
  management chain (computed at submit and stored as excluded ids? NO — storing the
  chain identifies the reporter. Instead the handler is chosen outside the chain at
  submit, and committee/oversight are explicit lists; triage visibility is removed for
  about_superior complaints exactly as for sensitive ones.)

### 10.4 Routing (handler) + deadline
Handler = first candidate NOT the reporter and NOT in the reporter's management chain
(`staff.manager_id` walked upward via the 0674 login link; empty chain when unlinked):
about_superior → `superior_handler_id`, then unit_head, then directors;
otherwise → category `handler_id`, then first committee member, then estate_owner, then unit_head.
None left → refuse with "No independent handler is configured for this complaint —
ask the administrator to set one in Resolve Hub ▸ Administration ▸ Unit Settings."
`response_due_at = now + category.response_hours` (default 72h); `due_at` mirrors it.

### 10.5 RPCs (SECURITY DEFINER, search_path '', grants as before)
| RPC | Who | Effect |
|---|---|---|
| `rh_submit_complaint(p_category_id, p_subject, p_description, p_is_anonymous, p_about_superior)` | resolve:view | rate limit (same 10/24h ledger, kind 'complaint'), anonymity rules §10.2, route, `CMP` ref, activity 'created'. Returns `{ticket_id (NULL when anonymous), ref_no, tracking_token (anonymous only, shown once), handler_name, response_due_at}` |
| `rh_complaint_categories_open()` → table(id, name, description, is_sensitive, anonymous_allowed) | view | active categories of the current unit for the form |
| `rh_c_assign(p_ticket_id, p_assignee_id)` | handler / committee / triage(non-sensitive) | open/escalated→assigned |
| `rh_c_start(p_ticket_id)` | owner/assignee | open/assigned/escalated→in_progress, sets first_response_at |
| `rh_c_resolve(p_ticket_id, p_resolution_message)` | owner/assignee/committee | →resolved (message required — it is what the tracking page shows) |
| `rh_c_withdraw(p_ticket_id)` | non-anonymous reporter, not resolved | →withdrawn |
| `rh_track_complaint(p_token)` | **service_role only** | `{ref_no, subject, status, created_at, first_response_at, resolved_at, withdrawn_at, resolution_message}` — nothing else |
| `rh_track_withdraw(p_token)` | **service_role only** | anonymous withdraw, actor NULL |
`rh_add_note` works on complaints (internal notes never reach the tracking page).
`rh_ticket_actions` returns the complaint actions: `c_assign, c_start, c_resolve,
c_withdraw, note_internal, note_reporter`.
Escalation sweep: complaint past `response_due_at` with no `first_response_at`, status
open/assigned → `escalated` + activity 'escalated' (once, via `rh_escalations` level 1)
→ notify unit head for non-sensitive, oversight members for sensitive (never triage).

### 10.6 Notifications (add to registry + seeds)
`resolve.complaint_new` (handler, says the response deadline), `resolve.complaint_escalated`,
`resolve.complaint_resolved` (non-anonymous reporter only). Titles never contain the
reporter's name or, for sensitive categories, the subject — "New sensitive complaint
CMP-…" only.

### 10.7 Screens
- report-ui: chooser card live + "Track a complaint" link; `/resolve/report/complaint`
  form (category, subject, description, Anonymous toggle only when the category allows,
  About my superior toggle, a plain-words explanation of who will see it); receipt —
  for anonymous: the tracking link `/p/track/<token>` shown ONCE with Copy and a warning
  that it cannot be recovered; `/resolve/my-complaints` (non-anonymous only);
  public `/p/track` (paste a token) and `/p/track/[token]` OUTSIDE `app/(app)` (proxy
  already bypasses `/p/`), `robots: noindex`, `allow()` rate limit on clientIp, token
  shape check, lookup via service-role RPC, withdraw button; ticket detail handles
  kind='complaint' (statuses, actions, "Anonymous" in place of reporter, resolution message).
- work-ui: `/resolve/complaints` handler queue (assigned to me / my committees /
  all I may see, response-deadline state), nav rows My Complaints (Reporting group),
  Complaints (Work group), Track Complaint (`/p/track`, `external: true`), admin
  `/resolve/setup/complaint-categories` (category + committee/oversight member grid),
  Unit Settings gains superior handler + response hours.
- server: `submitComplaint`, `assignComplaint`, `startComplaint`, `resolveComplaint`,
  `withdrawComplaint`, `trackComplaint(token)`, `withdrawByToken(token)`,
  `listMyComplaints`, `listComplaintWork(tab)`, `listComplaintCategories`,
  `listOpenComplaintCategories`, `saveComplaintCategory`, categories admin; events; a
  check:resolve vector proving the token is 43 base64url chars and only its hash is sent
  to the DB.

### 10.8 As built (0745 · 0746, db lane) — where it differs from §10.1–10.6
- **About my superior is narrower than §10.3.** Visible only to the handler chosen
  outside the chain (owner/assignee) and a named reporter — NOT category committee/
  oversight, NOT triage. Reason: committee lists are never checked against the chain,
  and an anonymous reporter's chain cannot be recomputed after submit, so the handler is
  the only person PROVEN outside it. Same reason: `c_assign` is never offered on an
  about-superior complaint (no reassignment), and its 72h escalation notifies only that
  handler, not the unit head (who may be in the chain).
- Chain exclusion (reporter + `staff.manager_id` chain, depth ≤ 20, cycle-safe) applies
  to EVERY complaint's handler, as §10.4's first line says, not only about-superior.
- Sensitive escalation → oversight members; if a category has none, its committee
  members (still never triage).
- Complaint staff access requires the ticket's unit to be the caller's current unit
  (the same rule as Broken). Oversight is read-only; committee may assign and resolve.
- `rh_c_assign` also works from `assigned` (reassign). A sensitive complaint may only
  be assigned to a committee member; a non-sensitive one to the owner, a committee
  member, or a `resolve:edit` holder in the unit.
- `rh_track_complaint` returns NULL (no error) for an unknown or malformed token;
  `rh_track_withdraw` raises "This tracking link is not recognised."
- `rh_escalation_sweep` returns `{level1, level3, level7, digests, complaints}`.
- Seeds: `resolve.complaint_new` mandatory=true; all three `fallback_to_admins=false`
  (an admin fallback would deliver a sensitive complaint to people who may not see it).
- `rh_category_members` rows are readable by `resolve:create` admins and by each member
  for their own row only — committee membership is itself sensitive.
- Residual risk, accepted: an anonymous ticket's `created_at` is exact while its ledger
  row is hour-truncated; someone with SERVICE-ROLE access who sees one complaint and one
  ledger row in the same hour and unit can correlate them. No client role can read the
  ledger.
