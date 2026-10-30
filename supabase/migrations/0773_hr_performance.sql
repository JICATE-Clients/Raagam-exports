-- 0773 — HR ▸ PERFORMANCE & GROWTH (MyJKKN HR port, phase 4 — client 2026-10-30)
--
-- Source: MyJKKN docs/HR-MODULE-SPEC.md §13.1–13.3, rebuilt on Raagam's units,
-- people (staff + workers) and approval engine:
--
--   MyJKKN                                  Raagam (this file)
--   ─────────────────────────────────────── ──────────────────────────────────
--   hr_performance_review_cycles            pf_rounds — appraisal rounds, per
--     draft → open → locked → closed          unit; one open round per unit
--   hr_performance_reviews                  pf_reviews — one per person per round
--     self → HoD → SEDC → Director            self-rating → supervisor → the
--     (committee + Director: admin-only)      approval engine (workflow pf_review,
--                                             Admin ▸ Approval Flows). A worker
--                                             has no login, so their review
--                                             starts at the supervisor
--   supervisor = departments.head           the person's own manager_id (staff /
--                                             workers), changeable per review
--   hr_promotion_applications +             pf_promotions — raised by HR,
--     hr_promotion_decisions (the PATCH       approved through the engine
--     route let an applicant approve their    (workflow pf_promotion). Nobody
--     own application; approval did not       but an approver can approve, and
--     change the designation)                 approval DOES set the designation
--   hr_training_sessions +                  pf_trainings + pf_enrolments, with
--     hr_training_enrollments (no capacity,   seats enforced and certificates in
--     certificate_url free text, a person     a private bucket; only HR moves an
--     could set their own status)             enrolment
--
-- NOT ported: FDP (a college faculty programme), the SEDC committee step and
-- merit scoring, live polls.
--
-- WHERE EACH RULE LIVES — reviews and promotions are written ONLY by the
-- SECURITY DEFINER functions below. Rounds, trainings and enrolments are plain
-- tables under RLS, with their rules in triggers.
--
-- What this file touches outside its own pf_* objects:
--   * approval_apply_terminal() — two branches added by the anchor replace
--     0770 / 0771 / 0772 used; every existing branch is unchanged.
--   * approval_flows — two catch-all rows (pf_review, pf_promotion), only if
--     none exists.
--   * staff.designation_id / workers.designation_id — set by an APPROVED
--     promotion, and by nothing else here.
--   * storage — one new PRIVATE bucket (hr-training-certs) and its policies.
--   * staff / workers / designations — otherwise READ only.
--
-- Reuses 0770's timeoff_my_staff_id() / timeoff_person() / timeoff_today()
-- and 0771's lc_is_hr().

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Helpers
-- ════════════════════════════════════════════════════════════════════════════

-- Four areas, each Below (0) · Meets (12.5) · Exceeds (25). All "meets" is 50,
-- as in MyJKKN. NULL until every area is rated.
create or replace function public.pf_score(a text, b text, c text, d text)
returns numeric language sql immutable set search_path = '' as $$
  select case when a is null or b is null or c is null or d is null then null
         else (select sum(case x when 'exceeds' then 25 when 'meets' then 12.5 else 0 end)
                 from unnest(array[a, b, c, d]) x)::numeric end;
$$;

-- A person's designation and their manager (the supervisor who rates them).
create or replace function public.pf_person_role(p_staff uuid, p_worker uuid)
returns table (designation_id uuid, manager_id uuid, salary numeric, basis text)
language sql stable security definer set search_path = '' as $$
  select s.designation_id, s.manager_id, s.monthly_salary, 'monthly'
    from public.staff s where p_staff is not null and s.id = p_staff
  union all
  select w.designation_id, w.manager_id,
         case when coalesce(w.act_basic, 0) + coalesce(w.act_da, 0) > 0
              then coalesce(w.act_gross, w.act_basic + w.act_da) else w.shift_wage_per_day end,
         case when coalesce(w.act_basic, 0) + coalesce(w.act_da, 0) > 0 then 'monthly' else 'daily' end
    from public.workers w where p_worker is not null and w.id = p_worker;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Appraisal rounds
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.seq_pf_round;

create table if not exists public.pf_rounds (
  id           uuid primary key default gen_random_uuid(),
  code         text,
  location_id  uuid not null default public.current_location() references public.locations(id),
  name         text not null check (btrim(name) <> ''),
  period_from  date not null,
  period_to    date not null,
  self_due     date,
  review_due   date,
  status       text not null default 'draft' check (status in ('draft', 'open', 'locked', 'closed')),
  note         text,
  opened_at    timestamptz,
  closed_at    timestamptz,
  created_by   uuid default auth.uid(),
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  constraint pf_round_period check (period_to >= period_from)
);
comment on table public.pf_rounds is 'HR ▸ Performance & Growth — appraisal rounds, per unit. 0773.';
-- One open round per unit, as in MyJKKN.
create unique index if not exists uq_pf_round_open on public.pf_rounds (location_id) where status = 'open';
drop trigger if exists trg_pf_round_code on public.pf_rounds;
create trigger trg_pf_round_code before insert on public.pf_rounds
  for each row execute function public.assign_code('APR', 'public.seq_pf_round');
drop trigger if exists trg_pf_round_updated on public.pf_rounds;
create trigger trg_pf_round_updated before update on public.pf_rounds
  for each row execute function public.set_updated_at();

-- The round's status map, and its capitals:
--   draft → open · open → locked · locked → open · locked → closed
-- "locked" closes self-rating; supervisors can still finish. A round is
-- closed only when no review in it is waiting for approval.
create or replace function public.pf_round_guard()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.name := upper(btrim(new.name));
  new.note := nullif(upper(btrim(coalesce(new.note, ''))), '');
  if tg_op = 'INSERT' then
    if new.status <> 'draft' then new.status := 'draft'; end if;
    return new;
  end if;
  if new.location_id <> old.location_id then
    raise exception 'A round stays in its own unit' using errcode = '55000';
  end if;
  if old.status = 'closed' and (new.status <> 'closed' or row(new.name, new.period_from, new.period_to, new.self_due, new.review_due, new.note)
                                    is distinct from row(old.name, old.period_from, old.period_to, old.self_due, old.review_due, old.note)) then
    raise exception 'Round % is closed', old.code using errcode = '55000';
  end if;
  if new.status <> old.status then
    if not ((old.status = 'draft' and new.status = 'open')
         or (old.status = 'open' and new.status = 'locked')
         or (old.status = 'locked' and new.status in ('open', 'closed'))) then
      raise exception 'A % round cannot be moved to %', old.status, new.status using errcode = '55000';
    end if;
    if new.status = 'open' and exists (select 1 from public.pf_rounds r
                                        where r.location_id = new.location_id and r.status = 'open' and r.id <> new.id) then
      raise exception 'Another round is already open in this unit — lock it first' using errcode = '23505';
    end if;
    if new.status = 'closed' and exists (select 1 from public.pf_reviews v
                                          where v.round_id = new.id and v.status = 'pending_approval') then
      raise exception 'Some appraisals in this round are still waiting for approval' using errcode = '55000';
    end if;
    if new.status = 'open' then new.opened_at := coalesce(old.opened_at, now()); end if;
    new.closed_at := case when new.status = 'closed' then now() end;
  end if;
  return new;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Appraisals (one per person per round)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.pf_reviews (
  id               uuid primary key default gen_random_uuid(),
  round_id         uuid not null references public.pf_rounds(id),
  location_id      uuid not null references public.locations(id),
  staff_id         uuid references public.staff(id),
  worker_id        uuid references public.workers(id),
  reviewer_id      uuid references public.staff(id),
  self_rating      boolean not null default true,
  status           text not null default 'self'
                   check (status in ('self', 'supervisor', 'pending_approval', 'approved')),
  self_quality     text check (self_quality    in ('exceeds', 'meets', 'below')),
  self_output      text check (self_output     in ('exceeds', 'meets', 'below')),
  self_discipline  text check (self_discipline in ('exceeds', 'meets', 'below')),
  self_teamwork    text check (self_teamwork   in ('exceeds', 'meets', 'below')),
  self_comment     text,
  self_by          uuid,
  self_at          timestamptz,
  sup_quality      text check (sup_quality    in ('exceeds', 'meets', 'below')),
  sup_output       text check (sup_output     in ('exceeds', 'meets', 'below')),
  sup_discipline   text check (sup_discipline in ('exceeds', 'meets', 'below')),
  sup_teamwork     text check (sup_teamwork   in ('exceeds', 'meets', 'below')),
  sup_comment      text,
  strengths        text,
  improvements     text,
  sup_by           uuid,
  sup_at           timestamptz,
  final_score      numeric(5,2),
  returned_note    text,
  approved_by      uuid,
  approved_at      timestamptz,
  decision_remark  text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint pf_review_person check (num_nonnulls(staff_id, worker_id) = 1),
  constraint pf_review_worker_no_self check (worker_id is null or not self_rating)
);
comment on table public.pf_reviews is
  'HR ▸ Performance & Growth — one appraisal: self-rating, supervisor rating, approval. Written only by pf_* functions. 0773.';
create unique index if not exists uq_pf_review_staff  on public.pf_reviews (round_id, staff_id)  where staff_id is not null;
create unique index if not exists uq_pf_review_worker on public.pf_reviews (round_id, worker_id) where worker_id is not null;
create index if not exists idx_pf_review_loc on public.pf_reviews (location_id, status);
create index if not exists idx_pf_review_reviewer on public.pf_reviews (reviewer_id) where reviewer_id is not null;
drop trigger if exists trg_pf_review_updated on public.pf_reviews;
create trigger trg_pf_review_updated before update on public.pf_reviews
  for each row execute function public.set_updated_at();

-- The round guard reads pf_reviews, so its trigger is made after the table.
drop trigger if exists trg_pf_round_guard on public.pf_rounds;
create trigger trg_pf_round_guard before insert or update on public.pf_rounds
  for each row execute function public.pf_round_guard();

create or replace function public.pf_rating(p jsonb, k text)
returns text language plpgsql immutable set search_path = '' as $$
declare
  v text := nullif(p->>k, '');
begin
  if v is not null and v not in ('exceeds', 'meets', 'below') then
    raise exception 'Unknown rating %', v using errcode = '22023';
  end if;
  return v;
end $$;

-- Add people to a round. Workers have no self-rating (no login); for staff
-- HR chooses. Their supervisor starts as their own manager. People already in
-- the round are skipped. Returns how many were added.
create or replace function public.pf_add_people(p_round uuid, p_staff uuid[], p_workers uuid[], p_self boolean)
returns int language plpgsql security definer set search_path = '' as $$
declare
  r     public.pf_rounds;
  v_n   int := 0;
  v_add int;
begin
  select * into r from public.pf_rounds where id = p_round for update;
  if r.id is null then raise exception 'Round not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(r.location_id, 'edit') then
    raise exception 'Only HR in this round''s unit can add people' using errcode = '42501';
  end if;
  if r.status not in ('draft', 'open') then
    raise exception 'People are added while a round is draft or open' using errcode = '55000';
  end if;

  insert into public.pf_reviews (round_id, location_id, staff_id, reviewer_id, self_rating, status)
  select r.id, r.location_id, s.id, nullif(s.manager_id, s.id), coalesce(p_self, true),
         case when coalesce(p_self, true) then 'self' else 'supervisor' end
    from public.staff s
   where s.id = any(coalesce(p_staff, '{}')) and s.is_active and s.location_id = r.location_id
     and not exists (select 1 from public.pf_reviews v where v.round_id = r.id and v.staff_id = s.id);
  get diagnostics v_add = row_count;
  v_n := v_n + v_add;

  insert into public.pf_reviews (round_id, location_id, worker_id, reviewer_id, self_rating, status)
  select r.id, r.location_id, w.id, w.manager_id, false, 'supervisor'
    from public.workers w
   where w.id = any(coalesce(p_workers, '{}')) and w.is_active and w.location_id = r.location_id
     and not exists (select 1 from public.pf_reviews v where v.round_id = r.id and v.worker_id = w.id);
  get diagnostics v_add = row_count;
  return v_n + v_add;
end $$;

-- Take a person out of a round — never once their appraisal is with the
-- approver or approved.
create or replace function public.pf_remove_reviews(p_ids uuid[])
returns int language plpgsql security definer set search_path = '' as $$
declare
  v public.pf_reviews;
  v_n int := 0;
begin
  for v in select * from public.pf_reviews where id = any(p_ids) for update loop
    if not public.lc_is_hr(v.location_id, 'edit') then
      raise exception 'Only HR in this unit can remove people from a round' using errcode = '42501';
    end if;
    if v.status in ('pending_approval', 'approved') then
      raise exception 'An appraisal with the approver, or approved, stays in the round' using errcode = '55000';
    end if;
    delete from public.pf_reviews where id = v.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- Change who rates them (HR, bulk).
create or replace function public.pf_set_reviewer(p_ids uuid[], p_reviewer uuid)
returns int language plpgsql security definer set search_path = '' as $$
declare
  v public.pf_reviews;
  v_n int := 0;
begin
  if p_reviewer is not null and not exists (select 1 from public.staff s where s.id = p_reviewer and s.is_active) then
    raise exception 'The supervisor must be active staff' using errcode = '23503';
  end if;
  for v in select * from public.pf_reviews where id = any(p_ids) for update loop
    if not public.lc_is_hr(v.location_id, 'edit') then
      raise exception 'Only HR in this unit can change the supervisor' using errcode = '42501';
    end if;
    if v.status in ('pending_approval', 'approved') then
      raise exception 'An appraisal with the approver, or approved, keeps its supervisor' using errcode = '55000';
    end if;
    if p_reviewer is not null and p_reviewer = v.staff_id then
      raise exception 'Nobody rates themself as their own supervisor' using errcode = '22023';
    end if;
    update public.pf_reviews set reviewer_id = p_reviewer where id = v.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- The person's own rating (or HR entering it from the paper sheet). Saved as
-- a draft, or submitted to the supervisor.
create or replace function public.pf_save_self(p_id uuid, p jsonb, p_submit boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v  public.pf_reviews;
  r  public.pf_rounds;
  q  text := public.pf_rating(p, 'quality');
  o  text := public.pf_rating(p, 'output');
  d  text := public.pf_rating(p, 'discipline');
  t  text := public.pf_rating(p, 'teamwork');
begin
  select * into v from public.pf_reviews where id = p_id for update;
  if v.id is null then raise exception 'Appraisal not found' using errcode = '23503'; end if;
  select * into r from public.pf_rounds where id = v.round_id;
  if not ((v.staff_id is not null and v.staff_id = public.timeoff_my_staff_id())
          or public.lc_is_hr(v.location_id, 'edit')) then
    raise exception 'Only the person, or HR in this unit, can enter the self-rating' using errcode = '42501';
  end if;
  if r.status <> 'open' then
    raise exception 'Self-rating is closed for round %', r.code using errcode = '55000';
  end if;
  if v.status <> 'self' then
    raise exception 'The self-rating has already gone to the supervisor' using errcode = '55000';
  end if;
  if coalesce(p_submit, false) and (q is null or o is null or d is null or t is null) then
    raise exception 'Rate all four areas before sending it on' using errcode = '22023';
  end if;
  update public.pf_reviews
     set self_quality = q, self_output = o, self_discipline = d, self_teamwork = t,
         self_comment = nullif(upper(btrim(coalesce(p->>'comment', ''))), ''),
         self_by = auth.uid(),
         self_at = case when coalesce(p_submit, false) then now() else self_at end,
         status = case when coalesce(p_submit, false) then 'supervisor' else status end
   where id = v.id;
end $$;

-- The supervisor's rating (or HR entering it). Submitting scores it and sends
-- it to the approver.
create or replace function public.pf_save_supervisor(p_id uuid, p jsonb, p_submit boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v       public.pf_reviews;
  r       public.pf_rounds;
  pp      record;
  q       text := public.pf_rating(p, 'quality');
  o       text := public.pf_rating(p, 'output');
  d       text := public.pf_rating(p, 'discipline');
  t       text := public.pf_rating(p, 'teamwork');
  v_score numeric := public.pf_score(q, o, d, t);
  v_me    uuid := public.timeoff_my_staff_id();
begin
  select * into v from public.pf_reviews where id = p_id for update;
  if v.id is null then raise exception 'Appraisal not found' using errcode = '23503'; end if;
  select * into r from public.pf_rounds where id = v.round_id;
  if not ((v_me is not null and v.reviewer_id = v_me) or public.lc_is_hr(v.location_id, 'edit')) then
    raise exception 'Only their supervisor, or HR in this unit, can rate this appraisal' using errcode = '42501';
  end if;
  if v_me is not null and v.staff_id = v_me then
    raise exception 'Nobody gives their own supervisor rating' using errcode = '42501';
  end if;
  if r.status not in ('open', 'locked') then
    raise exception 'Round % is %', r.code, r.status using errcode = '55000';
  end if;
  if v.status <> 'supervisor' then
    raise exception 'This appraisal is not with the supervisor' using errcode = '55000';
  end if;
  if coalesce(p_submit, false) and v_score is null then
    raise exception 'Rate all four areas before sending it for approval' using errcode = '22023';
  end if;
  update public.pf_reviews
     set sup_quality = q, sup_output = o, sup_discipline = d, sup_teamwork = t,
         sup_comment = nullif(upper(btrim(coalesce(p->>'comment', ''))), ''),
         strengths = nullif(upper(btrim(coalesce(p->>'strengths', ''))), ''),
         improvements = nullif(upper(btrim(coalesce(p->>'improvements', ''))), ''),
         sup_by = auth.uid(),
         sup_at = case when coalesce(p_submit, false) then now() else sup_at end,
         final_score = v_score,
         status = case when coalesce(p_submit, false) then 'pending_approval' else status end
   where id = v.id;

  if coalesce(p_submit, false) then
    select * into pp from public.timeoff_person(v.staff_id, v.worker_id);
    perform public.approval_start_run(
      'pf_review', 'pf_reviews', v.id,
      jsonb_build_object('person_name', pp.name, 'person_code', pp.code, 'round', r.name, 'round_code', r.code,
                         'score', v_score),
      jsonb_build_object('location_id', v.location_id), null, auth.uid());
  end if;
end $$;

-- The supervisor (or HR) sends a self-rating back to the person.
create or replace function public.pf_send_back(p_id uuid, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v    public.pf_reviews;
  r    public.pf_rounds;
  v_me uuid := public.timeoff_my_staff_id();
begin
  select * into v from public.pf_reviews where id = p_id for update;
  if v.id is null then raise exception 'Appraisal not found' using errcode = '23503'; end if;
  select * into r from public.pf_rounds where id = v.round_id;
  if not ((v_me is not null and v.reviewer_id = v_me) or public.lc_is_hr(v.location_id, 'edit')) then
    raise exception 'Only their supervisor, or HR in this unit, can send it back' using errcode = '42501';
  end if;
  if v.status <> 'supervisor' or not v.self_rating then
    raise exception 'Only a self-rating waiting with the supervisor can be sent back' using errcode = '55000';
  end if;
  if r.status <> 'open' then
    raise exception 'Self-rating is closed for round %', r.code using errcode = '55000';
  end if;
  if btrim(coalesce(p_note, '')) = '' then raise exception 'Say why' using errcode = '22023'; end if;
  update public.pf_reviews set status = 'self', self_at = null, returned_note = upper(btrim(p_note)) where id = v.id;
end $$;

-- Take an appraisal back from the approver (its run is cancelled; it returns
-- to the supervisor).
create or replace function public.pf_recall_review(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v     public.pf_reviews;
  v_run public.approval_runs;
  v_me  uuid := public.timeoff_my_staff_id();
begin
  select * into v from public.pf_reviews where id = p_id for update;
  if v.id is null then raise exception 'Appraisal not found' using errcode = '23503'; end if;
  if not ((v_me is not null and v.reviewer_id = v_me) or public.lc_is_hr(v.location_id, 'edit')) then
    raise exception 'Only their supervisor, or HR in this unit, can recall it' using errcode = '42501';
  end if;
  if v.status <> 'pending_approval' then raise exception 'Nothing is waiting for approval' using errcode = '55000'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why' using errcode = '22023'; end if;
  select * into v_run from public.approval_runs
   where subject_table = 'pf_reviews' and subject_id = v.id and status = 'in_progress'
   order by started_at desc limit 1 for update;
  if v_run.id is null then raise exception 'It has no open approval — reload' using errcode = '55000'; end if;
  insert into public.approval_run_events (run_id, step_order, action, actor_id, comment)
  values (v_run.id, v_run.current_step, 'cancel', auth.uid(), upper(btrim(p_reason)));
  -- the terminal trigger runs pf_review_apply_decision('cancelled')
  update public.approval_runs
     set status = 'cancelled', completed_at = now(), lock_version = lock_version + 1
   where id = v_run.id;
end $$;

-- The approver's decision. Approved → done. Turned down or recalled → back to
-- the supervisor, with the approver's words.
create or replace function public.pf_review_apply_decision(
  p_id uuid, p_run_status text, p_actor uuid, p_remark text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v public.pf_reviews;
begin
  select * into v from public.pf_reviews where id = p_id for update;
  if v.id is null or v.status <> 'pending_approval' then
    raise exception 'Appraisal % is not awaiting a decision — reload', p_id using errcode = '55000';
  end if;
  if p_run_status = 'completed' then
    update public.pf_reviews
       set status = 'approved', approved_by = p_actor, approved_at = p_at,
           decision_remark = nullif(upper(btrim(coalesce(p_remark, ''))), '')
     where id = v.id;
  else
    update public.pf_reviews
       set status = 'supervisor', sup_at = null,
           returned_note = case when p_run_status = 'rejected'
                                then coalesce(nullif(upper(btrim(coalesce(p_remark, ''))), ''), 'SENT BACK BY THE APPROVER')
                                else returned_note end,
           decision_remark = nullif(upper(btrim(coalesce(p_remark, ''))), '')
     where id = v.id;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Promotions
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.seq_pf_promotion;

create table if not exists public.pf_promotions (
  id                   uuid primary key default gen_random_uuid(),
  code                 text,
  location_id          uuid not null references public.locations(id),
  staff_id             uuid references public.staff(id),
  worker_id            uuid references public.workers(id),
  from_designation_id  uuid references public.designations(id),
  to_designation_id    uuid not null references public.designations(id),
  current_salary       numeric(12,2),
  salary_basis         text check (salary_basis is null or salary_basis in ('monthly', 'daily')),
  proposed_salary      numeric(12,2) check (proposed_salary is null or proposed_salary > 0),
  effective_date       date not null,
  reason               text not null check (btrim(reason) <> ''),
  review_id            uuid references public.pf_reviews(id),
  status               text not null default 'pending_approval'
                       check (status in ('pending_approval', 'approved', 'rejected', 'withdrawn')),
  approved_by          uuid,
  approved_at          timestamptz,
  decision_remark      text,
  designation_applied  boolean not null default false,
  withdrawn_reason     text,
  created_by           uuid default auth.uid(),
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now(),
  constraint pf_promo_person check (num_nonnulls(staff_id, worker_id) = 1)
);
comment on table public.pf_promotions is
  'HR ▸ Performance & Growth — promotions, approved through the engine; approval sets the designation. Written only by pf_* functions. 0773.';
create index if not exists idx_pf_promo_loc on public.pf_promotions (location_id, status);
-- One promotion waiting per person.
create unique index if not exists uq_pf_promo_open_staff on public.pf_promotions (staff_id)
  where staff_id is not null and status = 'pending_approval';
create unique index if not exists uq_pf_promo_open_worker on public.pf_promotions (worker_id)
  where worker_id is not null and status = 'pending_approval';
drop trigger if exists trg_pf_promo_code on public.pf_promotions;
create trigger trg_pf_promo_code before insert on public.pf_promotions
  for each row execute function public.assign_code('PRM', 'public.seq_pf_promotion');
drop trigger if exists trg_pf_promo_updated on public.pf_promotions;
create trigger trg_pf_promo_updated before update on public.pf_promotions
  for each row execute function public.set_updated_at();

-- HR raises a promotion; it goes straight to the approver.
create or replace function public.pf_raise_promotion(p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  v_staff  uuid := nullif(p->>'staff_id', '')::uuid;
  v_worker uuid := nullif(p->>'worker_id', '')::uuid;
  v_to     uuid := nullif(p->>'to_designation_id', '')::uuid;
  v_sal    numeric := nullif(p->>'proposed_salary', '')::numeric;
  v_eff    date := nullif(p->>'effective_date', '')::date;
  v_reason text := upper(btrim(coalesce(p->>'reason', '')));
  v_review uuid := nullif(p->>'review_id', '')::uuid;
  pp       record;
  rl       record;
  dt       public.designations;
  v_from   text;
  v_id     uuid;
begin
  if num_nonnulls(v_staff, v_worker) <> 1 then raise exception 'Pick the person' using errcode = '22023'; end if;
  select * into pp from public.timeoff_person(v_staff, v_worker);
  if pp.name is null then raise exception 'That person was not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(pp.location_id, 'edit') then
    raise exception 'Only HR in this person''s unit can raise a promotion' using errcode = '42501';
  end if;
  if not pp.is_active then raise exception '% is not active', pp.name using errcode = '55000'; end if;
  select * into rl from public.pf_person_role(v_staff, v_worker);
  select * into dt from public.designations where id = v_to;
  if dt.id is null then raise exception 'Pick the new designation' using errcode = '22023'; end if;
  if coalesce(dt.inactive, false) or coalesce(dt.is_draft, false) then
    raise exception 'Designation % is not in use', dt.name using errcode = '55000';
  end if;
  if not (dt.for_type = 'staff_worker' or (dt.for_type = 'staff') = (v_staff is not null)) then
    raise exception '% is a % designation', dt.name, case when dt.for_type = 'staff' then 'staff' else 'worker' end
      using errcode = '22023';
  end if;
  if rl.designation_id is not distinct from v_to then
    raise exception '% is already %', pp.name, dt.name using errcode = '22023';
  end if;
  if v_eff is null then raise exception 'Enter the date it takes effect' using errcode = '22023'; end if;
  if v_reason = '' then raise exception 'Say why they are being promoted' using errcode = '22023'; end if;
  if v_review is not null and not exists (select 1 from public.pf_reviews x
                                           where x.id = v_review and x.status = 'approved'
                                             and coalesce(x.staff_id, x.worker_id) = coalesce(v_staff, v_worker)) then
    raise exception 'That appraisal is not an approved appraisal of %', pp.name using errcode = '22023';
  end if;
  if exists (select 1 from public.pf_promotions x
              where x.status = 'pending_approval' and coalesce(x.staff_id, x.worker_id) = coalesce(v_staff, v_worker)) then
    raise exception '% already has a promotion waiting for approval', pp.name using errcode = '23505';
  end if;

  insert into public.pf_promotions
    (location_id, staff_id, worker_id, from_designation_id, to_designation_id, current_salary, salary_basis,
     proposed_salary, effective_date, reason, review_id)
  values
    (pp.location_id, v_staff, v_worker, rl.designation_id, v_to, rl.salary, rl.basis,
     v_sal, v_eff, v_reason, v_review)
  returning id into v_id;

  select d.name into v_from from public.designations d where d.id = rl.designation_id;
  perform public.approval_start_run(
    'pf_promotion', 'pf_promotions', v_id,
    jsonb_build_object('person_name', pp.name, 'person_code', pp.code, 'from', v_from, 'to', dt.name,
                       'proposed_salary', v_sal, 'basis', rl.basis, 'effective_date', v_eff),
    jsonb_build_object('location_id', pp.location_id), null, auth.uid());
  return v_id;
end $$;

-- HR withdraws a promotion waiting for approval.
create or replace function public.pf_withdraw_promotion(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m     public.pf_promotions;
  v_run public.approval_runs;
begin
  select * into m from public.pf_promotions where id = p_id for update;
  if m.id is null then raise exception 'Promotion not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(m.location_id, 'edit') then
    raise exception 'Only HR in this unit can withdraw a promotion' using errcode = '42501';
  end if;
  if m.status <> 'pending_approval' then raise exception 'Only a promotion waiting for approval can be withdrawn' using errcode = '55000'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why' using errcode = '22023'; end if;
  update public.pf_promotions set withdrawn_reason = upper(btrim(p_reason)) where id = m.id;
  select * into v_run from public.approval_runs
   where subject_table = 'pf_promotions' and subject_id = m.id and status = 'in_progress'
   order by started_at desc limit 1 for update;
  if v_run.id is null then raise exception 'It has no open approval — reload' using errcode = '55000'; end if;
  insert into public.approval_run_events (run_id, step_order, action, actor_id, comment)
  values (v_run.id, v_run.current_step, 'cancel', auth.uid(), upper(btrim(p_reason)));
  -- the terminal trigger runs pf_promotion_apply_decision('cancelled')
  update public.approval_runs
     set status = 'cancelled', completed_at = now(), lock_version = lock_version + 1
   where id = v_run.id;
end $$;

-- The approver's decision. Approved → the person's designation becomes the
-- new one. The salary is NOT changed here — that stays on Pay ▸ Salary
-- Registry, where every salary is kept.
create or replace function public.pf_promotion_apply_decision(
  p_id uuid, p_run_status text, p_actor uuid, p_remark text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  m public.pf_promotions;
begin
  select * into m from public.pf_promotions where id = p_id for update;
  if m.id is null or m.status <> 'pending_approval' then
    raise exception 'Promotion % is not awaiting a decision — reload', p_id using errcode = '55000';
  end if;
  if p_run_status = 'completed' then
    if m.staff_id is not null then
      update public.staff set designation_id = m.to_designation_id where id = m.staff_id;
    else
      update public.workers set designation_id = m.to_designation_id where id = m.worker_id;
    end if;
    update public.pf_promotions
       set status = 'approved', approved_by = p_actor, approved_at = p_at, designation_applied = true,
           decision_remark = nullif(upper(btrim(coalesce(p_remark, ''))), '')
     where id = m.id;
  elsif p_run_status = 'rejected' then
    update public.pf_promotions
       set status = 'rejected', decision_remark = nullif(upper(btrim(coalesce(p_remark, ''))), '')
     where id = m.id;
  else
    update public.pf_promotions
       set status = 'withdrawn', withdrawn_reason = coalesce(withdrawn_reason, nullif(upper(btrim(coalesce(p_remark, ''))), ''))
     where id = m.id;
  end if;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Training
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.seq_pf_training;

create table if not exists public.pf_trainings (
  id             uuid primary key default gen_random_uuid(),
  code           text,
  location_id    uuid not null default public.current_location() references public.locations(id),
  title          text not null check (btrim(title) <> ''),
  category       text not null default 'skill'
                 check (category in ('safety', 'quality', 'machine', 'skill', 'compliance', 'soft_skills', 'induction', 'other')),
  trainer        text,
  venue          text,
  starts_on      date not null,
  ends_on        date not null,
  hours          numeric(5,1) check (hours is null or hours > 0),
  seats          int check (seats is null or seats between 1 and 1000),
  description    text,
  status         text not null default 'draft'
                 check (status in ('draft', 'open', 'in_progress', 'completed', 'cancelled')),
  cancel_reason  text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint pf_training_dates check (ends_on >= starts_on)
);
comment on table public.pf_trainings is 'HR ▸ Performance & Growth — training sessions, per unit. 0773.';
create index if not exists idx_pf_training_loc on public.pf_trainings (location_id, starts_on desc);
drop trigger if exists trg_pf_training_code on public.pf_trainings;
create trigger trg_pf_training_code before insert on public.pf_trainings
  for each row execute function public.assign_code('TRN', 'public.seq_pf_training');
drop trigger if exists trg_pf_training_updated on public.pf_trainings;
create trigger trg_pf_training_updated before update on public.pf_trainings
  for each row execute function public.set_updated_at();

create table if not exists public.pf_enrolments (
  id                uuid primary key default gen_random_uuid(),
  training_id       uuid not null references public.pf_trainings(id) on delete cascade,
  location_id       uuid not null references public.locations(id),
  staff_id          uuid references public.staff(id),
  worker_id         uuid references public.workers(id),
  status            text not null default 'registered'
                    check (status in ('registered', 'attended', 'completed', 'dropped')),
  remark            text,
  completed_on      date,
  certificate_path  text unique,
  certificate_name  text,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint pf_enrol_person check (num_nonnulls(staff_id, worker_id) = 1)
);
comment on table public.pf_enrolments is 'HR ▸ Performance & Growth — who is on a training, and how far they got. 0773.';
create unique index if not exists uq_pf_enrol_staff  on public.pf_enrolments (training_id, staff_id)  where staff_id is not null;
create unique index if not exists uq_pf_enrol_worker on public.pf_enrolments (training_id, worker_id) where worker_id is not null;
create index if not exists idx_pf_enrol_staff  on public.pf_enrolments (staff_id)  where staff_id is not null;
create index if not exists idx_pf_enrol_worker on public.pf_enrolments (worker_id) where worker_id is not null;
drop trigger if exists trg_pf_enrol_updated on public.pf_enrolments;
create trigger trg_pf_enrol_updated before update on public.pf_enrolments
  for each row execute function public.set_updated_at();

-- A training's status map, and its capitals:
--   draft → open · cancelled        open → draft · in_progress · cancelled
--   in_progress → completed · cancelled            completed / cancelled: final
create or replace function public.pf_training_guard()
returns trigger language plpgsql set search_path = '' as $$
declare
  v_taken int;
begin
  new.title := upper(btrim(new.title));
  new.trainer := nullif(upper(btrim(coalesce(new.trainer, ''))), '');
  new.venue := nullif(upper(btrim(coalesce(new.venue, ''))), '');
  new.description := nullif(upper(btrim(coalesce(new.description, ''))), '');
  new.cancel_reason := nullif(upper(btrim(coalesce(new.cancel_reason, ''))), '');
  if tg_op = 'INSERT' then
    if new.status not in ('draft', 'open') then new.status := 'draft'; end if;
    return new;
  end if;
  if new.location_id <> old.location_id then
    raise exception 'A training stays in its own unit' using errcode = '55000';
  end if;
  if old.status in ('completed', 'cancelled') and new is distinct from old then
    raise exception 'Training % is %', old.code, old.status using errcode = '55000';
  end if;
  if new.status <> old.status then
    if not ((old.status = 'draft' and new.status in ('open', 'cancelled'))
         or (old.status = 'open' and new.status in ('draft', 'in_progress', 'cancelled'))
         or (old.status = 'in_progress' and new.status in ('completed', 'cancelled'))) then
      raise exception 'A % training cannot be moved to %', replace(old.status, '_', ' '), replace(new.status, '_', ' ')
        using errcode = '55000';
    end if;
    if new.status = 'cancelled' and new.cancel_reason is null then
      raise exception 'Say why it is cancelled' using errcode = '22023';
    end if;
  end if;
  if new.status <> 'cancelled' then new.cancel_reason := null; end if;
  if new.seats is not null then
    select count(*) into v_taken from public.pf_enrolments e where e.training_id = new.id and e.status <> 'dropped';
    if v_taken > new.seats then
      raise exception '% people are already on it — the seats cannot go below that', v_taken using errcode = '22023';
    end if;
  end if;
  return new;
end $$;
drop trigger if exists trg_pf_training_guard on public.pf_trainings;
create trigger trg_pf_training_guard before insert or update on public.pf_trainings
  for each row execute function public.pf_training_guard();

-- An enrolment's rules: people join while the training is draft / open / in
-- progress, within its seats, from its own unit; attended / completed only
-- once it has started; a certificate only from the training's own folder.
create or replace function public.pf_enrolment_guard()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  t       public.pf_trainings;
  pp      record;
  v_taken int;
  v_owner uuid;
begin
  select * into t from public.pf_trainings where id = new.training_id;
  if t.id is null then raise exception 'Training not found' using errcode = '23503'; end if;
  new.location_id := t.location_id;
  new.remark := nullif(upper(btrim(coalesce(new.remark, ''))), '');
  if tg_op = 'INSERT' then
    if t.status not in ('draft', 'open', 'in_progress') then
      raise exception 'Training % is %, so nobody can join it', t.code, t.status using errcode = '55000';
    end if;
    select * into pp from public.timeoff_person(new.staff_id, new.worker_id);
    if pp.name is null then raise exception 'That person was not found' using errcode = '23503'; end if;
    if not pp.is_active then raise exception '% is not active', pp.name using errcode = '55000'; end if;
    if pp.location_id is distinct from t.location_id then
      raise exception '% is not in this training''s unit', pp.name using errcode = '22023';
    end if;
  else
    if new.training_id <> old.training_id or new.staff_id is distinct from old.staff_id
       or new.worker_id is distinct from old.worker_id then
      raise exception 'An enrolment stays with its training and person' using errcode = '55000';
    end if;
    if t.status = 'cancelled' then raise exception 'Training % is cancelled', t.code using errcode = '55000'; end if;
  end if;
  if new.status in ('attended', 'completed') and t.status not in ('in_progress', 'completed') then
    raise exception 'Start the training before marking attendance' using errcode = '55000';
  end if;
  if new.status = 'completed' then
    new.completed_on := coalesce(new.completed_on, least(t.ends_on, public.timeoff_today()));
  else
    new.completed_on := null;
  end if;
  if t.seats is not null and new.status <> 'dropped' and (tg_op = 'INSERT' or old.status = 'dropped') then
    select count(*) into v_taken from public.pf_enrolments e
     where e.training_id = t.id and e.status <> 'dropped' and e.id <> new.id;
    if v_taken >= t.seats then
      raise exception 'Training % is full (% seats)', t.code, t.seats using errcode = '23505';
    end if;
  end if;
  if new.certificate_path is not null and (tg_op = 'INSERT' or new.certificate_path is distinct from old.certificate_path) then
    if left(new.certificate_path, length(t.location_id::text || '/' || t.id::text || '/')) <> t.location_id::text || '/' || t.id::text || '/' then
      raise exception 'That certificate was not uploaded for this training' using errcode = '22023';
    end if;
    select so.owner into v_owner from storage.objects so
     where so.bucket_id = 'hr-training-certs' and so.name = new.certificate_path;
    if not found then raise exception 'The certificate upload was not found — choose the file again' using errcode = '23503'; end if;
    if v_owner is distinct from auth.uid() then
      raise exception 'That certificate was uploaded by someone else' using errcode = '42501';
    end if;
  end if;
  if new.certificate_path is null then new.certificate_name := null; end if;
  return new;
end $$;
drop trigger if exists trg_pf_enrolment_guard on public.pf_enrolments;
create trigger trg_pf_enrolment_guard before insert or update on public.pf_enrolments
  for each row execute function public.pf_enrolment_guard();

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Certificates — private bucket
-- ════════════════════════════════════════════════════════════════════════════

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-training-certs', 'hr-training-certs', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Key shape: <location_id>/<training_id>/<uuid>.<ext>. The unit in the key
-- must be the training's own unit, and the caller HR in it.
create or replace function public.pf_cert_key_ok(p_name text, p_action text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  parts   text[] := string_to_array(p_name, '/');
  v_loc   uuid;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if coalesce(array_length(parts, 1), 0) <> 3 then return false; end if;
  if parts[1] !~* uuid_re or parts[2] !~* uuid_re then return false; end if;
  select t.location_id into v_loc from public.pf_trainings t where t.id = parts[2]::uuid;
  if v_loc is null or v_loc <> parts[1]::uuid then return false; end if;
  return public.has_permission('hr_payroll', p_action) and public.is_current_location(v_loc);
end $$;

drop policy if exists hr_certs_insert on storage.objects;
create policy hr_certs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-training-certs' and public.pf_cert_key_ok(name, 'edit'));

-- HR in the unit, or the person the certificate belongs to.
drop policy if exists hr_certs_read on storage.objects;
create policy hr_certs_read on storage.objects for select to authenticated
  using (bucket_id = 'hr-training-certs'
         and (public.pf_cert_key_ok(name, 'view')
              or exists (select 1 from public.pf_enrolments e
                          where e.certificate_path = storage.objects.name
                            and e.staff_id is not null and e.staff_id = public.timeoff_my_staff_id())));

-- Only a file no enrolment points at — an abandoned or replaced upload.
drop policy if exists hr_certs_delete on storage.objects;
create policy hr_certs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hr-training-certs' and public.pf_cert_key_ok(name, 'edit')
         and not exists (select 1 from public.pf_enrolments e where e.certificate_path = storage.objects.name));

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Engine wiring — terminal branches + default flows
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_def    text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
  v_anchor text := E'    raise exception\n        ''approval_apply_terminal: no terminal callback';
  v_branch text := E'    if new.subject_table = ''pf_reviews'' then\n'
                || E'        perform public.pf_review_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark, coalesce(new.completed_at, now()));\n'
                || E'        return new;\n'
                || E'    end if;\n\n'
                || E'    if new.subject_table = ''pf_promotions'' then\n'
                || E'        perform public.pf_promotion_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark, coalesce(new.completed_at, now()));\n'
                || E'        return new;\n'
                || E'    end if;\n\n';
begin
  if position('''pf_reviews''' in v_def) > 0 then
    return;  -- already there (a re-run)
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0773: approval_apply_terminal''s final refusal was not found — add the pf branches by hand.';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'pf_review', 'Appraisal — default',
       'Catch-all. Every appraisal the supervisor sends on goes to the Managing Director or an HR Manager. Add steps or criteria here if wanted.',
       '{}'::jsonb,
       coalesce((select f.steps from public.approval_flows f
                  where f.workflow_key = 'hr_fine' and f.flow_name = 'HR Fine — default' limit 1),
                '[{"step_order":1,"step_type":"final","step_label":"MD / HR Manager","approver_resolver":"md_or_hr_manager"}]'::jsonb),
       900, true
 where not exists (select 1 from public.approval_flows x where x.workflow_key = 'pf_review');

insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select 'pf_promotion', 'Promotion — default',
       'Catch-all. Every promotion HR raises goes to the Managing Director or an HR Manager; approving it sets the new designation.',
       '{}'::jsonb,
       coalesce((select f.steps from public.approval_flows f
                  where f.workflow_key = 'hr_fine' and f.flow_name = 'HR Fine — default' limit 1),
                '[{"step_order":1,"step_type":"final","step_label":"MD / HR Manager","approver_resolver":"md_or_hr_manager"}]'::jsonb),
       900, true
 where not exists (select 1 from public.approval_flows x where x.workflow_key = 'pf_promotion');

-- ════════════════════════════════════════════════════════════════════════════
-- 7. RLS + grants
-- ════════════════════════════════════════════════════════════════════════════

alter table public.pf_rounds      enable row level security;
alter table public.pf_reviews     enable row level security;
alter table public.pf_promotions  enable row level security;
alter table public.pf_trainings   enable row level security;
alter table public.pf_enrolments  enable row level security;

-- Rounds: HR in the unit writes; anyone with an appraisal in a round (the
-- person, or their supervisor) reads it. Only a draft is deleted, and only
-- while nobody is in it (the FK refuses otherwise).
drop policy if exists pf_round_read on public.pf_rounds;
drop policy if exists pf_round_ins  on public.pf_rounds;
drop policy if exists pf_round_upd  on public.pf_rounds;
drop policy if exists pf_round_del  on public.pf_rounds;
create policy pf_round_read on public.pf_rounds for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or exists (select 1 from public.pf_reviews v
                     where v.round_id = pf_rounds.id
                       and public.timeoff_my_staff_id() in (v.staff_id, v.reviewer_id)));
create policy pf_round_ins on public.pf_rounds for insert
  with check (public.has_permission('hr_payroll', 'create') and public.is_current_location(location_id));
create policy pf_round_upd on public.pf_rounds for update
  using (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id))
  with check (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id));
create policy pf_round_del on public.pf_rounds for delete
  using (public.has_permission('hr_payroll', 'delete') and public.is_current_location(location_id) and status = 'draft');

-- Appraisals: HR in the unit; the person; their supervisor.
drop policy if exists pf_review_read on public.pf_reviews;
create policy pf_review_read on public.pf_reviews for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or (staff_id is not null and staff_id = public.timeoff_my_staff_id())
         or (reviewer_id is not null and reviewer_id = public.timeoff_my_staff_id()));

drop policy if exists pf_promo_read on public.pf_promotions;
create policy pf_promo_read on public.pf_promotions for select
  using (public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id));

-- Training: HR in the unit writes; a person reads the trainings they are on.
drop policy if exists pf_training_read on public.pf_trainings;
drop policy if exists pf_training_ins  on public.pf_trainings;
drop policy if exists pf_training_upd  on public.pf_trainings;
drop policy if exists pf_training_del  on public.pf_trainings;
create policy pf_training_read on public.pf_trainings for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or exists (select 1 from public.pf_enrolments e
                     where e.training_id = pf_trainings.id and e.staff_id is not null
                       and e.staff_id = public.timeoff_my_staff_id()));
create policy pf_training_ins on public.pf_trainings for insert
  with check (public.has_permission('hr_payroll', 'create') and public.is_current_location(location_id));
create policy pf_training_upd on public.pf_trainings for update
  using (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id))
  with check (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id));
create policy pf_training_del on public.pf_trainings for delete
  using (public.has_permission('hr_payroll', 'delete') and public.is_current_location(location_id) and status = 'draft');

drop policy if exists pf_enrol_read on public.pf_enrolments;
drop policy if exists pf_enrol_ins  on public.pf_enrolments;
drop policy if exists pf_enrol_upd  on public.pf_enrolments;
drop policy if exists pf_enrol_del  on public.pf_enrolments;
create policy pf_enrol_read on public.pf_enrolments for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or (staff_id is not null and staff_id = public.timeoff_my_staff_id()));
create policy pf_enrol_ins on public.pf_enrolments for insert
  with check (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id));
create policy pf_enrol_upd on public.pf_enrolments for update
  using (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id))
  with check (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id));
-- Taking someone off is "dropped" once the training has started; a straight
-- delete is only for an entry made by mistake before then.
create policy pf_enrol_del on public.pf_enrolments for delete
  using (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id)
         and status = 'registered'
         and exists (select 1 from public.pf_trainings t where t.id = training_id and t.status in ('draft', 'open')));

revoke insert, update, delete on public.pf_reviews    from anon, authenticated;
revoke insert, update, delete on public.pf_promotions from anon, authenticated;

revoke all on function public.pf_score(text, text, text, text)                 from public, anon;
revoke all on function public.pf_person_role(uuid, uuid)                       from public, anon, authenticated;
revoke all on function public.pf_round_guard()                                 from public, anon, authenticated;
revoke all on function public.pf_rating(jsonb, text)                           from public, anon, authenticated;
revoke all on function public.pf_add_people(uuid, uuid[], uuid[], boolean)     from public, anon;
revoke all on function public.pf_remove_reviews(uuid[])                        from public, anon;
revoke all on function public.pf_set_reviewer(uuid[], uuid)                    from public, anon;
revoke all on function public.pf_save_self(uuid, jsonb, boolean)               from public, anon;
revoke all on function public.pf_save_supervisor(uuid, jsonb, boolean)         from public, anon;
revoke all on function public.pf_send_back(uuid, text)                         from public, anon;
revoke all on function public.pf_recall_review(uuid, text)                     from public, anon;
revoke all on function public.pf_review_apply_decision(uuid, text, uuid, text, timestamptz)    from public, anon, authenticated;
revoke all on function public.pf_raise_promotion(jsonb)                        from public, anon;
revoke all on function public.pf_withdraw_promotion(uuid, text)                from public, anon;
revoke all on function public.pf_promotion_apply_decision(uuid, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.pf_training_guard()                              from public, anon, authenticated;
revoke all on function public.pf_enrolment_guard()                             from public, anon, authenticated;
revoke all on function public.pf_cert_key_ok(text, text)                       from public, anon;
revoke all on function public.approval_apply_terminal()                        from public, anon;

-- pf_cert_key_ok is read by the storage policies, which run as the caller.
grant execute on function public.pf_cert_key_ok(text, text)                    to authenticated;
grant execute on function public.pf_score(text, text, text, text)              to authenticated;
grant execute on function public.pf_add_people(uuid, uuid[], uuid[], boolean)  to authenticated;
grant execute on function public.pf_remove_reviews(uuid[])                     to authenticated;
grant execute on function public.pf_set_reviewer(uuid[], uuid)                 to authenticated;
grant execute on function public.pf_save_self(uuid, jsonb, boolean)            to authenticated;
grant execute on function public.pf_save_supervisor(uuid, jsonb, boolean)      to authenticated;
grant execute on function public.pf_send_back(uuid, text)                      to authenticated;
grant execute on function public.pf_recall_review(uuid, text)                  to authenticated;
grant execute on function public.pf_raise_promotion(jsonb)                     to authenticated;
grant execute on function public.pf_withdraw_promotion(uuid, text)             to authenticated;
