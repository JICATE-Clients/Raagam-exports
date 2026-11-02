-- 0791 — HR ▸ CONDUCT & POLICIES (MyJKKN HR port, phase 5 — user 2026-11-02)
--
-- Source: MyJKKN docs/HR-MODULE-SPEC.md §13.5 (memos), §13.6 (disciplinary
-- cases) and §14 (policies), rebuilt on Raagam's units, people (staff +
-- workers) and approval engine:
--
--   MyJKKN                                  Raagam (this file)
--   ─────────────────────────────────────── ──────────────────────────────────
--   hr_memos + hr_memo_state_transitions    cd_memos + cd_memo_events — issued
--     issued → acknowledged → disputed        by HR; acknowledged or disputed
--     → resolved (super admin)                by the person (a worker has no
--     issueManual had no screen; the          login, so HR records it from the
--     auto-detector was broken                signed copy); resolved by HR
--   hr_disciplinary_cases + _events +       cd_cases + cd_case_events +
--     _witnesses; stage initiated →           cd_case_witnesses; the same
--     enquiry → hearing → decision →          stages, but the DECISION goes
--     closed; super admin decides alone;      through the approval engine
--     termination inserted an offboarding     (workflow cd_case_decision) and an
--     case "best effort" with no grounds      approved termination opens the exit
--                                             on Team Lifecycle ▸ Exits with the case as
--                                             its grounds
--   two policy systems (18 legacy tables    cd_policies + cd_policy_versions +
--     + platform_policies JSON); nothing      cd_policy_acks — one library of
--     recorded who had read a policy          written policies, versioned; each
--                                             published version is acknowledged
--                                             per person (self, or HR from paper)
--
-- NOT ported: the memo auto-detector (MyJKKN's own spec calls it broken), the
-- WhatsApp nudges, the JSON key/value policy store (Raagam keeps its settings
-- on its own setup screens), the weekly "promote to global" suggestions.
--
-- WHERE EACH RULE LIVES — memos and cases are written ONLY by the SECURITY
-- DEFINER functions below. Policies and versions are plain tables under RLS
-- with their rules in triggers; acknowledgements go through functions.
--
-- What this file touches outside its own cd_* objects:
--   * approval_apply_terminal() — one branch added by the anchor replace
--     0770–0773 used; every existing branch is unchanged.
--   * approval_flows — one catch-all row (cd_case_decision), only if none exists.
--   * lc_exits / lc_exit_steps (0771) — an APPROVED termination opens one exit,
--     already decided, through 0771's own lc_seed_exit_steps.
--   * storage — one new PRIVATE bucket (hr-policy-docs) and its policies.
--   * staff / workers — READ only.
--
-- Reuses 0770's timeoff_my_staff_id() / timeoff_person() / timeoff_today()
-- and 0771's lc_is_hr().

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Memos
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.seq_cd_memo;

create table if not exists public.cd_memos (
  id               uuid primary key default gen_random_uuid(),
  code             text,
  location_id      uuid not null references public.locations(id),
  staff_id         uuid references public.staff(id),
  worker_id        uuid references public.workers(id),
  memo_type        text not null
                   check (memo_type in ('late_coming', 'absence', 'leave_without_approval', 'misconduct',
                                        'performance', 'safety', 'other')),
  subject          text not null check (btrim(subject) <> ''),
  body             text not null check (btrim(body) <> ''),
  incident_date    date,
  issued_on        date not null default public.timeoff_today(),
  reply_by         date,
  status           text not null default 'issued'
                   check (status in ('issued', 'acknowledged', 'disputed', 'resolved', 'withdrawn')),
  ack_at           timestamptz,
  ack_by           uuid,
  ack_mode         text check (ack_mode is null or ack_mode in ('self', 'hr')),
  ack_note         text,
  dispute_reason   text,
  disputed_at      timestamptz,
  resolution_note  text,
  counts           boolean not null default false,   -- counts toward further action
  resolved_by      uuid,
  resolved_at      timestamptz,
  withdrawn_reason text,
  case_id          uuid,                              -- FK added after cd_cases
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint cd_memo_person check (num_nonnulls(staff_id, worker_id) = 1),
  constraint cd_memo_reply check (reply_by is null or reply_by >= issued_on)
);
comment on table public.cd_memos is
  'HR ▸ Conduct & Policies — memos to a person: issued, acknowledged or disputed, resolved. Written only by cd_* functions. 0791.';
create index if not exists idx_cd_memo_loc on public.cd_memos (location_id, status);
create index if not exists idx_cd_memo_staff on public.cd_memos (staff_id) where staff_id is not null;
create index if not exists idx_cd_memo_worker on public.cd_memos (worker_id) where worker_id is not null;
drop trigger if exists trg_cd_memo_code on public.cd_memos;
create trigger trg_cd_memo_code before insert on public.cd_memos
  for each row execute function public.assign_code('MEM', 'public.seq_cd_memo');
drop trigger if exists trg_cd_memo_updated on public.cd_memos;
create trigger trg_cd_memo_updated before update on public.cd_memos
  for each row execute function public.set_updated_at();

-- Every move, append-only.
create table if not exists public.cd_memo_events (
  id          uuid primary key default gen_random_uuid(),
  memo_id     uuid not null references public.cd_memos(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  from_status text,
  to_status   text not null,
  note        text,
  actor_id    uuid default auth.uid(),
  at          timestamptz not null default now()
);
create index if not exists idx_cd_memo_events on public.cd_memo_events (memo_id, at);

create or replace function public.cd_memo_log(m public.cd_memos, p_from text, p_note text)
returns void language sql security definer set search_path = '' as $$
  insert into public.cd_memo_events (memo_id, location_id, from_status, to_status, note)
  values (m.id, m.location_id, p_from, m.status, nullif(btrim(coalesce(p_note, '')), ''));
$$;

-- HR issues a memo to someone in their unit.
create or replace function public.cd_issue_memo(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_staff  uuid := nullif(p->>'staff_id', '')::uuid;
  v_worker uuid := nullif(p->>'worker_id', '')::uuid;
  v_type   text := nullif(p->>'memo_type', '');
  v_subj   text := upper(btrim(coalesce(p->>'subject', '')));
  v_body   text := upper(btrim(coalesce(p->>'body', '')));
  v_inc    date := nullif(p->>'incident_date', '')::date;
  v_on     date := coalesce(nullif(p->>'issued_on', '')::date, public.timeoff_today());
  v_reply  date := nullif(p->>'reply_by', '')::date;
  pp       record;
  m        public.cd_memos;
begin
  if num_nonnulls(v_staff, v_worker) <> 1 then raise exception 'Pick the person' using errcode = '22023'; end if;
  select * into pp from public.timeoff_person(v_staff, v_worker);
  if pp.name is null then raise exception 'That person was not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(pp.location_id, 'create') then
    raise exception 'Only HR in this person''s unit can issue a memo' using errcode = '42501';
  end if;
  if not pp.is_active then raise exception '% is not active', pp.name using errcode = '55000'; end if;
  if v_type is null then raise exception 'Pick what the memo is about' using errcode = '22023'; end if;
  if v_subj = '' then raise exception 'Enter the subject' using errcode = '22023'; end if;
  if v_body = '' then raise exception 'Write the memo' using errcode = '22023'; end if;
  if v_inc is not null and v_inc > v_on then
    raise exception 'The incident cannot be after the memo date' using errcode = '22023';
  end if;
  if v_reply is not null and v_reply < v_on then
    raise exception 'The reply date cannot be before the memo date' using errcode = '22023';
  end if;

  insert into public.cd_memos
    (location_id, staff_id, worker_id, memo_type, subject, body, incident_date, issued_on, reply_by)
  values
    (pp.location_id, v_staff, v_worker, v_type, v_subj, v_body, v_inc, v_on, v_reply)
  returning * into m;
  perform public.cd_memo_log(m, null, null);
  return m.id;
end $$;

-- The person acknowledges it — themself, or HR recording the signed copy.
create or replace function public.cd_acknowledge_memo(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m      public.cd_memos;
  v_self boolean;
begin
  select * into m from public.cd_memos where id = p_id for update;
  if m.id is null then raise exception 'Memo not found' using errcode = '23503'; end if;
  v_self := m.staff_id is not null and m.staff_id = public.timeoff_my_staff_id();
  if not (v_self or public.lc_is_hr(m.location_id, 'edit')) then
    raise exception 'Only the person or HR in this unit can acknowledge it' using errcode = '42501';
  end if;
  if m.status <> 'issued' then raise exception 'Memo % is already %', m.code, m.status using errcode = '55000'; end if;
  update public.cd_memos
     set status = 'acknowledged', ack_at = now(), ack_by = auth.uid(),
         ack_mode = case when v_self then 'self' else 'hr' end,
         ack_note = nullif(upper(btrim(coalesce(p_note, ''))), '')
   where id = m.id
  returning * into m;
  perform public.cd_memo_log(m, 'issued', p_note);
end $$;

-- The person disputes it (at least 10 characters) — or HR records their reply.
create or replace function public.cd_dispute_memo(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m      public.cd_memos;
  v_from text;
  v_self boolean;
begin
  select * into m from public.cd_memos where id = p_id for update;
  if m.id is null then raise exception 'Memo not found' using errcode = '23503'; end if;
  v_self := m.staff_id is not null and m.staff_id = public.timeoff_my_staff_id();
  if not (v_self or public.lc_is_hr(m.location_id, 'edit')) then
    raise exception 'Only the person or HR in this unit can record a dispute' using errcode = '42501';
  end if;
  if m.status not in ('issued', 'acknowledged') then
    raise exception 'Memo % is already %', m.code, m.status using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 10 then
    raise exception 'Give the reason in at least 10 characters' using errcode = '22023';
  end if;
  v_from := m.status;
  update public.cd_memos
     set status = 'disputed', disputed_at = now(), dispute_reason = upper(btrim(p_reason)),
         ack_mode = coalesce(ack_mode, case when v_self then 'self' else 'hr' end)
   where id = m.id
  returning * into m;
  perform public.cd_memo_log(m, v_from, p_reason);
end $$;

-- HR closes it, saying whether it counts toward further action.
create or replace function public.cd_resolve_memo(p_id uuid, p_note text, p_counts boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m      public.cd_memos;
  v_from text;
begin
  select * into m from public.cd_memos where id = p_id for update;
  if m.id is null then raise exception 'Memo not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(m.location_id, 'edit') then
    raise exception 'Only HR in this unit can resolve a memo' using errcode = '42501';
  end if;
  if m.status not in ('issued', 'acknowledged', 'disputed') then
    raise exception 'Memo % is already %', m.code, m.status using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_note, ''))) < 5 then
    raise exception 'Write how it was resolved (at least 5 characters)' using errcode = '22023';
  end if;
  v_from := m.status;
  update public.cd_memos
     set status = 'resolved', resolution_note = upper(btrim(p_note)), counts = coalesce(p_counts, false),
         resolved_by = auth.uid(), resolved_at = now()
   where id = m.id
  returning * into m;
  perform public.cd_memo_log(m, v_from, p_note);
end $$;

-- HR takes back a memo issued in error, before anyone has answered it.
create or replace function public.cd_withdraw_memo(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.cd_memos;
begin
  select * into m from public.cd_memos where id = p_id for update;
  if m.id is null then raise exception 'Memo not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(m.location_id, 'edit') then
    raise exception 'Only HR in this unit can withdraw a memo' using errcode = '42501';
  end if;
  if m.status <> 'issued' then
    raise exception 'Only a memo nobody has answered yet can be withdrawn — resolve it instead' using errcode = '55000';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why' using errcode = '22023'; end if;
  update public.cd_memos set status = 'withdrawn', withdrawn_reason = upper(btrim(p_reason))
   where id = m.id
  returning * into m;
  perform public.cd_memo_log(m, 'issued', p_reason);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Disciplinary cases
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.seq_cd_case;

create table if not exists public.cd_cases (
  id                uuid primary key default gen_random_uuid(),
  code              text,
  location_id       uuid not null references public.locations(id),
  staff_id          uuid references public.staff(id),
  worker_id         uuid references public.workers(id),
  category          text not null
                    check (category in ('misconduct', 'attendance', 'insubordination', 'harassment', 'theft',
                                        'safety', 'negligence', 'other')),
  allegation        text not null check (length(btrim(allegation)) >= 20),
  incident_date     date,
  opened_on         date not null default public.timeoff_today(),
  stage             text not null default 'initiated'
                    check (stage in ('initiated', 'enquiry', 'hearing', 'decision')),
  status            text not null default 'active'
                    check (status in ('active', 'pending_approval', 'closed', 'withdrawn')),
  enquiry_officer   uuid references public.staff(id),
  hearing_date      date,
  -- The proposed decision, then the approved one.
  outcome           text check (outcome is null or outcome in ('warning', 'suspension', 'termination', 'exonerated')),
  decision_note     text,
  suspension_from   date,
  suspension_to     date,
  last_working_day  date,
  proposed_by       uuid,
  proposed_at       timestamptz,
  approved_by       uuid,
  approved_at       timestamptz,
  decision_remark   text,
  exit_id           uuid references public.lc_exits(id),
  withdrawn_reason  text,
  closed_at         timestamptz,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint cd_case_person check (num_nonnulls(staff_id, worker_id) = 1),
  constraint cd_case_suspension check (outcome is distinct from 'suspension'
                                       or (suspension_from is not null and suspension_to >= suspension_from)),
  constraint cd_case_lwd check (outcome is distinct from 'termination' or last_working_day is not null)
);
comment on table public.cd_cases is
  'HR ▸ Conduct & Policies — disciplinary cases; the decision is approved through the engine. Written only by cd_* functions. 0791.';
create index if not exists idx_cd_case_loc on public.cd_cases (location_id, status);
-- One open case per person.
create unique index if not exists uq_cd_case_live_staff on public.cd_cases (staff_id)
  where staff_id is not null and status in ('active', 'pending_approval');
create unique index if not exists uq_cd_case_live_worker on public.cd_cases (worker_id)
  where worker_id is not null and status in ('active', 'pending_approval');
drop trigger if exists trg_cd_case_code on public.cd_cases;
create trigger trg_cd_case_code before insert on public.cd_cases
  for each row execute function public.assign_code('DC', 'public.seq_cd_case');
drop trigger if exists trg_cd_case_updated on public.cd_cases;
create trigger trg_cd_case_updated before update on public.cd_cases
  for each row execute function public.set_updated_at();

do $$ begin
  if not exists (select 1 from pg_constraint where conname = 'cd_memos_case_id_fkey') then
    alter table public.cd_memos
      add constraint cd_memos_case_id_fkey foreign key (case_id) references public.cd_cases(id);
  end if;
end $$;

-- The case diary: notes, stage moves, the decision. Append-only.
create table if not exists public.cd_case_events (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.cd_cases(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  kind        text not null check (kind in ('opened', 'note', 'stage', 'witness', 'proposed', 'approved',
                                            'rejected', 'recalled', 'withdrawn')),
  note        text,
  actor_id    uuid default auth.uid(),
  at          timestamptz not null default now()
);
create index if not exists idx_cd_case_events on public.cd_case_events (case_id, at);

create table if not exists public.cd_case_witnesses (
  id          uuid primary key default gen_random_uuid(),
  case_id     uuid not null references public.cd_cases(id) on delete cascade,
  location_id uuid not null references public.locations(id),
  staff_id    uuid references public.staff(id),
  worker_id   uuid references public.workers(id),
  outside_name text,                       -- someone not on the rolls
  statement   text not null check (btrim(statement) <> ''),
  given_on    date not null default public.timeoff_today(),
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  constraint cd_witness_who check (num_nonnulls(staff_id, worker_id, nullif(btrim(outside_name), '')) = 1)
);
create index if not exists idx_cd_case_witnesses on public.cd_case_witnesses (case_id);

create or replace function public.cd_case_log(p_case uuid, p_loc uuid, p_kind text, p_note text)
returns void language sql security definer set search_path = '' as $$
  insert into public.cd_case_events (case_id, location_id, kind, note)
  values (p_case, p_loc, p_kind, nullif(upper(btrim(coalesce(p_note, ''))), ''));
$$;

-- HR opens a case, optionally gathering the person's open or counted memos.
create or replace function public.cd_open_case(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_staff  uuid := nullif(p->>'staff_id', '')::uuid;
  v_worker uuid := nullif(p->>'worker_id', '')::uuid;
  v_cat    text := nullif(p->>'category', '');
  v_alleg  text := upper(btrim(coalesce(p->>'allegation', '')));
  v_inc    date := nullif(p->>'incident_date', '')::date;
  v_off    uuid := nullif(p->>'enquiry_officer', '')::uuid;
  v_memos  uuid[] := coalesce((select array_agg(e.value::uuid) from jsonb_array_elements_text(coalesce(p->'memo_ids', '[]'::jsonb)) as e(value)), '{}');
  pp       record;
  v_id     uuid;
begin
  if num_nonnulls(v_staff, v_worker) <> 1 then raise exception 'Pick the person' using errcode = '22023'; end if;
  select * into pp from public.timeoff_person(v_staff, v_worker);
  if pp.name is null then raise exception 'That person was not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(pp.location_id, 'create') then
    raise exception 'Only HR in this person''s unit can open a case' using errcode = '42501';
  end if;
  if v_cat is null then raise exception 'Pick the kind of case' using errcode = '22023'; end if;
  if length(v_alleg) < 20 then
    raise exception 'Describe what happened in at least 20 characters' using errcode = '22023';
  end if;
  if v_inc is not null and v_inc > public.timeoff_today() then
    raise exception 'The incident cannot be in the future' using errcode = '22023';
  end if;
  if v_off is not null and v_off = v_staff then
    raise exception 'The person cannot hold the enquiry into their own case' using errcode = '22023';
  end if;
  if exists (select 1 from public.cd_cases c
              where c.status in ('active', 'pending_approval')
                and coalesce(c.staff_id, c.worker_id) = coalesce(v_staff, v_worker)) then
    raise exception '% already has an open case', pp.name using errcode = '23505';
  end if;

  insert into public.cd_cases (location_id, staff_id, worker_id, category, allegation, incident_date, enquiry_officer)
  values (pp.location_id, v_staff, v_worker, v_cat, v_alleg, v_inc, v_off)
  returning id into v_id;

  if array_length(v_memos, 1) > 0 then
    if exists (select 1 from public.cd_memos m
                where m.id = any(v_memos)
                  and (coalesce(m.staff_id, m.worker_id) <> coalesce(v_staff, v_worker)
                       or m.status = 'withdrawn' or m.case_id is not null)) then
      raise exception 'Only this person''s own memos, not withdrawn and not on another case, can be attached'
        using errcode = '22023';
    end if;
    update public.cd_memos set case_id = v_id where id = any(v_memos);
  end if;
  perform public.cd_case_log(v_id, pp.location_id, 'opened', null);
  return v_id;
end $$;

-- HR edits the details while the case is active.
create or replace function public.cd_update_case(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c       public.cd_cases;
  v_alleg text := upper(btrim(coalesce(p->>'allegation', '')));
  v_off   uuid := nullif(p->>'enquiry_officer', '')::uuid;
begin
  select * into c from public.cd_cases where id = p_id for update;
  if c.id is null then raise exception 'Case not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(c.location_id, 'edit') then
    raise exception 'Only HR in this unit can change a case' using errcode = '42501';
  end if;
  if c.status <> 'active' then raise exception 'Case % is %', c.code, replace(c.status, '_', ' ') using errcode = '55000'; end if;
  if length(v_alleg) < 20 then
    raise exception 'Describe what happened in at least 20 characters' using errcode = '22023';
  end if;
  if v_off is not null and v_off = c.staff_id then
    raise exception 'The person cannot hold the enquiry into their own case' using errcode = '22023';
  end if;
  update public.cd_cases
     set category = coalesce(nullif(p->>'category', ''), category),
         allegation = v_alleg,
         incident_date = nullif(p->>'incident_date', '')::date,
         enquiry_officer = v_off,
         hearing_date = nullif(p->>'hearing_date', '')::date
   where id = c.id;
end $$;

-- One stage forward: initiated → enquiry → hearing → decision.
create or replace function public.cd_advance_case(p_id uuid, p_note text)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c      public.cd_cases;
  v_next text;
begin
  select * into c from public.cd_cases where id = p_id for update;
  if c.id is null then raise exception 'Case not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(c.location_id, 'edit') then
    raise exception 'Only HR in this unit can move a case' using errcode = '42501';
  end if;
  if c.status <> 'active' then raise exception 'Case % is %', c.code, replace(c.status, '_', ' ') using errcode = '55000'; end if;
  v_next := case c.stage when 'initiated' then 'enquiry' when 'enquiry' then 'hearing' when 'hearing' then 'decision' end;
  if v_next is null then
    raise exception 'The case is at the decision — propose the decision for approval' using errcode = '55000';
  end if;
  update public.cd_cases set stage = v_next where id = c.id;
  perform public.cd_case_log(c.id, c.location_id, 'stage',
                             'MOVED TO ' || upper(v_next) || coalesce(' — ' || nullif(btrim(coalesce(p_note, '')), ''), ''));
  return v_next;
end $$;

-- A diary note.
create or replace function public.cd_add_case_note(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.cd_cases;
begin
  select * into c from public.cd_cases where id = p_id;
  if c.id is null then raise exception 'Case not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(c.location_id, 'edit') then
    raise exception 'Only HR in this unit can write in a case' using errcode = '42501';
  end if;
  if c.status in ('closed', 'withdrawn') then raise exception 'Case % is %', c.code, c.status using errcode = '55000'; end if;
  if btrim(coalesce(p_note, '')) = '' then raise exception 'Write the note' using errcode = '22023'; end if;
  perform public.cd_case_log(c.id, c.location_id, 'note', p_note);
end $$;

-- A witness statement — someone on the rolls, or a name from outside.
create or replace function public.cd_add_witness(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c        public.cd_cases;
  v_staff  uuid := nullif(p->>'staff_id', '')::uuid;
  v_worker uuid := nullif(p->>'worker_id', '')::uuid;
  v_out    text := nullif(upper(btrim(coalesce(p->>'outside_name', ''))), '');
  v_stmt   text := upper(btrim(coalesce(p->>'statement', '')));
  v_on     date := coalesce(nullif(p->>'given_on', '')::date, public.timeoff_today());
  v_who    text;
  v_id     uuid;
begin
  select * into c from public.cd_cases where id = p_id;
  if c.id is null then raise exception 'Case not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(c.location_id, 'edit') then
    raise exception 'Only HR in this unit can record a statement' using errcode = '42501';
  end if;
  if c.status <> 'active' then raise exception 'Case % is %', c.code, replace(c.status, '_', ' ') using errcode = '55000'; end if;
  if num_nonnulls(v_staff, v_worker, v_out) <> 1 then raise exception 'Pick the witness' using errcode = '22023'; end if;
  if coalesce(v_staff, v_worker) is not distinct from coalesce(c.staff_id, c.worker_id) then
    raise exception 'The person cannot be a witness in their own case' using errcode = '22023';
  end if;
  if v_stmt = '' then raise exception 'Write the statement' using errcode = '22023'; end if;
  insert into public.cd_case_witnesses (case_id, location_id, staff_id, worker_id, outside_name, statement, given_on)
  values (c.id, c.location_id, v_staff, v_worker, v_out, v_stmt, v_on)
  returning id into v_id;
  select coalesce(v_out, (select x.name from public.timeoff_person(v_staff, v_worker) x)) into v_who;
  perform public.cd_case_log(c.id, c.location_id, 'witness', 'STATEMENT FROM ' || coalesce(v_who, '—'));
  return v_id;
end $$;

-- HR proposes the decision; it goes to the approver.
create or replace function public.cd_propose_decision(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c       public.cd_cases;
  pp      record;
  v_out   text := nullif(p->>'outcome', '');
  v_note  text := upper(btrim(coalesce(p->>'decision_note', '')));
  v_from  date := nullif(p->>'suspension_from', '')::date;
  v_to    date := nullif(p->>'suspension_to', '')::date;
  v_lwd   date := nullif(p->>'last_working_day', '')::date;
begin
  select * into c from public.cd_cases where id = p_id for update;
  if c.id is null then raise exception 'Case not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(c.location_id, 'edit') then
    raise exception 'Only HR in this unit can propose the decision' using errcode = '42501';
  end if;
  if c.status <> 'active' then raise exception 'Case % is %', c.code, replace(c.status, '_', ' ') using errcode = '55000'; end if;
  if c.stage <> 'decision' then
    raise exception 'Move the case to the decision stage first' using errcode = '55000';
  end if;
  if v_out is null or v_out not in ('warning', 'suspension', 'termination', 'exonerated') then
    raise exception 'Pick the decision' using errcode = '22023';
  end if;
  if length(v_note) < 10 then
    raise exception 'Give the reasons for the decision in at least 10 characters' using errcode = '22023';
  end if;
  if v_out = 'suspension' and (v_from is null or v_to is null or v_to < v_from) then
    raise exception 'A suspension needs its from and to dates' using errcode = '22023';
  end if;
  if v_out = 'termination' and v_lwd is null then
    raise exception 'A termination needs the last working day' using errcode = '22023';
  end if;
  select * into pp from public.timeoff_person(c.staff_id, c.worker_id);

  update public.cd_cases
     set status = 'pending_approval', outcome = v_out, decision_note = v_note,
         suspension_from = case when v_out = 'suspension' then v_from end,
         suspension_to   = case when v_out = 'suspension' then v_to end,
         last_working_day = case when v_out = 'termination' then v_lwd end,
         proposed_by = auth.uid(), proposed_at = now(), decision_remark = null
   where id = c.id;
  perform public.cd_case_log(c.id, c.location_id, 'proposed', upper(v_out) || ' — ' || v_note);

  perform public.approval_start_run(
    'cd_case_decision', 'cd_cases', c.id,
    jsonb_build_object('person_name', pp.name, 'person_code', pp.code, 'case', c.code,
                       'category', c.category, 'outcome', v_out,
                       'suspension_from', v_from, 'suspension_to', v_to, 'last_working_day', v_lwd),
    jsonb_build_object('location_id', c.location_id), null, auth.uid());
end $$;

-- HR takes the proposal back to change it.
create or replace function public.cd_recall_decision(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c     public.cd_cases;
  v_run public.approval_runs;
begin
  select * into c from public.cd_cases where id = p_id for update;
  if c.id is null then raise exception 'Case not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(c.location_id, 'edit') then
    raise exception 'Only HR in this unit can recall the decision' using errcode = '42501';
  end if;
  if c.status <> 'pending_approval' then raise exception 'Nothing is waiting for approval on %', c.code using errcode = '55000'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why' using errcode = '22023'; end if;
  select * into v_run from public.approval_runs
   where subject_table = 'cd_cases' and subject_id = c.id and status = 'in_progress'
   order by started_at desc limit 1 for update;
  if v_run.id is null then raise exception 'It has no open approval — reload' using errcode = '55000'; end if;
  insert into public.approval_run_events (run_id, step_order, action, actor_id, comment)
  values (v_run.id, v_run.current_step, 'cancel', auth.uid(), upper(btrim(p_reason)));
  -- the terminal trigger runs cd_case_apply_decision('cancelled')
  update public.approval_runs
     set status = 'cancelled', completed_at = now(), lock_version = lock_version + 1
   where id = v_run.id;
end $$;

-- HR drops a case that is not going ahead.
create or replace function public.cd_withdraw_case(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.cd_cases;
begin
  select * into c from public.cd_cases where id = p_id for update;
  if c.id is null then raise exception 'Case not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(c.location_id, 'edit') then
    raise exception 'Only HR in this unit can withdraw a case' using errcode = '42501';
  end if;
  if c.status <> 'active' then
    raise exception 'Only an active case can be withdrawn — recall a decision waiting for approval first' using errcode = '55000';
  end if;
  if length(btrim(coalesce(p_reason, ''))) < 5 then raise exception 'Say why (at least 5 characters)' using errcode = '22023'; end if;
  update public.cd_cases
     set status = 'withdrawn', withdrawn_reason = upper(btrim(p_reason)), closed_at = now()
   where id = c.id;
  -- Its memos are free to go on another case.
  update public.cd_memos set case_id = null where case_id = c.id;
  perform public.cd_case_log(c.id, c.location_id, 'withdrawn', p_reason);
end $$;

-- The approver's decision. Approved → the case closes with that outcome; an
-- approved termination opens the person's exit on Team Lifecycle ▸ Exits, already
-- decided (this approval WAS the decision), with the case as its grounds.
-- Rejected or recalled → back to the decision stage for HR to propose again.
create or replace function public.cd_case_apply_decision(
  p_id uuid, p_run_status text, p_actor uuid, p_remark text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c        public.cd_cases;
  v_remark text := nullif(upper(btrim(coalesce(p_remark, ''))), '');
  v_exit   uuid;
  v_notice date;
begin
  select * into c from public.cd_cases where id = p_id for update;
  if c.id is null or c.status <> 'pending_approval' then
    raise exception 'Case % is not awaiting a decision — reload', p_id using errcode = '55000';
  end if;

  if p_run_status = 'completed' then
    if c.outcome = 'termination' then
      select e.id into v_exit from public.lc_exits e
       where e.status in ('pending_approval', 'open')
         and coalesce(e.staff_id, e.worker_id) = coalesce(c.staff_id, c.worker_id)
       limit 1;
      if v_exit is null then
        v_notice := least((p_at at time zone 'Asia/Kolkata')::date, c.last_working_day);
        insert into public.lc_exits
          (staff_id, worker_id, location_id, separation_type, notice_date, last_working_day, reason, grounds,
           status, decided_by, decided_at, decision_remark)
        values
          (c.staff_id, c.worker_id, c.location_id, 'termination', v_notice, c.last_working_day,
           'DISCIPLINARY CASE ' || c.code,
           c.allegation || ' — DECISION: ' || c.decision_note,
           'open', p_actor, p_at, v_remark)
        returning id into v_exit;
        perform public.lc_seed_exit_steps(v_exit);
      end if;
    end if;
    update public.cd_cases
       set status = 'closed', approved_by = p_actor, approved_at = p_at, decision_remark = v_remark,
           exit_id = coalesce(v_exit, exit_id), closed_at = p_at
     where id = c.id;
    perform public.cd_case_log(c.id, c.location_id, 'approved',
                               upper(c.outcome) || coalesce(' — ' || v_remark, ''));
  else
    update public.cd_cases
       set status = 'active', decision_remark = v_remark
     where id = c.id;
    perform public.cd_case_log(c.id, c.location_id,
                               case when p_run_status = 'rejected' then 'rejected' else 'recalled' end, v_remark);
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Policies — a library of written policies, versioned, acknowledged
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.seq_cd_policy;

-- location_id NULL = every unit (a company-wide policy).
create table if not exists public.cd_policies (
  id           uuid primary key default gen_random_uuid(),
  code         text,
  location_id  uuid references public.locations(id),
  title        text not null check (btrim(title) <> ''),
  category     text not null default 'conduct'
               check (category in ('conduct', 'attendance', 'leave', 'safety', 'it', 'grievance', 'pay', 'other')),
  applies_to   text not null default 'all' check (applies_to in ('all', 'staff', 'worker')),
  requires_ack boolean not null default true,
  retired      boolean not null default false,
  retired_at   timestamptz,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
comment on table public.cd_policies is
  'HR ▸ Conduct & Policies — the policy library. location_id null = every unit. 0791.';
drop trigger if exists trg_cd_policy_code on public.cd_policies;
create trigger trg_cd_policy_code before insert on public.cd_policies
  for each row execute function public.assign_code('POL', 'public.seq_cd_policy');
drop trigger if exists trg_cd_policy_updated on public.cd_policies;
create trigger trg_cd_policy_updated before update on public.cd_policies
  for each row execute function public.set_updated_at();

create or replace function public.cd_policy_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.title := upper(btrim(new.title));
  if tg_op = 'UPDATE' then
    if new.location_id is distinct from old.location_id
       and exists (select 1 from public.cd_policy_versions v where v.policy_id = old.id and v.status <> 'draft') then
      raise exception 'A published policy keeps the units it was published to' using errcode = '55000';
    end if;
    if new.retired and not old.retired then new.retired_at := now(); end if;
    if not new.retired then new.retired_at := null; end if;
  end if;
  return new;
end $$;

-- HR may edit a policy for their unit; a company-wide one needs the right in
-- general (it is read in every unit).
create or replace function public.cd_policy_hr(p_location uuid, p_action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select case when p_location is null then public.has_permission('hr_payroll', p_action)
              else public.lc_is_hr(p_location, p_action) end;
$$;

create table if not exists public.cd_policy_versions (
  id              uuid primary key default gen_random_uuid(),
  policy_id       uuid not null references public.cd_policies(id) on delete cascade,
  version_no      int not null,
  body            text,
  file_path       text,
  file_name       text,
  effective_from  date not null default public.timeoff_today(),
  change_note     text,
  status          text not null default 'draft' check (status in ('draft', 'published', 'superseded')),
  published_at    timestamptz,
  published_by    uuid,
  superseded_at   timestamptz,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (policy_id, version_no)
);
comment on table public.cd_policy_versions is
  'HR ▸ Conduct & Policies — each version of a policy; a published version is never edited, a new one supersedes it. 0791.';
create unique index if not exists uq_cd_policy_one_draft on public.cd_policy_versions (policy_id) where status = 'draft';
create unique index if not exists uq_cd_policy_one_live  on public.cd_policy_versions (policy_id) where status = 'published';
drop trigger if exists trg_cd_policy_version_updated on public.cd_policy_versions;
create trigger trg_cd_policy_version_updated before update on public.cd_policy_versions
  for each row execute function public.set_updated_at();

-- The policy guard reads the versions, so its trigger is made after the table.
drop trigger if exists trg_cd_policy_guard on public.cd_policies;
create trigger trg_cd_policy_guard before insert or update on public.cd_policies
  for each row execute function public.cd_policy_guard();

-- A draft is the only version anyone edits; it is numbered on insert;
-- publishing goes through cd_publish_version.
create or replace function public.cd_policy_version_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.published_at := null; new.published_by := null; new.superseded_at := null;
    select coalesce(max(v.version_no), 0) + 1 into new.version_no
      from public.cd_policy_versions v where v.policy_id = new.policy_id;
    new.change_note := nullif(upper(btrim(coalesce(new.change_note, ''))), '');
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'A published version is kept — retire the policy instead' using errcode = '55000';
    end if;
    return old;
  end if;
  if new.policy_id <> old.policy_id or new.version_no <> old.version_no then
    raise exception 'A version stays with its policy and number' using errcode = '55000';
  end if;
  if old.status <> 'draft' then
    -- Published → superseded is the only change, and only by cd_publish_version.
    if not (old.status = 'published' and new.status = 'superseded'
            and row(new.body, new.file_path, new.file_name, new.effective_from, new.change_note)
                is not distinct from row(old.body, old.file_path, old.file_name, old.effective_from, old.change_note)) then
      raise exception 'Version % is published and cannot be changed — start a new version', old.version_no
        using errcode = '55000';
    end if;
    return new;
  end if;
  if new.status <> 'draft' and current_setting('raagam.cd_publishing', true) is distinct from 'on' then
    raise exception 'Publish through Publish, not by editing' using errcode = '55000';
  end if;
  new.change_note := nullif(upper(btrim(coalesce(new.change_note, ''))), '');
  return new;
end $$;
drop trigger if exists trg_cd_policy_version_guard on public.cd_policy_versions;
create trigger trg_cd_policy_version_guard before insert or update or delete on public.cd_policy_versions
  for each row execute function public.cd_policy_version_guard();

create table if not exists public.cd_policy_acks (
  id           uuid primary key default gen_random_uuid(),
  version_id   uuid not null references public.cd_policy_versions(id) on delete cascade,
  location_id  uuid not null references public.locations(id),   -- the person's unit
  staff_id     uuid references public.staff(id),
  worker_id    uuid references public.workers(id),
  acked_at     timestamptz not null default now(),
  mode         text not null check (mode in ('self', 'hr')),
  recorded_by  uuid default auth.uid(),
  constraint cd_ack_person check (num_nonnulls(staff_id, worker_id) = 1)
);
comment on table public.cd_policy_acks is
  'HR ▸ Conduct & Policies — who has read which published version (themself, or HR from a signed sheet). Written only by cd_* functions. 0791.';
create unique index if not exists uq_cd_ack_staff  on public.cd_policy_acks (version_id, staff_id)  where staff_id is not null;
create unique index if not exists uq_cd_ack_worker on public.cd_policy_acks (version_id, worker_id) where worker_id is not null;

-- Publish the draft: it becomes the live version, the old live one is
-- superseded, and everyone's acknowledgement starts again for the new one.
create or replace function public.cd_publish_version(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v  public.cd_policy_versions;
  pl public.cd_policies;
begin
  select * into v from public.cd_policy_versions where id = p_version for update;
  if v.id is null then raise exception 'Version not found' using errcode = '23503'; end if;
  select * into pl from public.cd_policies where id = v.policy_id for update;
  if not public.cd_policy_hr(pl.location_id, 'edit') then
    raise exception 'Only HR can publish this policy' using errcode = '42501';
  end if;
  if pl.retired then raise exception 'Policy % is retired' , pl.code using errcode = '55000'; end if;
  if v.status <> 'draft' then raise exception 'Version % is already published', v.version_no using errcode = '55000'; end if;
  if btrim(coalesce(v.body, '')) = '' and v.file_path is null then
    raise exception 'Write the policy or attach the document before publishing' using errcode = '22023';
  end if;
  if v.version_no > 1 and v.change_note is null then
    raise exception 'Say what changed in this version' using errcode = '22023';
  end if;
  update public.cd_policy_versions set status = 'superseded', superseded_at = now()
   where policy_id = v.policy_id and status = 'published';
  perform set_config('raagam.cd_publishing', 'on', true);
  update public.cd_policy_versions set status = 'published', published_at = now(), published_by = auth.uid()
   where id = v.id;
  perform set_config('raagam.cd_publishing', 'off', true);
end $$;

-- Does this published version reach this person (unit and kind)?
create or replace function public.cd_version_reaches(p_version uuid, p_staff uuid, p_worker uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.cd_policy_versions v
      join public.cd_policies pl on pl.id = v.policy_id
      join public.timeoff_person(p_staff, p_worker) pp on true
     where v.id = p_version and v.status = 'published' and not pl.retired
       and (pl.location_id is null or pl.location_id = pp.location_id)
       and (pl.applies_to = 'all' or (pl.applies_to = 'staff') = (p_staff is not null)));
$$;

-- For the RLS on cd_policies: does a live version of this policy reach the
-- signed-in staff member? Has the policy ever been published? (Definer, so the
-- policies and versions tables never read each other's RLS in a loop.)
create or replace function public.cd_policy_live_for_me(p_policy uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cd_policy_versions v
                  where v.policy_id = p_policy and v.status = 'published'
                    and public.timeoff_my_staff_id() is not null
                    and public.cd_version_reaches(v.id, public.timeoff_my_staff_id(), null));
$$;
create or replace function public.cd_policy_ever_published(p_policy uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cd_policy_versions v where v.policy_id = p_policy and v.status <> 'draft');
$$;

-- "I have read this" — the signed-in staff member, for themself.
create or replace function public.cd_acknowledge_policy(p_version uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_me uuid := public.timeoff_my_staff_id();
begin
  if v_me is null then raise exception 'Your login is not linked to a staff record' using errcode = '42501'; end if;
  if not public.cd_version_reaches(p_version, v_me, null) then
    raise exception 'This policy is not one for you, or it is no longer the live version' using errcode = '55000';
  end if;
  insert into public.cd_policy_acks (version_id, location_id, staff_id, mode)
  select p_version, s.location_id, s.id, 'self' from public.staff s where s.id = v_me
  on conflict do nothing;
end $$;

-- HR records acknowledgements from a signed sheet. Returns how many were new.
create or replace function public.cd_record_acks(p_version uuid, p_staff uuid[], p_workers uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare
  v    public.cd_policy_versions;
  pl   public.cd_policies;
  v_n  int := 0;
  v_k  int;
begin
  select * into v from public.cd_policy_versions where id = p_version;
  if v.id is null then raise exception 'Version not found' using errcode = '23503'; end if;
  select * into pl from public.cd_policies where id = v.policy_id;
  if v.status <> 'published' or pl.retired then
    raise exception 'Only the live version of a policy in use is acknowledged' using errcode = '55000';
  end if;
  -- HR records for people in the unit they are working in.
  insert into public.cd_policy_acks (version_id, location_id, staff_id, mode)
  select v.id, s.location_id, s.id, 'hr' from public.staff s
   where s.id = any(coalesce(p_staff, '{}')) and s.is_active
     and public.lc_is_hr(s.location_id, 'edit') and public.cd_version_reaches(v.id, s.id, null)
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  insert into public.cd_policy_acks (version_id, location_id, worker_id, mode)
  select v.id, w.location_id, w.id, 'hr' from public.workers w
   where w.id = any(coalesce(p_workers, '{}')) and w.is_active
     and public.lc_is_hr(w.location_id, 'edit') and public.cd_version_reaches(v.id, null, w.id)
  on conflict do nothing;
  get diagnostics v_k = row_count; v_n := v_n + v_k;
  return v_n;
end $$;

-- HR takes back an acknowledgement entered by mistake (only one HR entered).
create or replace function public.cd_remove_ack(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  a public.cd_policy_acks;
begin
  select * into a from public.cd_policy_acks where id = p_id for update;
  if a.id is null then raise exception 'Not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(a.location_id, 'edit') then
    raise exception 'Only HR in this person''s unit can remove it' using errcode = '42501';
  end if;
  if a.mode <> 'hr' then raise exception 'The person acknowledged it themself — it stays' using errcode = '55000'; end if;
  delete from public.cd_policy_acks where id = a.id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Policy documents — private bucket
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-policy-docs', 'hr-policy-docs', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;

-- Key shape: <policy_id>/<uuid>.pdf. Writing needs HR rights over the policy.
create or replace function public.cd_doc_key_ok(p_name text, p_action text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  parts   text[] := string_to_array(p_name, '/');
  pl      public.cd_policies;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if coalesce(array_length(parts, 1), 0) <> 2 or parts[1] !~* uuid_re then return false; end if;
  select * into pl from public.cd_policies where id = parts[1]::uuid;
  if pl.id is null then return false; end if;
  return public.cd_policy_hr(pl.location_id, p_action);
end $$;

-- Whoever can read the version the file belongs to.
create or replace function public.cd_doc_readable(p_name text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.cd_doc_key_ok(p_name, 'view')
      or exists (select 1 from public.cd_policy_versions v
                  where v.file_path = p_name and v.status = 'published'
                    and public.timeoff_my_staff_id() is not null
                    and public.cd_version_reaches(v.id, public.timeoff_my_staff_id(), null));
$$;

drop policy if exists hr_policy_docs_insert on storage.objects;
create policy hr_policy_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-policy-docs' and public.cd_doc_key_ok(name, 'edit'));
drop policy if exists hr_policy_docs_read on storage.objects;
create policy hr_policy_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'hr-policy-docs' and public.cd_doc_readable(name));
-- Only a file no published version points at.
drop policy if exists hr_policy_docs_delete on storage.objects;
create policy hr_policy_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hr-policy-docs' and public.cd_doc_key_ok(name, 'edit')
         and not exists (select 1 from public.cd_policy_versions v
                          where v.file_path = storage.objects.name and v.status <> 'draft'));

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Engine wiring — terminal branch + default flow
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_def    text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
  v_anchor text := E'    raise exception\n        ''approval_apply_terminal: no terminal callback';
  v_branch text := E'    if new.subject_table = ''cd_cases'' then\n'
                || E'        perform public.cd_case_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark, coalesce(new.completed_at, now()));\n'
                || E'        return new;\n'
                || E'    end if;\n\n';
begin
  if position('''cd_cases''' in v_def) > 0 then
    return;  -- already there (a re-run)
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0791: approval_apply_terminal''s final refusal was not found — add the cd branch by hand.';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'cd_case_decision', 'Disciplinary Decision — default',
       'Catch-all. Every disciplinary decision HR proposes goes to the Managing Director or an HR Manager. An approved termination opens the exit on Team Lifecycle ▸ Exits.',
       '{}'::jsonb,
       coalesce((select f.steps from public.approval_flows f
                  where f.workflow_key = 'hr_fine' and f.flow_name = 'HR Fine — default' limit 1),
                '[{"step_order":1,"step_type":"final","step_label":"MD / HR Manager","approver_resolver":"md_or_hr_manager"}]'::jsonb),
       900, true
 where not exists (select 1 from public.approval_flows x where x.workflow_key = 'cd_case_decision');

-- ════════════════════════════════════════════════════════════════════════════
-- 6. RLS + grants
-- ════════════════════════════════════════════════════════════════════════════

alter table public.cd_memos            enable row level security;
alter table public.cd_memo_events      enable row level security;
alter table public.cd_cases            enable row level security;
alter table public.cd_case_events      enable row level security;
alter table public.cd_case_witnesses   enable row level security;
alter table public.cd_policies         enable row level security;
alter table public.cd_policy_versions  enable row level security;
alter table public.cd_policy_acks      enable row level security;

-- Memos: HR in the unit; the person their own.
drop policy if exists cd_memo_read on public.cd_memos;
create policy cd_memo_read on public.cd_memos for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or (staff_id is not null and staff_id = public.timeoff_my_staff_id()));
drop policy if exists cd_memo_event_read on public.cd_memo_events;
create policy cd_memo_event_read on public.cd_memo_events for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or exists (select 1 from public.cd_memos m
                     where m.id = memo_id and m.staff_id is not null and m.staff_id = public.timeoff_my_staff_id()));

-- Cases, their diary and statements: HR in the unit only. The person hears
-- of it by memo and letter; witness statements are not theirs to read here.
drop policy if exists cd_case_read on public.cd_cases;
create policy cd_case_read on public.cd_cases for select
  using (public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id));
drop policy if exists cd_case_event_read on public.cd_case_events;
create policy cd_case_event_read on public.cd_case_events for select
  using (public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id));
drop policy if exists cd_witness_read on public.cd_case_witnesses;
create policy cd_witness_read on public.cd_case_witnesses for select
  using (public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id));

-- Policies: HR reads every policy for their unit and the company-wide ones; a
-- staff member reads the policies in use that reach them.
drop policy if exists cd_policy_read on public.cd_policies;
drop policy if exists cd_policy_ins  on public.cd_policies;
drop policy if exists cd_policy_upd  on public.cd_policies;
drop policy if exists cd_policy_del  on public.cd_policies;
create policy cd_policy_read on public.cd_policies for select
  using ((public.has_permission('hr_payroll', 'view') and (location_id is null or public.is_current_location(location_id)))
         or public.cd_policy_live_for_me(id));
create policy cd_policy_ins on public.cd_policies for insert
  with check (public.cd_policy_hr(location_id, 'create'));
create policy cd_policy_upd on public.cd_policies for update
  using (public.cd_policy_hr(location_id, 'edit'))
  with check (public.cd_policy_hr(location_id, 'edit'));
-- Only a policy never published (its draft goes with it).
create policy cd_policy_del on public.cd_policies for delete
  using (public.cd_policy_hr(location_id, 'delete')
         and not public.cd_policy_ever_published(id));

drop policy if exists cd_version_read on public.cd_policy_versions;
drop policy if exists cd_version_ins  on public.cd_policy_versions;
drop policy if exists cd_version_upd  on public.cd_policy_versions;
drop policy if exists cd_version_del  on public.cd_policy_versions;
create policy cd_version_read on public.cd_policy_versions for select
  using (exists (select 1 from public.cd_policies pl
                  where pl.id = policy_id and public.has_permission('hr_payroll', 'view')
                    and (pl.location_id is null or public.is_current_location(pl.location_id)))
         or (status = 'published' and public.timeoff_my_staff_id() is not null
             and public.cd_version_reaches(id, public.timeoff_my_staff_id(), null)));
create policy cd_version_ins on public.cd_policy_versions for insert
  with check (exists (select 1 from public.cd_policies pl where pl.id = policy_id and public.cd_policy_hr(pl.location_id, 'edit')));
create policy cd_version_upd on public.cd_policy_versions for update
  using (exists (select 1 from public.cd_policies pl where pl.id = policy_id and public.cd_policy_hr(pl.location_id, 'edit')))
  with check (exists (select 1 from public.cd_policies pl where pl.id = policy_id and public.cd_policy_hr(pl.location_id, 'edit')));
create policy cd_version_del on public.cd_policy_versions for delete
  using (status = 'draft'
         and exists (select 1 from public.cd_policies pl where pl.id = policy_id and public.cd_policy_hr(pl.location_id, 'edit')));

-- Acknowledgements: HR for the people of their unit; a person their own.
drop policy if exists cd_ack_read on public.cd_policy_acks;
create policy cd_ack_read on public.cd_policy_acks for select
  using ((staff_id is not null and staff_id = public.timeoff_my_staff_id())
         or (public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id)));

revoke insert, update, delete on public.cd_memos          from anon, authenticated;
revoke insert, update, delete on public.cd_memo_events    from anon, authenticated;
revoke insert, update, delete on public.cd_cases          from anon, authenticated;
revoke insert, update, delete on public.cd_case_events    from anon, authenticated;
revoke insert, update, delete on public.cd_case_witnesses from anon, authenticated;
revoke insert, update, delete on public.cd_policy_acks    from anon, authenticated;

revoke all on function public.cd_memo_log(public.cd_memos, text, text)                      from public, anon, authenticated;
revoke all on function public.cd_issue_memo(jsonb)                                          from public, anon;
revoke all on function public.cd_acknowledge_memo(uuid, text)                               from public, anon;
revoke all on function public.cd_dispute_memo(uuid, text)                                   from public, anon;
revoke all on function public.cd_resolve_memo(uuid, text, boolean)                          from public, anon;
revoke all on function public.cd_withdraw_memo(uuid, text)                                  from public, anon;
revoke all on function public.cd_case_log(uuid, uuid, text, text)                           from public, anon, authenticated;
revoke all on function public.cd_open_case(jsonb)                                           from public, anon;
revoke all on function public.cd_update_case(uuid, jsonb)                                   from public, anon;
revoke all on function public.cd_advance_case(uuid, text)                                   from public, anon;
revoke all on function public.cd_add_case_note(uuid, text)                                  from public, anon;
revoke all on function public.cd_add_witness(uuid, jsonb)                                   from public, anon;
revoke all on function public.cd_propose_decision(uuid, jsonb)                              from public, anon;
revoke all on function public.cd_recall_decision(uuid, text)                                from public, anon;
revoke all on function public.cd_withdraw_case(uuid, text)                                  from public, anon;
revoke all on function public.cd_case_apply_decision(uuid, text, uuid, text, timestamptz)   from public, anon, authenticated;
revoke all on function public.cd_policy_guard()                                             from public, anon, authenticated;
revoke all on function public.cd_policy_hr(uuid, text)                                      from public, anon;
revoke all on function public.cd_policy_version_guard()                                     from public, anon, authenticated;
revoke all on function public.cd_publish_version(uuid)                                      from public, anon;
revoke all on function public.cd_version_reaches(uuid, uuid, uuid)                          from public, anon;
revoke all on function public.cd_policy_live_for_me(uuid)                               from public, anon;
revoke all on function public.cd_policy_ever_published(uuid)                            from public, anon;
revoke all on function public.cd_acknowledge_policy(uuid)                                   from public, anon;
revoke all on function public.cd_record_acks(uuid, uuid[], uuid[])                          from public, anon;
revoke all on function public.cd_remove_ack(uuid)                                           from public, anon;
revoke all on function public.cd_doc_key_ok(text, text)                                     from public, anon;
revoke all on function public.cd_doc_readable(text)                                         from public, anon;
revoke all on function public.approval_apply_terminal()                                     from public, anon;

-- cd_policy_hr / cd_version_reaches / cd_doc_* are read by RLS and storage
-- policies, which run as the caller.
grant execute on function public.cd_policy_hr(uuid, text)                 to authenticated;
grant execute on function public.cd_version_reaches(uuid, uuid, uuid)     to authenticated;
grant execute on function public.cd_policy_live_for_me(uuid)              to authenticated;
grant execute on function public.cd_policy_ever_published(uuid)           to authenticated;
grant execute on function public.cd_doc_key_ok(text, text)                to authenticated;
grant execute on function public.cd_doc_readable(text)                    to authenticated;
grant execute on function public.cd_issue_memo(jsonb)                     to authenticated;
grant execute on function public.cd_acknowledge_memo(uuid, text)          to authenticated;
grant execute on function public.cd_dispute_memo(uuid, text)              to authenticated;
grant execute on function public.cd_resolve_memo(uuid, text, boolean)     to authenticated;
grant execute on function public.cd_withdraw_memo(uuid, text)             to authenticated;
grant execute on function public.cd_open_case(jsonb)                      to authenticated;
grant execute on function public.cd_update_case(uuid, jsonb)              to authenticated;
grant execute on function public.cd_advance_case(uuid, text)              to authenticated;
grant execute on function public.cd_add_case_note(uuid, text)             to authenticated;
grant execute on function public.cd_add_witness(uuid, jsonb)              to authenticated;
grant execute on function public.cd_propose_decision(uuid, jsonb)         to authenticated;
grant execute on function public.cd_recall_decision(uuid, text)           to authenticated;
grant execute on function public.cd_withdraw_case(uuid, text)             to authenticated;
grant execute on function public.cd_publish_version(uuid)                 to authenticated;
grant execute on function public.cd_acknowledge_policy(uuid)              to authenticated;
grant execute on function public.cd_record_acks(uuid, uuid[], uuid[])     to authenticated;
grant execute on function public.cd_remove_ack(uuid)                      to authenticated;

notify pgrst, 'reload schema';
