-- 0767 — HR ▸ RECRUITMENT (MyJKKN HR port, phase 3 — client 2026-10-29)
--
-- Source: MyJKKN docs/HR-MODULE-SPEC.md §7, rebuilt on Raagam's units,
-- departments, designations, people and approval engine:
--
--   MyJKKN                                  Raagam (this file)
--   ─────────────────────────────────────── ──────────────────────────────────
--   hr_recruitment_jobs                     rc_jobs (job openings, per unit)
--   hr_job_applications + hr_recruitment_   rc_candidates — ONE record from
--     candidates (two records, linked by      application to joining; MyJKKN's
--     promoted_candidate_id / jsonb)          "promote" is the Shortlist step
--   approval_chain jsonb on the candidate   the approval engine (workflow
--   + fn_decide_recruitment_candidate         rc_hire): Admin ▸ Approval Flows
--   hr_recruitment_candidate_packages       the offer (designation, salary,
--     (separate package approval)             joining date) IS what the hire
--                                             approval approves; a counter-offer
--                                             is a revised offer, approved again
--   hr_recruitment_interviews               rc_interviews (reschedule keeps the
--                                             old row, as MyJKKN did)
--   hr_recruitment_scorecards               rc_scorecards — one per panel member
--   comments / job notes                    rc_candidate_events — every move,
--                                             with its note, on one timeline
--   onboard-to-record (inserts a staff row) Mark Joined LINKS the record HR has
--                                             made on People ▸ Staff / Workers
--                                             and can start a Joining Checklist
--                                             (0766) in the same click
--   hr-resumes bucket (legacy) / Drive      private bucket hr-resumes
--
-- NOT ported: the CVViZ intake with learned rules and AI résumé reading, the
-- public careers API and interview booking (this app has no logged-out
-- surface), @mentions, the nudge cron and the alumni signal.
--
-- WHERE EACH RULE LIVES — candidates, their timeline, interviews and
-- scorecards are written ONLY by the SECURITY DEFINER functions below. Job
-- openings are a plain table under RLS.
--
-- What this file touches outside its own rc_* objects:
--   * approval_apply_terminal() — one branch added by the anchor replace
--     0765 / 0766 used; every existing branch is unchanged.
--   * approval_flows — one catch-all row (rc_hire), only if none exists.
--   * storage — one new PRIVATE bucket and its three policies.
--   * lc_onboardings — Mark Joined may start a joining checklist, through
--     0766's own lc_start_onboarding().
--   * staff / workers / departments / designations — READ only.
--
-- Reuses 0765's timeoff_my_staff_id() / timeoff_person() and 0766's
-- lc_is_hr() / lc_start_onboarding().

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Job openings
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.seq_rc_job;

create table if not exists public.rc_jobs (
  id               uuid primary key default gen_random_uuid(),
  code             text,
  location_id      uuid not null default public.current_location() references public.locations(id),
  title            text not null check (btrim(title) <> ''),
  department_id    uuid references public.departments(id),
  designation_id   uuid references public.designations(id),
  hires_as         text not null default 'workers' check (hires_as in ('staff', 'workers')),
  openings         int not null default 1 check (openings between 1 and 500),
  salary_basis     text not null default 'daily' check (salary_basis in ('monthly', 'daily')),
  salary_min       numeric(12,2) check (salary_min is null or salary_min >= 0),
  salary_max       numeric(12,2) check (salary_max is null or salary_max >= 0),
  experience_min   numeric(4,1) check (experience_min is null or experience_min >= 0),
  experience_max   numeric(4,1) check (experience_max is null or experience_max >= 0),
  qualification    text,
  description      text,
  needed_by        date,
  status           text not null default 'draft' check (status in ('draft', 'open', 'on_hold', 'closed', 'filled')),
  opened_at        timestamptz,
  closed_at        timestamptz,
  close_reason     text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint rc_job_salary check (salary_min is null or salary_max is null or salary_max >= salary_min),
  constraint rc_job_exp    check (experience_min is null or experience_max is null or experience_max >= experience_min)
);
comment on table public.rc_jobs is 'HR ▸ Recruitment — job openings, per unit. 0767.';
create index if not exists idx_rc_jobs_loc on public.rc_jobs (location_id, status);
drop trigger if exists trg_rc_job_code on public.rc_jobs;
create trigger trg_rc_job_code before insert on public.rc_jobs
  for each row execute function public.assign_code('JOB', 'public.seq_rc_job');
drop trigger if exists trg_rc_job_updated on public.rc_jobs;
create trigger trg_rc_job_updated before update on public.rc_jobs
  for each row execute function public.set_updated_at();

-- Stamp opened_at / closed_at as the status moves. A job is never filled or
-- re-opened by accident of a stale tab: those are just statuses, and the
-- stamps follow whichever was saved last.
create or replace function public.rc_job_stamp()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.title := upper(btrim(new.title));
  new.qualification := nullif(upper(btrim(coalesce(new.qualification, ''))), '');
  new.description := nullif(upper(btrim(coalesce(new.description, ''))), '');
  new.close_reason := nullif(upper(btrim(coalesce(new.close_reason, ''))), '');
  if new.status = 'open' and new.opened_at is null then new.opened_at := now(); end if;
  if new.status in ('closed', 'filled') then
    new.closed_at := coalesce(new.closed_at, now());
  else
    new.closed_at := null;
    new.close_reason := null;
  end if;
  return new;
end $$;
drop trigger if exists trg_rc_job_stamp on public.rc_jobs;
create trigger trg_rc_job_stamp before insert or update on public.rc_jobs
  for each row execute function public.rc_job_stamp();

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Résumés — private bucket
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-resumes', 'hr-resumes', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png',
              'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'])
on conflict (id) do nothing;

-- Key shape: <location_id>/<job_id>/<uuid>.<ext>. The unit in the key must be
-- the job's own unit, and the caller HR in it.
create or replace function public.rc_resume_key_ok(p_name text, p_action text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  parts   text[] := string_to_array(p_name, '/');
  v_loc   uuid;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if coalesce(array_length(parts, 1), 0) <> 3 then return false; end if;
  if parts[1] !~* uuid_re or parts[2] !~* uuid_re then return false; end if;
  select j.location_id into v_loc from public.rc_jobs j where j.id = parts[2]::uuid;
  if v_loc is null or v_loc <> parts[1]::uuid then return false; end if;
  return public.has_permission('hr_payroll', p_action) and public.is_current_location(v_loc);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Candidates + their timeline
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.seq_rc_candidate;

create table if not exists public.rc_candidates (
  id                    uuid primary key default gen_random_uuid(),
  code                  text,
  job_id                uuid not null references public.rc_jobs(id),
  location_id           uuid not null references public.locations(id),
  name                  text not null check (btrim(name) <> ''),
  phone                 text not null check (phone ~ '^[0-9]{10,13}$'),
  email                 text,
  gender                text check (gender is null or gender in ('male', 'female', 'other')),
  date_of_birth         date,
  town                  text,
  qualification         text,
  experience_years      numeric(4,1) check (experience_years is null or experience_years >= 0),
  current_employer      text,
  current_salary        numeric(12,2) check (current_salary is null or current_salary >= 0),
  expected_salary       numeric(12,2) check (expected_salary is null or expected_salary >= 0),
  notice_days           int check (notice_days is null or notice_days between 0 and 365),
  source                text not null default 'walk_in'
                        check (source in ('walk_in', 'referral', 'consultant', 'job_portal', 'advertisement', 'campus', 'other')),
  referred_by_staff_id  uuid references public.staff(id),
  source_note           text,
  notes                 text,
  resume_path           text unique,
  resume_name           text,
  status                text not null default 'new'
                        check (status in ('new', 'shortlisted', 'interview', 'pending_approval', 'approved', 'offered',
                                          'joined', 'rejected', 'withdrawn', 'offer_declined', 'no_show')),
  status_before_approval text,
  -- The offer as last PROPOSED (what the approver is looking at)…
  offer_designation_id  uuid references public.designations(id),
  offer_salary          numeric(12,2) check (offer_salary is null or offer_salary > 0),
  offer_basis           text check (offer_basis is null or offer_basis in ('monthly', 'daily')),
  offer_joining_date    date,
  offer_note            text,
  -- …and as last APPROVED. A revised offer the approver turns down leaves these.
  approved_designation_id uuid references public.designations(id),
  approved_salary       numeric(12,2),
  approved_basis        text,
  approved_joining_date date,
  approved_by           uuid,
  approved_at           timestamptz,
  decision_remark       text,
  offered_at            timestamptz,
  joined_on             date,
  hired_staff_id        uuid references public.staff(id),
  hired_worker_id       uuid references public.workers(id),
  closed_reason         text,
  created_by            uuid default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  constraint rc_cand_hired check (num_nonnulls(hired_staff_id, hired_worker_id) <= 1)
);
comment on table public.rc_candidates is
  'HR ▸ Recruitment — one candidate for one job, from application to joining. Written only by rc_* functions. 0767.';
create index if not exists idx_rc_cand_job on public.rc_candidates (job_id, status);
create index if not exists idx_rc_cand_loc on public.rc_candidates (location_id, status);
create index if not exists idx_rc_cand_phone on public.rc_candidates (phone);
-- The same phone twice on one job is the same person applying twice.
create unique index if not exists uq_rc_cand_job_phone on public.rc_candidates (job_id, phone)
  where status not in ('withdrawn');
create unique index if not exists uq_rc_cand_staff  on public.rc_candidates (hired_staff_id)  where hired_staff_id is not null;
create unique index if not exists uq_rc_cand_worker on public.rc_candidates (hired_worker_id) where hired_worker_id is not null;
drop trigger if exists trg_rc_cand_code on public.rc_candidates;
create trigger trg_rc_cand_code before insert on public.rc_candidates
  for each row execute function public.assign_code('CAN', 'public.seq_rc_candidate');
drop trigger if exists trg_rc_cand_updated on public.rc_candidates;
create trigger trg_rc_cand_updated before update on public.rc_candidates
  for each row execute function public.set_updated_at();

create table if not exists public.rc_candidate_events (
  id            uuid primary key default gen_random_uuid(),
  candidate_id  uuid not null references public.rc_candidates(id) on delete cascade,
  location_id   uuid not null references public.locations(id),
  kind          text not null,       -- created | edited | moved | note | interview | offer | decision | joined
  from_status   text,
  to_status     text,
  note          text,
  data          jsonb,
  actor_id      uuid default auth.uid(),
  created_at    timestamptz not null default now()
);
create index if not exists idx_rc_events on public.rc_candidate_events (candidate_id, created_at);

create or replace function public.rc_log(
  p_cand uuid, p_kind text, p_from text, p_to text, p_note text, p_data jsonb)
returns void language sql security definer set search_path = '' as $$
  insert into public.rc_candidate_events (candidate_id, location_id, kind, from_status, to_status, note, data)
  select c.id, c.location_id, p_kind, p_from, p_to, nullif(upper(btrim(coalesce(p_note, ''))), ''), p_data
    from public.rc_candidates c where c.id = p_cand;
$$;

-- Add or edit a candidate's details (never their status). On add, the job
-- must be open; a résumé must already be in the job's folder, uploaded by
-- the caller.
create or replace function public.rc_save_candidate(p_id uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c        public.rc_candidates;
  j        public.rc_jobs;
  v_phone  text := regexp_replace(coalesce(p->>'phone', ''), '[^0-9]', '', 'g');
  v_name   text := upper(btrim(coalesce(p->>'name', '')));
  v_path   text := nullif(btrim(coalesce(p->>'resume_path', '')), '');
  v_src    text := coalesce(nullif(p->>'source', ''), 'walk_in');
  v_ref    uuid := nullif(p->>'referred_by_staff_id', '')::uuid;
  v_owner  uuid;
  v_id     uuid;
begin
  if p_id is not null then
    select * into c from public.rc_candidates where id = p_id for update;
    if c.id is null then raise exception 'Candidate not found' using errcode = '23503'; end if;
    select * into j from public.rc_jobs where id = c.job_id;
    if not public.lc_is_hr(j.location_id, 'edit') then
      raise exception 'Only HR in this unit can edit a candidate' using errcode = '42501';
    end if;
    if c.status in ('joined', 'withdrawn') then
      raise exception 'A candidate who has joined or withdrawn is not edited' using errcode = '55000';
    end if;
  else
    select * into j from public.rc_jobs where id = nullif(p->>'job_id', '')::uuid;
    if j.id is null then raise exception 'Pick the job' using errcode = '23503'; end if;
    if not public.lc_is_hr(j.location_id, 'create') then
      raise exception 'Only HR in this job''s unit can add candidates' using errcode = '42501';
    end if;
    if j.status <> 'open' then
      raise exception 'Job % is not open — open it before adding candidates', j.code using errcode = '55000';
    end if;
  end if;

  if v_name = '' then raise exception 'The name is mandatory' using errcode = '22023'; end if;
  if length(v_phone) not between 10 and 13 then
    raise exception 'Enter a phone number of 10 digits (or with the country code)' using errcode = '22023';
  end if;
  if v_src = 'referral' and v_ref is null then
    raise exception 'Pick who referred them' using errcode = '22023';
  end if;
  if exists (select 1 from public.rc_candidates x
              where x.job_id = j.id and x.phone = v_phone and x.status <> 'withdrawn'
                and x.id is distinct from p_id) then
    raise exception 'A candidate with phone % has already applied for %', v_phone, j.title using errcode = '23505';
  end if;

  if v_path is not null and v_path is distinct from c.resume_path then
    if left(v_path, length(j.location_id::text || '/' || j.id::text || '/')) <> j.location_id::text || '/' || j.id::text || '/' then
      raise exception 'That résumé was not uploaded for this job' using errcode = '22023';
    end if;
    select so.owner into v_owner from storage.objects so where so.bucket_id = 'hr-resumes' and so.name = v_path;
    if not found then raise exception 'The résumé upload was not found — choose the file again' using errcode = '23503'; end if;
    if v_owner is distinct from auth.uid() then
      raise exception 'That résumé was uploaded by someone else' using errcode = '42501';
    end if;
  end if;

  if p_id is null then
    insert into public.rc_candidates
      (job_id, location_id, name, phone, email, gender, date_of_birth, town, qualification, experience_years,
       current_employer, current_salary, expected_salary, notice_days, source, referred_by_staff_id, source_note,
       notes, resume_path, resume_name)
    values
      (j.id, j.location_id, v_name, v_phone, nullif(lower(btrim(coalesce(p->>'email', ''))), ''),
       nullif(p->>'gender', ''), nullif(p->>'date_of_birth', '')::date,
       nullif(upper(btrim(coalesce(p->>'town', ''))), ''), nullif(upper(btrim(coalesce(p->>'qualification', ''))), ''),
       nullif(p->>'experience_years', '')::numeric, nullif(upper(btrim(coalesce(p->>'current_employer', ''))), ''),
       nullif(p->>'current_salary', '')::numeric, nullif(p->>'expected_salary', '')::numeric,
       nullif(p->>'notice_days', '')::int, v_src, case when v_src = 'referral' then v_ref end,
       nullif(upper(btrim(coalesce(p->>'source_note', ''))), ''), nullif(upper(btrim(coalesce(p->>'notes', ''))), ''),
       v_path, case when v_path is not null then nullif(btrim(coalesce(p->>'resume_name', '')), '') end)
    returning id into v_id;
    perform public.rc_log(v_id, 'created', null, 'new', null, jsonb_build_object('job', j.code));
  else
    update public.rc_candidates set
      name = v_name, phone = v_phone,
      email = nullif(lower(btrim(coalesce(p->>'email', ''))), ''),
      gender = nullif(p->>'gender', ''),
      date_of_birth = nullif(p->>'date_of_birth', '')::date,
      town = nullif(upper(btrim(coalesce(p->>'town', ''))), ''),
      qualification = nullif(upper(btrim(coalesce(p->>'qualification', ''))), ''),
      experience_years = nullif(p->>'experience_years', '')::numeric,
      current_employer = nullif(upper(btrim(coalesce(p->>'current_employer', ''))), ''),
      current_salary = nullif(p->>'current_salary', '')::numeric,
      expected_salary = nullif(p->>'expected_salary', '')::numeric,
      notice_days = nullif(p->>'notice_days', '')::int,
      source = v_src,
      referred_by_staff_id = case when v_src = 'referral' then v_ref end,
      source_note = nullif(upper(btrim(coalesce(p->>'source_note', ''))), ''),
      notes = nullif(upper(btrim(coalesce(p->>'notes', ''))), ''),
      resume_path = coalesce(v_path, resume_path),
      resume_name = case when v_path is not null and v_path is distinct from c.resume_path
                         then nullif(btrim(coalesce(p->>'resume_name', '')), '') else resume_name end
     where id = p_id;
    v_id := p_id;
    perform public.rc_log(v_id, 'edited', null, null, null, null);
  end if;
  return v_id;
end $$;

-- Only a NEW candidate, never interviewed, can be deleted — an entry made by
-- mistake. Everyone else is rejected or withdrawn, so the record stays.
-- Returns the résumé path so the server can remove the file.
create or replace function public.rc_delete_candidate(p_id uuid)
returns text language plpgsql security definer set search_path = '' as $$
declare
  c public.rc_candidates;
begin
  select * into c from public.rc_candidates where id = p_id for update;
  if c.id is null then raise exception 'Candidate not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(c.location_id, 'delete') then
    raise exception 'Only HR with delete rights in this unit can delete a candidate' using errcode = '42501';
  end if;
  if c.status <> 'new' or exists (select 1 from public.rc_interviews i where i.candidate_id = c.id) then
    raise exception 'Only a new candidate with no interviews can be deleted — reject or withdraw them instead'
      using errcode = '55000';
  end if;
  delete from public.rc_candidates where id = c.id;
  return c.resume_path;
end $$;

-- Move one or more candidates along. The moves allowed here — the rest
-- happen by their own function (interview → interview, selection →
-- pending_approval, the decision → approved, joining → joined):
--
--   new, shortlisted, interview → shortlisted · rejected · withdrawn
--   approved                    → offered · rejected · withdrawn
--   offered                     → offer_declined · no_show · withdrawn
--   rejected                    → shortlisted (reconsider; a note says why)
--
-- rejected / withdrawn / offer_declined / no_show / reconsider need a note.
create or replace function public.rc_move_candidates(p_ids uuid[], p_to text, p_note text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  c    public.rc_candidates;
  v_n  int := 0;
  ok   boolean;
begin
  if p_to not in ('shortlisted', 'rejected', 'withdrawn', 'offered', 'offer_declined', 'no_show') then
    raise exception 'Unknown move' using errcode = '22023';
  end if;
  for c in select * from public.rc_candidates where id = any(p_ids) order by created_at for update loop
    if not public.lc_is_hr(c.location_id, 'edit') then
      raise exception 'Only HR in this unit can move candidate %', c.code using errcode = '42501';
    end if;
    ok := case
      when c.status in ('new', 'shortlisted', 'interview') then p_to in ('shortlisted', 'rejected', 'withdrawn')
      when c.status = 'approved'  then p_to in ('offered', 'rejected', 'withdrawn')
      when c.status = 'offered'   then p_to in ('offer_declined', 'no_show', 'withdrawn')
      when c.status = 'rejected'  then p_to = 'shortlisted'
      else false end;
    if not ok or c.status = p_to then
      raise exception '% (%) is %, so it cannot be moved to %', c.name, c.code, replace(c.status, '_', ' '),
        replace(p_to, '_', ' ') using errcode = '55000';
    end if;
    if (p_to in ('rejected', 'withdrawn', 'offer_declined', 'no_show') or c.status = 'rejected')
       and btrim(coalesce(p_note, '')) = '' then
      raise exception 'Say why' using errcode = '22023';
    end if;
    update public.rc_candidates
       set status = p_to,
           offered_at = case when p_to = 'offered' then now() else offered_at end,
           closed_reason = case when p_to in ('rejected', 'withdrawn', 'offer_declined', 'no_show')
                                then upper(btrim(p_note)) else null end
     where id = c.id;
    perform public.rc_log(c.id, 'moved', c.status, p_to, p_note, null);
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

create or replace function public.rc_add_note(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c public.rc_candidates;
begin
  select * into c from public.rc_candidates where id = p_id;
  if c.id is null then raise exception 'Candidate not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(c.location_id, 'edit') then
    raise exception 'Only HR in this unit can add a note' using errcode = '42501';
  end if;
  if btrim(coalesce(p_note, '')) = '' then raise exception 'Write the note' using errcode = '22023'; end if;
  perform public.rc_log(c.id, 'note', null, null, p_note, null);
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Interviews + scorecards
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.rc_interviews (
  id                   uuid primary key default gen_random_uuid(),
  candidate_id         uuid not null references public.rc_candidates(id) on delete cascade,
  location_id          uuid not null references public.locations(id),
  round_no             int not null,
  round_name           text not null check (btrim(round_name) <> ''),
  scheduled_at         timestamptz not null,
  duration_min         int not null default 30 check (duration_min between 5 and 480),
  mode                 text not null default 'in_person' check (mode in ('in_person', 'phone', 'video')),
  venue                text,
  panel                uuid[] not null check (cardinality(panel) between 1 and 10),   -- staff ids
  status               text not null default 'scheduled'
                       check (status in ('scheduled', 'completed', 'cancelled', 'no_show', 'rescheduled')),
  rescheduled_from_id  uuid references public.rc_interviews(id),
  outcome_note         text,
  closed_by            uuid,
  closed_at            timestamptz,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
comment on table public.rc_interviews is 'HR ▸ Recruitment — interview rounds. A reschedule keeps the old row. 0767.';
create index if not exists idx_rc_int_cand on public.rc_interviews (candidate_id, round_no);
create index if not exists idx_rc_int_when on public.rc_interviews (location_id, scheduled_at);
create index if not exists idx_rc_int_panel on public.rc_interviews using gin (panel);
drop trigger if exists trg_rc_int_updated on public.rc_interviews;
create trigger trg_rc_int_updated before update on public.rc_interviews
  for each row execute function public.set_updated_at();

create table if not exists public.rc_scorecards (
  id               uuid primary key default gen_random_uuid(),
  interview_id     uuid not null references public.rc_interviews(id) on delete cascade,
  candidate_id     uuid not null references public.rc_candidates(id) on delete cascade,
  location_id      uuid not null references public.locations(id),
  interviewer_id   uuid not null references public.staff(id),
  skill            int not null check (skill between 1 and 5),
  communication    int not null check (communication between 1 and 5),
  attitude         int not null check (attitude between 1 and 5),
  experience       int not null check (experience between 1 and 5),
  recommendation   text not null check (recommendation in ('strong_hire', 'hire', 'neutral', 'no_hire', 'strong_no_hire')),
  comments         text,
  entered_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (interview_id, interviewer_id)
);
comment on table public.rc_scorecards is
  'HR ▸ Recruitment — one panel member''s marks for one interview, 1–5. Entered by the panel member or by HR from the paper sheet. 0767.';
drop trigger if exists trg_rc_score_updated on public.rc_scorecards;
create trigger trg_rc_score_updated before update on public.rc_scorecards
  for each row execute function public.set_updated_at();

create or replace function public.rc_check_panel(p_panel uuid[])
returns void language plpgsql stable security definer set search_path = '' as $$
declare
  v_bad int;
begin
  if p_panel is null or cardinality(p_panel) = 0 then
    raise exception 'Pick at least one person for the panel' using errcode = '22023';
  end if;
  select count(*) into v_bad from unnest(p_panel) x(id)
   where not exists (select 1 from public.staff s where s.id = x.id and s.is_active);
  if v_bad > 0 then raise exception 'Every panel member must be active staff' using errcode = '23503'; end if;
end $$;

create or replace function public.rc_schedule_interview(
  p_candidate uuid, p_round_name text, p_at timestamptz, p_duration int, p_mode text, p_venue text, p_panel uuid[])
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  c     public.rc_candidates;
  v_id  uuid;
  v_no  int;
begin
  select * into c from public.rc_candidates where id = p_candidate for update;
  if c.id is null then raise exception 'Candidate not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(c.location_id, 'edit') then
    raise exception 'Only HR in this unit can schedule interviews' using errcode = '42501';
  end if;
  if c.status not in ('new', 'shortlisted', 'interview') then
    raise exception '% is %, so no interview can be scheduled', c.name, replace(c.status, '_', ' ') using errcode = '55000';
  end if;
  if btrim(coalesce(p_round_name, '')) = '' then raise exception 'Name the round' using errcode = '22023'; end if;
  if p_at is null then raise exception 'Pick the date and time' using errcode = '22023'; end if;
  if exists (select 1 from public.rc_interviews i where i.candidate_id = c.id and i.status = 'scheduled') then
    raise exception '% already has an interview scheduled — complete or cancel it first', c.name using errcode = '23505';
  end if;
  perform public.rc_check_panel(p_panel);

  select coalesce(max(round_no), 0) + 1 into v_no
    from public.rc_interviews where candidate_id = c.id and status in ('completed', 'no_show');
  insert into public.rc_interviews
    (candidate_id, location_id, round_no, round_name, scheduled_at, duration_min, mode, venue, panel)
  values
    (c.id, c.location_id, v_no, upper(btrim(p_round_name)), p_at, coalesce(p_duration, 30),
     coalesce(nullif(p_mode, ''), 'in_person'), nullif(upper(btrim(coalesce(p_venue, ''))), ''),
     (select array_agg(distinct x) from unnest(p_panel) x))
  returning id into v_id;

  if c.status <> 'interview' then
    update public.rc_candidates set status = 'interview' where id = c.id;
  end if;
  perform public.rc_log(c.id, 'interview', c.status, 'interview', null,
                        jsonb_build_object('round', v_no, 'round_name', upper(btrim(p_round_name)), 'at', p_at));
  return v_id;
end $$;

create or replace function public.rc_reschedule_interview(
  p_id uuid, p_at timestamptz, p_venue text, p_panel uuid[], p_reason text)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  i     public.rc_interviews;
  v_id  uuid;
begin
  select * into i from public.rc_interviews where id = p_id for update;
  if i.id is null then raise exception 'Interview not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(i.location_id, 'edit') then
    raise exception 'Only HR in this unit can reschedule interviews' using errcode = '42501';
  end if;
  if i.status <> 'scheduled' then raise exception 'Only a scheduled interview can be moved' using errcode = '55000'; end if;
  if p_at is null then raise exception 'Pick the new date and time' using errcode = '22023'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why' using errcode = '22023'; end if;
  perform public.rc_check_panel(coalesce(p_panel, i.panel));

  update public.rc_interviews
     set status = 'rescheduled', outcome_note = upper(btrim(p_reason)), closed_by = auth.uid(), closed_at = now()
   where id = i.id;
  insert into public.rc_interviews
    (candidate_id, location_id, round_no, round_name, scheduled_at, duration_min, mode, venue, panel, rescheduled_from_id)
  values
    (i.candidate_id, i.location_id, i.round_no, i.round_name, p_at, i.duration_min, i.mode,
     coalesce(nullif(upper(btrim(coalesce(p_venue, ''))), ''), i.venue),
     coalesce((select array_agg(distinct x) from unnest(p_panel) x), i.panel), i.id)
  returning id into v_id;
  perform public.rc_log(i.candidate_id, 'interview', null, null, p_reason,
                        jsonb_build_object('round', i.round_no, 'rescheduled_to', p_at));
  return v_id;
end $$;

-- Close a scheduled interview: completed, cancelled, or the candidate did not
-- come.
create or replace function public.rc_close_interview(p_id uuid, p_status text, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  i public.rc_interviews;
begin
  select * into i from public.rc_interviews where id = p_id for update;
  if i.id is null then raise exception 'Interview not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(i.location_id, 'edit') then
    raise exception 'Only HR in this unit can close interviews' using errcode = '42501';
  end if;
  if i.status <> 'scheduled' then raise exception 'This interview is already closed' using errcode = '55000'; end if;
  if p_status not in ('completed', 'cancelled', 'no_show') then raise exception 'Unknown outcome' using errcode = '22023'; end if;
  if p_status <> 'completed' and btrim(coalesce(p_note, '')) = '' then raise exception 'Say why' using errcode = '22023'; end if;
  update public.rc_interviews
     set status = p_status, outcome_note = nullif(upper(btrim(coalesce(p_note, ''))), ''),
         closed_by = auth.uid(), closed_at = now()
   where id = i.id;
  perform public.rc_log(i.candidate_id, 'interview', null, null, p_note,
                        jsonb_build_object('round', i.round_no, 'round_name', i.round_name, 'outcome', p_status));
end $$;

-- A panel member enters their own marks; HR may enter any panel member's from
-- the paper sheet. Whoever entered a scorecard may correct it; nobody else.
create or replace function public.rc_save_scorecard(
  p_interview uuid, p_interviewer uuid, p_skill int, p_communication int, p_attitude int, p_experience int,
  p_recommendation text, p_comments text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  i      public.rc_interviews;
  v_me   uuid := public.timeoff_my_staff_id();
  v_prev public.rc_scorecards;
begin
  select * into i from public.rc_interviews where id = p_interview;
  if i.id is null then raise exception 'Interview not found' using errcode = '23503'; end if;
  if i.status not in ('scheduled', 'completed') then
    raise exception 'This interview was % — no marks can be entered', replace(i.status, '_', ' ') using errcode = '55000';
  end if;
  if not (p_interviewer = any(i.panel)) then
    raise exception 'That person is not on this interview''s panel' using errcode = '22023';
  end if;
  if not ((v_me is not null and v_me = p_interviewer) or public.lc_is_hr(i.location_id, 'edit')) then
    raise exception 'Only the panel member, or HR in this unit, can enter these marks' using errcode = '42501';
  end if;
  select * into v_prev from public.rc_scorecards where interview_id = i.id and interviewer_id = p_interviewer for update;
  if v_prev.id is not null and v_prev.entered_by is distinct from auth.uid() then
    raise exception 'These marks were entered by someone else — only they can change them' using errcode = '42501';
  end if;
  insert into public.rc_scorecards
    (interview_id, candidate_id, location_id, interviewer_id, skill, communication, attitude, experience,
     recommendation, comments)
  values
    (i.id, i.candidate_id, i.location_id, p_interviewer, p_skill, p_communication, p_attitude, p_experience,
     p_recommendation, nullif(upper(btrim(coalesce(p_comments, ''))), ''))
  on conflict (interview_id, interviewer_id) do update
     set skill = excluded.skill, communication = excluded.communication, attitude = excluded.attitude,
         experience = excluded.experience, recommendation = excluded.recommendation, comments = excluded.comments;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Selection → approval → offer → joining
-- ════════════════════════════════════════════════════════════════════════════

-- Propose the offer and send it for approval. From shortlisted / interview
-- (the selection), or later (a revised offer — a counter-offer, a new date).
create or replace function public.rc_submit_selection(p_id uuid, p jsonb)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c        public.rc_candidates;
  j        public.rc_jobs;
  v_desig  uuid := nullif(p->>'designation_id', '')::uuid;
  v_sal    numeric := nullif(p->>'salary', '')::numeric;
  v_basis  text := coalesce(nullif(p->>'basis', ''), 'monthly');
  v_join   date := nullif(p->>'joining_date', '')::date;
  v_note   text := nullif(upper(btrim(coalesce(p->>'note', ''))), '');
  v_dname  text;
begin
  select * into c from public.rc_candidates where id = p_id for update;
  if c.id is null then raise exception 'Candidate not found' using errcode = '23503'; end if;
  select * into j from public.rc_jobs where id = c.job_id;
  if not public.lc_is_hr(c.location_id, 'edit') then
    raise exception 'Only HR in this unit can send a selection for approval' using errcode = '42501';
  end if;
  if c.status not in ('shortlisted', 'interview', 'approved', 'offered', 'offer_declined') then
    raise exception '% is %, so no offer can be sent for approval', c.name, replace(c.status, '_', ' ') using errcode = '55000';
  end if;
  if exists (select 1 from public.rc_interviews i where i.candidate_id = c.id and i.status = 'scheduled') then
    raise exception 'Close the scheduled interview first' using errcode = '55000';
  end if;
  if v_sal is null or v_sal <= 0 then raise exception 'Enter the salary offered' using errcode = '22023'; end if;
  if v_basis not in ('monthly', 'daily') then raise exception 'Monthly or daily' using errcode = '22023'; end if;
  if v_join is null then raise exception 'Enter the joining date' using errcode = '22023'; end if;
  if v_desig is not null then select d.name into v_dname from public.designations d where d.id = v_desig; end if;

  update public.rc_candidates
     set status = 'pending_approval', status_before_approval = c.status,
         offer_designation_id = v_desig, offer_salary = v_sal, offer_basis = v_basis,
         offer_joining_date = v_join, offer_note = v_note
   where id = c.id;
  perform public.rc_log(c.id, 'offer', c.status, 'pending_approval', v_note,
                        jsonb_build_object('salary', v_sal, 'basis', v_basis, 'joining_date', v_join,
                                           'designation', v_dname));
  perform public.approval_start_run(
    'rc_hire', 'rc_candidates', c.id,
    jsonb_build_object('person_name', c.name, 'job', j.title, 'job_code', j.code, 'designation', v_dname,
                       'salary', v_sal, 'basis', v_basis, 'joining_date', v_join,
                       'revision', c.status in ('approved', 'offered', 'offer_declined')),
    jsonb_build_object('location_id', c.location_id), null, auth.uid());
end $$;

-- Take a selection back from the approver (its run is cancelled; the
-- candidate returns to where they were).
create or replace function public.rc_recall_selection(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c     public.rc_candidates;
  v_run public.approval_runs;
begin
  select * into c from public.rc_candidates where id = p_id for update;
  if c.id is null then raise exception 'Candidate not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(c.location_id, 'edit') then
    raise exception 'Only HR in this unit can recall a selection' using errcode = '42501';
  end if;
  if c.status <> 'pending_approval' then raise exception 'Nothing is waiting for approval' using errcode = '55000'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why' using errcode = '22023'; end if;
  select * into v_run from public.approval_runs
   where subject_table = 'rc_candidates' and subject_id = c.id and status = 'in_progress'
   order by started_at desc limit 1 for update;
  if v_run.id is null then raise exception 'It has no open approval — reload' using errcode = '55000'; end if;
  insert into public.approval_run_events (run_id, step_order, action, actor_id, comment)
  values (v_run.id, v_run.current_step, 'cancel', auth.uid(), upper(btrim(p_reason)));
  -- the terminal trigger runs rc_hire_apply_decision('cancelled')
  update public.approval_runs
     set status = 'cancelled', completed_at = now(), lock_version = lock_version + 1
   where id = v_run.id;
end $$;

-- The approver's decision. Approved → the offer stands. Turned down → a first
-- selection is rejected; a REVISED offer falls back to where it was, and the
-- offer last approved still stands. Cancelled (recalled) → back where it was.
create or replace function public.rc_hire_apply_decision(
  p_id uuid, p_run_status text, p_actor uuid, p_remark text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c      public.rc_candidates;
  v_back text;
  v_to   text;
begin
  select * into c from public.rc_candidates where id = p_id for update;
  if c.id is null or c.status <> 'pending_approval' then
    raise exception 'Candidate % is not awaiting a decision — reload', p_id using errcode = '55000';
  end if;
  v_back := coalesce(c.status_before_approval, 'shortlisted');
  if p_run_status = 'completed' then
    v_to := 'approved';
    update public.rc_candidates
       set status = 'approved', approved_designation_id = offer_designation_id, approved_salary = offer_salary,
           approved_basis = offer_basis, approved_joining_date = offer_joining_date,
           approved_by = p_actor, approved_at = p_at, decision_remark = p_remark, status_before_approval = null
     where id = c.id;
  elsif p_run_status = 'rejected' then
    v_to := case when v_back in ('shortlisted', 'interview') then 'rejected' else v_back end;
    update public.rc_candidates
       set status = v_to, decision_remark = p_remark, status_before_approval = null,
           closed_reason = case when v_to = 'rejected' then coalesce(upper(p_remark), 'NOT APPROVED') else closed_reason end
     where id = c.id;
  else
    v_to := v_back;
    update public.rc_candidates set status = v_to, status_before_approval = null where id = c.id;
  end if;
  insert into public.rc_candidate_events (candidate_id, location_id, kind, from_status, to_status, note, actor_id, created_at)
  values (c.id, c.location_id, 'decision', 'pending_approval', v_to, p_remark, coalesce(p_actor, auth.uid()), p_at);
end $$;

-- They came. Link the staff / worker record HR has made for them on People,
-- optionally start a joining checklist, and fill the job when its openings
-- are all taken.
create or replace function public.rc_mark_joined(
  p_id uuid, p_staff uuid, p_worker uuid, p_joined date, p_template uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  c       public.rc_candidates;
  j       public.rc_jobs;
  p       record;
  v_count int;
begin
  select * into c from public.rc_candidates where id = p_id for update;
  if c.id is null then raise exception 'Candidate not found' using errcode = '23503'; end if;
  select * into j from public.rc_jobs where id = c.job_id for update;
  if not public.lc_is_hr(c.location_id, 'edit') then
    raise exception 'Only HR in this unit can mark a candidate joined' using errcode = '42501';
  end if;
  if c.status not in ('approved', 'offered') then
    raise exception 'Only a candidate whose offer is approved can join' using errcode = '55000';
  end if;
  if num_nonnulls(p_staff, p_worker) <> 1 then
    raise exception 'Pick the staff or worker record made for them on People' using errcode = '22023';
  end if;
  if (j.hires_as = 'staff') <> (p_staff is not null) then
    raise exception 'This job hires %, so pick a % record', j.hires_as,
      case when j.hires_as = 'staff' then 'staff' else 'worker' end using errcode = '22023';
  end if;
  select * into p from public.timeoff_person(p_staff, p_worker);
  if p.name is null then raise exception 'That person was not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(p.location_id, 'edit') then
    raise exception '% is not in the unit you are working in', p.name using errcode = '42501';
  end if;
  if exists (select 1 from public.rc_candidates x
              where x.id <> c.id and (x.hired_staff_id = p_staff or x.hired_worker_id = p_worker)) then
    raise exception '% is already linked to another candidate', p.name using errcode = '23505';
  end if;

  update public.rc_candidates
     set status = 'joined', joined_on = coalesce(p_joined, p.joined, public.timeoff_today()),
         hired_staff_id = p_staff, hired_worker_id = p_worker
   where id = c.id;
  perform public.rc_log(c.id, 'joined', c.status, 'joined', null,
                        jsonb_build_object('person', p.name, 'code', p.code));

  if p_template is not null then
    perform public.lc_start_onboarding(p_staff, p_worker, p_template, coalesce(p_joined, p.joined));
  end if;

  select count(*) into v_count from public.rc_candidates where job_id = j.id and status = 'joined';
  if v_count >= j.openings and j.status in ('open', 'on_hold') then
    update public.rc_jobs set status = 'filled' where id = j.id;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Storage policies (after rc_candidates, which the delete policy reads)
-- ════════════════════════════════════════════════════════════════════════════

drop policy if exists hr_resumes_insert on storage.objects;
create policy hr_resumes_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-resumes' and public.rc_resume_key_ok(name, 'edit'));

-- HR in the unit, or a panel member of one of that candidate's interviews.
drop policy if exists hr_resumes_read on storage.objects;
create policy hr_resumes_read on storage.objects for select to authenticated
  using (bucket_id = 'hr-resumes'
         and (public.rc_resume_key_ok(name, 'view')
              or exists (select 1 from public.rc_candidates c join public.rc_interviews i on i.candidate_id = c.id
                          where c.resume_path = storage.objects.name
                            and public.timeoff_my_staff_id() = any(i.panel))));

-- Only a file no candidate points at — an abandoned upload, or one a deleted
-- candidate left behind.
drop policy if exists hr_resumes_delete on storage.objects;
create policy hr_resumes_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hr-resumes' and public.rc_resume_key_ok(name, 'edit')
         and not exists (select 1 from public.rc_candidates c where c.resume_path = storage.objects.name));

-- ════════════════════════════════════════════════════════════════════════════
-- 7. Engine wiring — terminal branch + default flow
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_def    text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
  v_anchor text := E'    raise exception\n        ''approval_apply_terminal: no terminal callback';
  v_branch text := E'    if new.subject_table = ''rc_candidates'' then\n'
                || E'        perform public.rc_hire_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark, coalesce(new.completed_at, now()));\n'
                || E'        return new;\n'
                || E'    end if;\n\n';
begin
  if position('''rc_candidates''' in v_def) > 0 then
    return;  -- already there (a re-run)
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0767: approval_apply_terminal''s final refusal was not found — add the rc branch by hand.';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'rc_hire', 'Hiring — default',
       'Catch-all. Every selection (and every revised offer) goes to the Managing Director or an HR Manager. MyJKKN chained several approvers by role category and salary band: add steps or criteria here if wanted.',
       '{}'::jsonb,
       coalesce((select f.steps from public.approval_flows f
                  where f.workflow_key = 'hr_fine' and f.flow_name = 'HR Fine — default' limit 1),
                '[{"step_order":1,"step_type":"final","step_label":"MD / HR Manager","approver_resolver":"md_or_hr_manager"}]'::jsonb),
       900, true
 where not exists (select 1 from public.approval_flows x where x.workflow_key = 'rc_hire');

-- ════════════════════════════════════════════════════════════════════════════
-- 8. RLS + grants
-- ════════════════════════════════════════════════════════════════════════════

alter table public.rc_jobs              enable row level security;
alter table public.rc_candidates        enable row level security;
alter table public.rc_candidate_events  enable row level security;
alter table public.rc_interviews        enable row level security;
alter table public.rc_scorecards        enable row level security;

drop policy if exists rc_job_read on public.rc_jobs;
drop policy if exists rc_job_ins  on public.rc_jobs;
drop policy if exists rc_job_upd  on public.rc_jobs;
drop policy if exists rc_job_del  on public.rc_jobs;
create policy rc_job_read on public.rc_jobs for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or exists (select 1 from public.rc_candidates c join public.rc_interviews i on i.candidate_id = c.id
                     where c.job_id = rc_jobs.id and public.timeoff_my_staff_id() = any(i.panel)));
create policy rc_job_ins on public.rc_jobs for insert
  with check (public.has_permission('hr_payroll', 'create') and public.is_current_location(location_id));
create policy rc_job_upd on public.rc_jobs for update
  using (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id))
  with check (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id));
create policy rc_job_del on public.rc_jobs for delete
  using (public.has_permission('hr_payroll', 'delete') and public.is_current_location(location_id));

-- A panel member sees the candidates they interview, and those interviews.
drop policy if exists rc_cand_read on public.rc_candidates;
create policy rc_cand_read on public.rc_candidates for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or exists (select 1 from public.rc_interviews i
                     where i.candidate_id = rc_candidates.id and public.timeoff_my_staff_id() = any(i.panel)));

drop policy if exists rc_event_read on public.rc_candidate_events;
create policy rc_event_read on public.rc_candidate_events for select
  using (public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id));

drop policy if exists rc_int_read on public.rc_interviews;
create policy rc_int_read on public.rc_interviews for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or public.timeoff_my_staff_id() = any(panel));

-- Marks are independent: a panel member reads only their own; HR reads all.
drop policy if exists rc_score_read on public.rc_scorecards;
create policy rc_score_read on public.rc_scorecards for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or interviewer_id = public.timeoff_my_staff_id());

revoke insert, update, delete on public.rc_candidates       from anon, authenticated;
revoke insert, update, delete on public.rc_candidate_events from anon, authenticated;
revoke insert, update, delete on public.rc_interviews       from anon, authenticated;
revoke insert, update, delete on public.rc_scorecards       from anon, authenticated;

revoke all on function public.rc_job_stamp()                                            from public, anon, authenticated;
revoke all on function public.rc_resume_key_ok(text, text)                              from public, anon;
revoke all on function public.rc_log(uuid, text, text, text, text, jsonb)               from public, anon, authenticated;
revoke all on function public.rc_save_candidate(uuid, jsonb)                            from public, anon;
revoke all on function public.rc_delete_candidate(uuid)                                 from public, anon;
revoke all on function public.rc_move_candidates(uuid[], text, text)                    from public, anon;
revoke all on function public.rc_add_note(uuid, text)                                   from public, anon;
revoke all on function public.rc_check_panel(uuid[])                                    from public, anon, authenticated;
revoke all on function public.rc_schedule_interview(uuid, text, timestamptz, int, text, text, uuid[]) from public, anon;
revoke all on function public.rc_reschedule_interview(uuid, timestamptz, text, uuid[], text) from public, anon;
revoke all on function public.rc_close_interview(uuid, text, text)                      from public, anon;
revoke all on function public.rc_save_scorecard(uuid, uuid, int, int, int, int, text, text) from public, anon;
revoke all on function public.rc_submit_selection(uuid, jsonb)                          from public, anon;
revoke all on function public.rc_recall_selection(uuid, text)                           from public, anon;
revoke all on function public.rc_hire_apply_decision(uuid, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.rc_mark_joined(uuid, uuid, uuid, date, uuid)              from public, anon;
revoke all on function public.approval_apply_terminal()                                 from public, anon;

-- rc_resume_key_ok is read by the storage policies, which run as the caller.
grant execute on function public.rc_resume_key_ok(text, text)                           to authenticated;
grant execute on function public.rc_save_candidate(uuid, jsonb)                         to authenticated;
grant execute on function public.rc_delete_candidate(uuid)                              to authenticated;
grant execute on function public.rc_move_candidates(uuid[], text, text)                 to authenticated;
grant execute on function public.rc_add_note(uuid, text)                                to authenticated;
grant execute on function public.rc_schedule_interview(uuid, text, timestamptz, int, text, text, uuid[]) to authenticated;
grant execute on function public.rc_reschedule_interview(uuid, timestamptz, text, uuid[], text) to authenticated;
grant execute on function public.rc_close_interview(uuid, text, text)                   to authenticated;
grant execute on function public.rc_save_scorecard(uuid, uuid, int, int, int, int, text, text) to authenticated;
grant execute on function public.rc_submit_selection(uuid, jsonb)                       to authenticated;
grant execute on function public.rc_recall_selection(uuid, text)                        to authenticated;
grant execute on function public.rc_mark_joined(uuid, uuid, uuid, date, uuid)           to authenticated;
