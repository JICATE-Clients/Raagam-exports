-- 0771 — HR ▸ TEAM LIFECYCLE (MyJKKN HR port, phase 2 — client 2026-10-29)
--
-- A SEPARATE build beside the existing "Lifecycle Events" screen
-- (hr_lifecycle_events), which is untouched. Source: MyJKKN
-- docs/HR-MODULE-SPEC.md §12, rebuilt on Raagam's own people (staff +
-- workers), units and approval engine — and with the gaps that section lists
-- closed rather than copied:
--
--   MyJKKN                                Raagam (this file)
--   ───────────────────────────────────── ────────────────────────────────────
--   hr_onboarding_checklists              lc_checklist_templates
--   (no per-joiner progress table)        lc_onboardings + lc_onboarding_steps
--   hr_required_documents                 lc_required_documents
--   hr_employee_documents (+ bucket)      lc_documents + private bucket hr-people-docs
--   resources (read-only "My Assets")     lc_assets — issue / return / lost,
--                                         and the exit's asset step checks it
--   hr_offboarding_cases                  lc_exits
--   hr_offboarding_step_completions       lc_exit_steps (never written there;
--     (never written)                       ticked here, copied at open)
--   policy hr.offboarding.workflow_steps  lc_exit_step_catalog
--   hr_fnf_calculations                   lc_settlements (approved through the
--                                         engine, then marked paid)
--   termination chain sedc→legal→director a termination exit starts an approval
--                                         run (workflow lc_termination); Admin ▸
--                                         Approval Flows sets its steps
--   retirement cron                       lc_retirements_due() — read on screen,
--                                         no job to forget to schedule
--   hr.retirement.age policy              lc_settings
--
-- NOT ported (Raagam already has its own): the HR Directory (People ▸ Staff /
-- Workers) and photo review (the person photo upload, 0557).
--
-- WHERE EACH RULE LIVES — in the database, as in 0770. Onboarding progress,
-- document registration and review, exits and settlements are written ONLY by
-- the SECURITY DEFINER functions below; authenticated has no insert / update /
-- delete grant on those tables. Catalogs and the asset register are plain
-- table writes under RLS.
--
-- What this file touches outside its own lc_* objects:
--   * approval_apply_terminal() — two branches added by the same anchor
--     replace 0770 used; every existing branch is unchanged.
--   * approval_flows — two catch-all rows, only if none exist for those keys.
--   * storage — one new PRIVATE bucket and its four policies.
--   * staff / workers — READ for names, pay and dates; WRITTEN only when HR
--     completes an exit with "mark as left" ticked (date_of_leaving +
--     is_active = false on that one person). Never by this migration itself.
--
-- Reuses 0770's helpers: timeoff_today(), timeoff_my_staff_id(),
-- timeoff_person(), timeoff_may_act_for(), timeoff_stamp_location(),
-- timeoff_year_of(), timeoff_balance_sheet().

-- ════════════════════════════════════════════════════════════════════════════
-- 0. Settings + helpers
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.lc_settings (
  id                   boolean primary key default true check (id),
  retirement_age       int not null default 60 check (retirement_age between 40 and 80),
  retirement_lookahead int not null default 6  check (retirement_lookahead between 1 and 24),  -- months
  notice_days_staff    int not null default 30 check (notice_days_staff between 0 and 180),
  notice_days_workers  int not null default 15 check (notice_days_workers between 0 and 180),
  gratuity_min_years   int not null default 5  check (gratuity_min_years between 0 and 10),
  gratuity_cap         numeric(14,2) not null default 2000000 check (gratuity_cap >= 0),
  updated_at           timestamptz not null default now()
);
comment on table public.lc_settings is 'HR ▸ Team Lifecycle settings — one row. 0771.';
insert into public.lc_settings (id) values (true) on conflict (id) do nothing;

drop trigger if exists trg_lc_settings_updated on public.lc_settings;
create trigger trg_lc_settings_updated before update on public.lc_settings
  for each row execute function public.set_updated_at();

-- HR in the person's unit (not the person themself).
create or replace function public.lc_is_hr(p_location uuid, p_action text)
returns boolean language sql stable security definer set search_path = '' as $$
  select public.has_permission('hr_payroll', p_action) and public.is_current_location(p_location);
$$;

-- What a settlement is priced on. A monthly-rated person: basic + DA a month
-- (actual, else statutory, else the monthly salary). A worker with no monthly
-- structure: their shift wage a day.
create or replace function public.lc_person_pay(p_staff uuid, p_worker uuid)
returns table (name text, code text, location_id uuid, joined date, birth date,
               rated text, basic_da numeric, daily_wage numeric)
language sql stable security definer set search_path = '' as $$
  select s.name, s.code, s.location_id, s.joined_date, s.date_of_birth, 'monthly',
         coalesce(nullif(coalesce(s.act_basic, 0) + coalesce(s.act_da, 0), 0),
                  nullif(coalesce(s.stat_basic, 0) + coalesce(s.stat_da, 0), 0),
                  coalesce(s.monthly_salary, 0)),
         0::numeric
    from public.staff s where p_staff is not null and s.id = p_staff
  union all
  select w.name, w.code, w.location_id, w.joined_date, w.date_of_birth,
         case when coalesce(w.act_basic, 0) + coalesce(w.act_da, 0) > 0 then 'monthly' else 'daily' end,
         coalesce(w.act_basic, 0) + coalesce(w.act_da, 0),
         coalesce(w.shift_wage_per_day, 0)
    from public.workers w where p_worker is not null and w.id = p_worker;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 1. Joining checklists (MyJKKN §12.2) — templates + real per-joiner progress
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.lc_checklist_templates (
  id          uuid primary key default gen_random_uuid(),
  name        text not null unique check (btrim(name) <> ''),
  applies_to  text not null default 'both' check (applies_to in ('both', 'staff', 'workers')),
  -- [{ "title": text, "due_day": int (days after joining), "owner": text }]
  steps       jsonb not null default '[]'::jsonb check (jsonb_typeof(steps) = 'array'),
  is_active   boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.lc_checklist_templates is 'HR ▸ Team Lifecycle joining checklist templates. Shared across units. 0771.';
drop trigger if exists trg_lc_tpl_updated on public.lc_checklist_templates;
create trigger trg_lc_tpl_updated before update on public.lc_checklist_templates
  for each row execute function public.set_updated_at();

insert into public.lc_checklist_templates (name, applies_to, steps)
select v.name, v.applies_to, v.steps::jsonb
  from (values
    ('STAFF JOINING', 'staff',
     '[{"title":"OFFER LETTER SIGNED","due_day":0,"owner":"HR"},
       {"title":"ID PROOF, ADDRESS PROOF AND CERTIFICATES COLLECTED","due_day":0,"owner":"HR"},
       {"title":"BANK ACCOUNT DETAILS ENTERED","due_day":1,"owner":"HR"},
       {"title":"PF / ESI ENROLMENT","due_day":7,"owner":"HR"},
       {"title":"BIOMETRIC ENROLLED","due_day":1,"owner":"HR"},
       {"title":"ID CARD ISSUED","due_day":3,"owner":"HR"},
       {"title":"SYSTEM LOGIN CREATED","due_day":1,"owner":"ADMIN"},
       {"title":"INDUCTION AND SAFETY BRIEFING","due_day":1,"owner":"DEPARTMENT HEAD"}]'),
    ('WORKER JOINING', 'workers',
     '[{"title":"AADHAAR AND PHOTO COLLECTED","due_day":0,"owner":"HR"},
       {"title":"AGE PROOF CHECKED","due_day":0,"owner":"HR"},
       {"title":"BANK ACCOUNT DETAILS ENTERED","due_day":1,"owner":"HR"},
       {"title":"ESI / PF ENROLMENT","due_day":7,"owner":"HR"},
       {"title":"BIOMETRIC ENROLLED","due_day":0,"owner":"HR"},
       {"title":"ID CARD AND UNIFORM ISSUED","due_day":3,"owner":"HR"},
       {"title":"SAFETY AND MACHINE INDUCTION","due_day":1,"owner":"SUPERVISOR"}]')
  ) as v(name, applies_to, steps)
 where not exists (select 1 from public.lc_checklist_templates);

create sequence if not exists public.seq_lc_onboarding;

create table if not exists public.lc_onboardings (
  id             uuid primary key default gen_random_uuid(),
  code           text,
  staff_id       uuid references public.staff(id),
  worker_id      uuid references public.workers(id),
  location_id    uuid not null references public.locations(id),
  template_id    uuid references public.lc_checklist_templates(id) on delete set null,
  template_name  text not null,
  start_date     date not null,
  status         text not null default 'in_progress' check (status in ('in_progress', 'completed', 'cancelled')),
  completed_at   timestamptz,
  cancel_reason  text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  constraint lc_onb_person check (num_nonnulls(staff_id, worker_id) = 1)
);
comment on table public.lc_onboardings is 'HR ▸ Team Lifecycle — one joiner''s checklist run. 0771.';
create unique index if not exists uq_lc_onb_live_staff  on public.lc_onboardings (staff_id)  where status = 'in_progress' and staff_id is not null;
create unique index if not exists uq_lc_onb_live_worker on public.lc_onboardings (worker_id) where status = 'in_progress' and worker_id is not null;
drop trigger if exists trg_lc_onb_code on public.lc_onboardings;
create trigger trg_lc_onb_code before insert on public.lc_onboardings
  for each row execute function public.assign_code('ONB', 'public.seq_lc_onboarding');
drop trigger if exists trg_lc_onb_updated on public.lc_onboardings;
create trigger trg_lc_onb_updated before update on public.lc_onboardings
  for each row execute function public.set_updated_at();

create table if not exists public.lc_onboarding_steps (
  id             uuid primary key default gen_random_uuid(),
  onboarding_id  uuid not null references public.lc_onboardings(id) on delete cascade,
  location_id    uuid not null references public.locations(id),
  sort_order     int not null,
  title          text not null,
  owner          text,
  due_date       date,
  done           boolean not null default false,
  done_at        timestamptz,
  done_by        uuid,
  note           text,
  created_at     timestamptz not null default now()
);
create index if not exists idx_lc_onb_steps on public.lc_onboarding_steps (onboarding_id, sort_order);

create or replace function public.lc_start_onboarding(p_staff uuid, p_worker uuid, p_template uuid, p_start date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p   record;
  t   public.lc_checklist_templates;
  v_id uuid;
  v_i  int := 0;
  st   jsonb;
begin
  if num_nonnulls(p_staff, p_worker) <> 1 then raise exception 'Pick one person' using errcode = '22023'; end if;
  select * into p from public.timeoff_person(p_staff, p_worker);
  if p.name is null then raise exception 'That person was not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(p.location_id, 'edit') then
    raise exception 'Only HR in this person''s unit can start a joining checklist' using errcode = '42501';
  end if;
  select * into t from public.lc_checklist_templates where id = p_template;
  if t.id is null or not t.is_active then raise exception 'Pick an active checklist' using errcode = '23503'; end if;
  if jsonb_array_length(t.steps) = 0 then raise exception 'That checklist has no steps' using errcode = '22023'; end if;
  if exists (select 1 from public.lc_onboardings o
              where o.status = 'in_progress' and coalesce(o.staff_id, o.worker_id) = coalesce(p_staff, p_worker)) then
    raise exception '% already has a joining checklist in progress', p.name using errcode = '23505';
  end if;

  insert into public.lc_onboardings (staff_id, worker_id, location_id, template_id, template_name, start_date)
  values (p_staff, p_worker, p.location_id, t.id, t.name, coalesce(p_start, p.joined, public.timeoff_today()))
  returning id into v_id;

  for st in select * from jsonb_array_elements(t.steps) loop
    v_i := v_i + 1;
    insert into public.lc_onboarding_steps (onboarding_id, location_id, sort_order, title, owner, due_date)
    values (v_id, p.location_id, v_i, upper(btrim(coalesce(st->>'title', 'STEP ' || v_i))),
            nullif(upper(btrim(coalesce(st->>'owner', ''))), ''),
            coalesce(p_start, p.joined, public.timeoff_today()) + coalesce((st->>'due_day')::int, 0));
  end loop;
  return v_id;
end $$;

-- Tick or untick one step. The last tick completes the checklist; an untick
-- re-opens it.
create or replace function public.lc_tick_onboarding_step(p_step uuid, p_done boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.lc_onboarding_steps;
  o public.lc_onboardings;
begin
  select * into s from public.lc_onboarding_steps where id = p_step for update;
  if s.id is null then raise exception 'Step not found' using errcode = '23503'; end if;
  select * into o from public.lc_onboardings where id = s.onboarding_id for update;
  if not public.lc_is_hr(o.location_id, 'edit') then
    raise exception 'Only HR in this unit can tick joining steps' using errcode = '42501';
  end if;
  if o.status = 'cancelled' then raise exception 'This checklist was cancelled' using errcode = '55000'; end if;

  update public.lc_onboarding_steps
     set done = p_done,
         done_at = case when p_done then now() end,
         done_by = case when p_done then auth.uid() end,
         note = nullif(upper(btrim(coalesce(p_note, ''))), '')
   where id = s.id;

  if exists (select 1 from public.lc_onboarding_steps where onboarding_id = o.id and not done) then
    update public.lc_onboardings set status = 'in_progress', completed_at = null where id = o.id and status <> 'in_progress';
  else
    update public.lc_onboardings set status = 'completed', completed_at = now() where id = o.id;
  end if;
end $$;

create or replace function public.lc_cancel_onboarding(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  o public.lc_onboardings;
begin
  select * into o from public.lc_onboardings where id = p_id for update;
  if o.id is null then raise exception 'Not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(o.location_id, 'edit') then
    raise exception 'Only HR in this unit can cancel a joining checklist' using errcode = '42501';
  end if;
  if o.status <> 'in_progress' then raise exception 'Only a checklist in progress can be cancelled' using errcode = '55000'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why' using errcode = '22023'; end if;
  update public.lc_onboardings set status = 'cancelled', cancel_reason = upper(btrim(p_reason)) where id = o.id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 2. Documents (MyJKKN §12.3)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.lc_required_documents (
  id            uuid primary key default gen_random_uuid(),
  code          text not null unique check (btrim(code) <> ''),
  name          text not null check (btrim(name) <> ''),
  category      text not null default 'identity'
                check (category in ('identity', 'address', 'education', 'employment', 'statutory', 'bank', 'medical', 'other')),
  applies_to    text not null default 'both' check (applies_to in ('both', 'staff', 'workers')),
  is_mandatory  boolean not null default true,
  has_expiry    boolean not null default false,
  sort_order    int not null default 0,
  is_active     boolean not null default true,
  created_by    uuid default auth.uid(),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
comment on table public.lc_required_documents is 'HR ▸ Team Lifecycle — the documents every person must hand in. Shared. 0771.';
drop trigger if exists trg_lc_reqdoc_updated on public.lc_required_documents;
create trigger trg_lc_reqdoc_updated before update on public.lc_required_documents
  for each row execute function public.set_updated_at();

insert into public.lc_required_documents (code, name, category, applies_to, is_mandatory, has_expiry, sort_order)
select v.* from (values
  ('AADHAAR', 'AADHAAR CARD',              'identity',  'both',    true,  false, 10),
  ('PHOTO',   'PASSPORT SIZE PHOTO',       'identity',  'both',    true,  false, 20),
  ('AGE',     'AGE PROOF',                 'identity',  'workers', true,  false, 30),
  ('PAN',     'PAN CARD',                  'statutory', 'staff',   true,  false, 40),
  ('BANK',    'BANK PASSBOOK / CHEQUE',    'bank',      'both',    true,  false, 50),
  ('ADDR',    'ADDRESS PROOF',             'address',   'both',    false, false, 60),
  ('EDU',     'EDUCATION CERTIFICATE',     'education', 'staff',   false, false, 70),
  ('RELIEVE', 'PREVIOUS RELIEVING LETTER', 'employment','staff',   false, false, 80),
  ('MEDICAL', 'MEDICAL FITNESS',           'medical',   'workers', false, true,  90),
  ('DL',      'DRIVING LICENCE',           'identity',  'both',    false, true, 100)
) as v(code, name, category, applies_to, is_mandatory, has_expiry, sort_order)
where not exists (select 1 from public.lc_required_documents);

-- Private bucket. PDF / JPEG / PNG, 5 MB — enforced by storage itself.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('hr-people-docs', 'hr-people-docs', false, 5242880,
        array['application/pdf', 'image/jpeg', 'image/png'])
on conflict (id) do nothing;

-- Key shape: <location_id>/<staff|worker>/<person_id>/<uuid>.<ext>. May the
-- caller `p_action` (view | edit) the person this key belongs to? The unit in
-- the key must be the person's own unit, so a key cannot be forged into
-- another unit's folder.
create or replace function public.lc_doc_key_ok(p_name text, p_action text)
returns boolean language plpgsql stable security definer set search_path = '' as $$
declare
  parts  text[] := string_to_array(p_name, '/');
  v_loc  uuid;
  v_kind text;
  v_pid  uuid;
  p      record;
  uuid_re constant text := '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
begin
  if coalesce(array_length(parts, 1), 0) <> 4 then return false; end if;
  if parts[1] !~* uuid_re or parts[3] !~* uuid_re or parts[2] not in ('staff', 'worker') then return false; end if;
  v_loc := parts[1]::uuid; v_kind := parts[2]; v_pid := parts[3]::uuid;
  select * into p from public.timeoff_person(case when v_kind = 'staff' then v_pid end,
                                             case when v_kind = 'worker' then v_pid end);
  if p.name is null or p.location_id is distinct from v_loc then return false; end if;
  return public.timeoff_may_act_for(case when v_kind = 'staff' then v_pid end,
                                    case when v_kind = 'worker' then v_pid end, v_loc, p_action);
end $$;

create table if not exists public.lc_documents (
  id               uuid primary key default gen_random_uuid(),
  staff_id         uuid references public.staff(id),
  worker_id        uuid references public.workers(id),
  location_id      uuid not null references public.locations(id),
  required_doc_id  uuid references public.lc_required_documents(id),
  doc_name         text not null,                       -- the required doc's name, or the operator's
  storage_path     text not null unique,
  file_name        text not null,
  mime_type        text not null,
  size_bytes       bigint,
  document_no      text,
  issued_on        date,
  expires_on       date,
  status           text not null default 'pending' check (status in ('pending', 'verified', 'rejected')),
  review_note      text,
  reviewed_by      uuid,
  reviewed_at      timestamptz,
  replaces_id      uuid references public.lc_documents(id),
  superseded       boolean not null default false,       -- a newer upload of the same document exists
  uploaded_by      uuid default auth.uid(),
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint lc_doc_person check (num_nonnulls(staff_id, worker_id) = 1),
  constraint lc_doc_dates  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);
comment on table public.lc_documents is
  'HR ▸ Team Lifecycle — a person''s uploaded document. "Expired" is derived (verified and expires_on < today), never stored. 0771.';
create index if not exists idx_lc_doc_staff  on public.lc_documents (staff_id)  where not superseded;
create index if not exists idx_lc_doc_worker on public.lc_documents (worker_id) where not superseded;
create index if not exists idx_lc_doc_status on public.lc_documents (status)    where not superseded;
drop trigger if exists trg_lc_doc_updated on public.lc_documents;
create trigger trg_lc_doc_updated before update on public.lc_documents
  for each row execute function public.set_updated_at();

-- The folder a new upload for this person goes into — asked by the browser
-- before it uploads, refused when the caller may not upload for them.
create or replace function public.lc_doc_folder(p_staff uuid, p_worker uuid)
returns text language plpgsql stable security definer set search_path = '' as $$
declare
  p record;
begin
  if num_nonnulls(p_staff, p_worker) <> 1 then raise exception 'Pick one person' using errcode = '22023'; end if;
  select * into p from public.timeoff_person(p_staff, p_worker);
  if p.name is null then raise exception 'That person was not found' using errcode = '23503'; end if;
  if p.location_id is null then raise exception '% has no unit set on their record', p.name using errcode = '23502'; end if;
  if not public.timeoff_may_act_for(p_staff, p_worker, p.location_id, 'edit') then
    raise exception 'You can upload only your own documents, or those of people in the unit you are working in'
      using errcode = '42501';
  end if;
  return p.location_id::text || '/' || case when p_staff is not null then 'staff' else 'worker' end
         || '/' || coalesce(p_staff, p_worker)::text;
end $$;

drop policy if exists hr_people_docs_insert on storage.objects;
create policy hr_people_docs_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'hr-people-docs' and public.lc_doc_key_ok(name, 'edit'));

drop policy if exists hr_people_docs_read on storage.objects;
create policy hr_people_docs_read on storage.objects for select to authenticated
  using (bucket_id = 'hr-people-docs' and public.lc_doc_key_ok(name, 'view'));

-- Only a file no document row points at can be removed — an abandoned upload.
-- A registered document is the record; it is superseded, never deleted.
drop policy if exists hr_people_docs_delete on storage.objects;
create policy hr_people_docs_delete on storage.objects for delete to authenticated
  using (bucket_id = 'hr-people-docs' and public.lc_doc_key_ok(name, 'edit')
         and not exists (select 1 from public.lc_documents d where d.storage_path = storage.objects.name));

-- Register an uploaded file. The object must already be in the bucket under
-- this person's folder, uploaded by the caller.
create or replace function public.lc_register_document(
  p_staff uuid, p_worker uuid, p_required uuid, p_doc_name text, p_path text, p_file_name text,
  p_document_no text, p_issued date, p_expires date)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p      record;
  r      public.lc_required_documents;
  o        record;
  v_prev   uuid;
  v_id     uuid;
  v_name   text;
  v_folder text;
begin
  if num_nonnulls(p_staff, p_worker) <> 1 then raise exception 'Pick one person' using errcode = '22023'; end if;
  select * into p from public.timeoff_person(p_staff, p_worker);
  if p.name is null then raise exception 'That person was not found' using errcode = '23503'; end if;
  if not public.timeoff_may_act_for(p_staff, p_worker, p.location_id, 'edit') then
    raise exception 'You can upload only your own documents, or those of people in the unit you are working in'
      using errcode = '42501';
  end if;
  v_folder := p.location_id::text || '/' || (case when p_staff is not null then 'staff' else 'worker' end)
              || '/' || coalesce(p_staff, p_worker)::text || '/';
  if left(p_path, length(v_folder)) <> v_folder then
    raise exception 'That file was not uploaded to this person''s folder' using errcode = '22023';
  end if;
  select so.owner, so.metadata into o from storage.objects so
   where so.bucket_id = 'hr-people-docs' and so.name = p_path;
  if not found then raise exception 'The upload was not found — choose the file again' using errcode = '23503'; end if;
  if o.owner is distinct from auth.uid() then
    raise exception 'That file was uploaded by someone else' using errcode = '42501';
  end if;

  if p_required is not null then
    select * into r from public.lc_required_documents where id = p_required;
    if r.id is null then raise exception 'Unknown document type' using errcode = '23503'; end if;
    v_name := r.name;
    if r.has_expiry and p_expires is null then
      raise exception '% needs its expiry date', r.name using errcode = '22023';
    end if;
  else
    v_name := upper(btrim(coalesce(p_doc_name, '')));
    if v_name = '' then raise exception 'Name the document' using errcode = '22023'; end if;
  end if;

  -- A re-upload of the same required document replaces the current one.
  if p_required is not null then
    select d.id into v_prev from public.lc_documents d
     where d.required_doc_id = p_required and not d.superseded
       and coalesce(d.staff_id, d.worker_id) = coalesce(p_staff, p_worker)
     order by d.created_at desc limit 1;
  end if;

  insert into public.lc_documents
    (staff_id, worker_id, location_id, required_doc_id, doc_name, storage_path, file_name, mime_type, size_bytes,
     document_no, issued_on, expires_on, replaces_id)
  values
    (p_staff, p_worker, p.location_id, p_required, v_name, p_path, btrim(p_file_name),
     coalesce(o.metadata->>'mimetype', 'application/octet-stream'), nullif(o.metadata->>'size', '')::bigint,
     nullif(upper(btrim(coalesce(p_document_no, ''))), ''), p_issued, p_expires, v_prev)
  returning id into v_id;

  if v_prev is not null then
    update public.lc_documents set superseded = true where id = v_prev;
  end if;
  return v_id;
end $$;

create or replace function public.lc_review_document(p_ids uuid[], p_status text, p_note text)
returns int language plpgsql security definer set search_path = '' as $$
declare
  d   public.lc_documents;
  v_n int := 0;
begin
  if p_status not in ('verified', 'rejected') then raise exception 'Verify or reject' using errcode = '22023'; end if;
  if p_status = 'rejected' and btrim(coalesce(p_note, '')) = '' then
    raise exception 'Say why it is rejected — the person needs to know what to upload instead' using errcode = '22023';
  end if;
  for d in select * from public.lc_documents where id = any(p_ids) for update loop
    if not public.lc_is_hr(d.location_id, 'edit') then
      raise exception 'Only HR in this unit can verify documents' using errcode = '42501';
    end if;
    if d.superseded then raise exception '% has been replaced by a newer upload — reload', d.doc_name using errcode = '55000'; end if;
    if d.staff_id is not null and d.staff_id = public.timeoff_my_staff_id() then
      raise exception 'You cannot verify your own document' using errcode = '42501';
    end if;
    update public.lc_documents
       set status = p_status, review_note = nullif(upper(btrim(coalesce(p_note, ''))), ''),
           reviewed_by = auth.uid(), reviewed_at = now()
     where id = d.id;
    v_n := v_n + 1;
  end loop;
  return v_n;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 3. Assets issued to people (MyJKKN §12.4, made writable)
-- ════════════════════════════════════════════════════════════════════════════

create sequence if not exists public.seq_lc_asset;

create table if not exists public.lc_assets (
  id               uuid primary key default gen_random_uuid(),
  code             text,
  staff_id         uuid references public.staff(id),
  worker_id        uuid references public.workers(id),
  location_id      uuid not null references public.locations(id),
  asset_name       text not null check (btrim(asset_name) <> ''),
  category         text not null default 'other'
                   check (category in ('id_card', 'uniform', 'laptop', 'mobile', 'sim', 'tools', 'key', 'vehicle', 'other')),
  serial_no        text,
  issued_on        date not null,
  issue_condition  text,
  value            numeric(14,2) check (value is null or value >= 0),
  status           text not null default 'issued' check (status in ('issued', 'returned', 'lost', 'damaged')),
  returned_on      date,
  return_condition text,
  recovery_amount  numeric(14,2) check (recovery_amount is null or recovery_amount >= 0),  -- lost / damaged
  note             text,
  created_by       uuid default auth.uid(),
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  constraint lc_asset_person check (num_nonnulls(staff_id, worker_id) = 1),
  constraint lc_asset_back   check (status = 'issued' or returned_on is not null),
  constraint lc_asset_dates  check (returned_on is null or returned_on >= issued_on)
);
comment on table public.lc_assets is 'HR ▸ Team Lifecycle — company property in a person''s hands. 0771.';
create index if not exists idx_lc_asset_staff  on public.lc_assets (staff_id);
create index if not exists idx_lc_asset_worker on public.lc_assets (worker_id);
drop trigger if exists trg_lc_asset_code on public.lc_assets;
create trigger trg_lc_asset_code before insert on public.lc_assets
  for each row execute function public.assign_code('AST', 'public.seq_lc_asset');
drop trigger if exists trg_lc_asset_loc on public.lc_assets;
create trigger trg_lc_asset_loc before insert on public.lc_assets
  for each row execute function public.timeoff_stamp_location();
drop trigger if exists trg_lc_asset_updated on public.lc_assets;
create trigger trg_lc_asset_updated before update on public.lc_assets
  for each row execute function public.set_updated_at();

-- ════════════════════════════════════════════════════════════════════════════
-- 4. Exits (MyJKKN §12.5 + §12.6 terminations)
-- ════════════════════════════════════════════════════════════════════════════

create table if not exists public.lc_exit_step_catalog (
  key         text primary key check (key ~ '^[a-z][a-z0-9_]*$'),
  label       text not null check (btrim(label) <> ''),
  sort_order  int not null default 0,
  is_active   boolean not null default true,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);
comment on table public.lc_exit_step_catalog is
  'HR ▸ Team Lifecycle — the steps every exit is copied from when it opens. Keys asset_return and final_settlement are checked by the database. 0771.';
drop trigger if exists trg_lc_exitcat_updated on public.lc_exit_step_catalog;
create trigger trg_lc_exitcat_updated before update on public.lc_exit_step_catalog
  for each row execute function public.set_updated_at();

insert into public.lc_exit_step_catalog (key, label, sort_order) values
  ('resignation_received', 'RESIGNATION / NOTICE RECEIVED', 10),
  ('exit_interview',       'EXIT INTERVIEW',                20),
  ('handover',             'WORK HANDED OVER',              30),
  ('asset_return',         'COMPANY ASSETS RETURNED',       40),
  ('no_dues',              'NO-DUES CLEARANCE',             50),
  ('final_settlement',     'FULL & FINAL SETTLED',          60),
  ('relieving_letter',     'RELIEVING / EXPERIENCE LETTER ISSUED', 70)
on conflict (key) do nothing;

create sequence if not exists public.seq_lc_exit;

create table if not exists public.lc_exits (
  id                uuid primary key default gen_random_uuid(),
  code              text,
  staff_id          uuid references public.staff(id),
  worker_id         uuid references public.workers(id),
  location_id       uuid not null references public.locations(id),
  separation_type   text not null default 'resignation'
                    check (separation_type in ('resignation', 'retirement', 'termination', 'death', 'absconding')),
  notice_date       date not null,             -- resignation given / decision taken
  last_working_day  date not null,
  reason            text not null check (btrim(reason) <> ''),
  grounds           text,                      -- termination only, ≥ 20 characters
  notice_waived     boolean not null default false,
  status            text not null default 'open'
                    check (status in ('pending_approval', 'open', 'completed', 'withdrawn')),
  decided_by        uuid,
  decided_at        timestamptz,
  decision_remark   text,
  closed_by         uuid,
  closed_at         timestamptz,
  close_reason      text,
  marked_left       boolean not null default false,
  created_by        uuid default auth.uid(),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint lc_exit_person check (num_nonnulls(staff_id, worker_id) = 1),
  constraint lc_exit_dates  check (last_working_day >= notice_date),
  constraint lc_exit_grounds check (separation_type <> 'termination' or length(btrim(coalesce(grounds, ''))) >= 20)
);
comment on table public.lc_exits is 'HR ▸ Team Lifecycle — exit cases. One live case per person. 0771.';
create unique index if not exists uq_lc_exit_live_staff  on public.lc_exits (staff_id)
  where status in ('pending_approval', 'open') and staff_id is not null;
create unique index if not exists uq_lc_exit_live_worker on public.lc_exits (worker_id)
  where status in ('pending_approval', 'open') and worker_id is not null;
drop trigger if exists trg_lc_exit_code on public.lc_exits;
create trigger trg_lc_exit_code before insert on public.lc_exits
  for each row execute function public.assign_code('EXT', 'public.seq_lc_exit');
drop trigger if exists trg_lc_exit_updated on public.lc_exits;
create trigger trg_lc_exit_updated before update on public.lc_exits
  for each row execute function public.set_updated_at();

create table if not exists public.lc_exit_steps (
  id           uuid primary key default gen_random_uuid(),
  exit_id      uuid not null references public.lc_exits(id) on delete cascade,
  location_id  uuid not null references public.locations(id),
  step_key     text not null,
  label        text not null,
  sort_order   int not null,
  done         boolean not null default false,
  done_at      timestamptz,
  done_by      uuid,
  note         text,
  created_at   timestamptz not null default now(),
  unique (exit_id, step_key)
);
create index if not exists idx_lc_exit_steps on public.lc_exit_steps (exit_id, sort_order);

create or replace function public.lc_seed_exit_steps(p_exit uuid)
returns void language sql security definer set search_path = '' as $$
  insert into public.lc_exit_steps (exit_id, location_id, step_key, label, sort_order)
  select e.id, e.location_id, c.key, c.label, c.sort_order
    from public.lc_exits e
    cross join public.lc_exit_step_catalog c
   where e.id = p_exit and c.is_active
  on conflict (exit_id, step_key) do nothing;
$$;

-- Open an exit. HR for anyone in their unit; a staff member may hand in their
-- OWN resignation. A termination waits for its approval run before the steps
-- open.
create or replace function public.lc_open_exit(
  p_staff uuid, p_worker uuid, p_type text, p_notice_date date, p_lwd date,
  p_reason text, p_grounds text, p_notice_waived boolean)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  p      record;
  v_self boolean;
  v_id   uuid;
begin
  if num_nonnulls(p_staff, p_worker) <> 1 then raise exception 'Pick one person' using errcode = '22023'; end if;
  select * into p from public.timeoff_person(p_staff, p_worker);
  if p.name is null then raise exception 'That person was not found' using errcode = '23503'; end if;
  v_self := p_staff is not null and p_staff = public.timeoff_my_staff_id();
  if v_self then
    if p_type <> 'resignation' then
      raise exception 'You can hand in your own resignation; anything else is opened by HR' using errcode = '42501';
    end if;
  elsif not public.lc_is_hr(p.location_id, 'create') then
    raise exception 'Only HR in this person''s unit can open an exit' using errcode = '42501';
  end if;
  if p_type not in ('resignation', 'retirement', 'termination', 'death', 'absconding') then
    raise exception 'Unknown separation type' using errcode = '22023';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'The reason is mandatory' using errcode = '22023'; end if;
  if p_type = 'termination' and length(btrim(coalesce(p_grounds, ''))) < 20 then
    raise exception 'State the grounds for termination in at least 20 characters' using errcode = '22023';
  end if;
  if p_lwd < p_notice_date then
    raise exception 'The last working day cannot be before the notice date' using errcode = '22023';
  end if;
  if exists (select 1 from public.lc_exits e
              where e.status in ('pending_approval', 'open')
                and coalesce(e.staff_id, e.worker_id) = coalesce(p_staff, p_worker)) then
    raise exception '% already has an exit in progress', p.name using errcode = '23505';
  end if;

  insert into public.lc_exits
    (staff_id, worker_id, location_id, separation_type, notice_date, last_working_day, reason, grounds,
     notice_waived, status)
  values
    (p_staff, p_worker, p.location_id, p_type, p_notice_date, p_lwd, upper(btrim(p_reason)),
     nullif(upper(btrim(coalesce(p_grounds, ''))), ''), coalesce(p_notice_waived, false),
     case when p_type = 'termination' then 'pending_approval' else 'open' end)
  returning id into v_id;

  if p_type = 'termination' then
    perform public.approval_start_run(
      'lc_termination', 'lc_exits', v_id,
      jsonb_build_object('person_name', p.name, 'last_working_day', p_lwd, 'grounds', upper(btrim(p_grounds))),
      jsonb_build_object('location_id', p.location_id), null, auth.uid());
  else
    perform public.lc_seed_exit_steps(v_id);
  end if;
  return v_id;
end $$;

create or replace function public.lc_exit_apply_decision(
  p_id uuid, p_run_status text, p_actor uuid, p_remark text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e public.lc_exits;
begin
  select * into e from public.lc_exits where id = p_id for update;
  if e.id is null or e.status <> 'pending_approval' then
    raise exception 'Exit % is not awaiting a decision — reload', p_id using errcode = '55000';
  end if;
  if p_run_status = 'completed' then
    update public.lc_exits set status = 'open', decided_by = p_actor, decided_at = p_at, decision_remark = p_remark
     where id = e.id;
    perform public.lc_seed_exit_steps(e.id);
  elsif p_run_status in ('rejected', 'cancelled') then
    update public.lc_exits
       set status = 'withdrawn', decided_by = coalesce(auth.uid(), p_actor), decided_at = p_at,
           decision_remark = p_remark, closed_at = p_at,
           close_reason = case when p_run_status = 'rejected' then 'TERMINATION NOT APPROVED' else 'WITHDRAWN' end
     where id = e.id;
  end if;
end $$;

-- Tick or untick an exit step. Two steps are checked against the records:
-- assets cannot be "returned" while any is still issued, and the settlement
-- cannot be "settled" until one is approved or paid.
create or replace function public.lc_tick_exit_step(p_step uuid, p_done boolean, p_note text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  s public.lc_exit_steps;
  e public.lc_exits;
  v_n int;
begin
  select * into s from public.lc_exit_steps where id = p_step for update;
  if s.id is null then raise exception 'Step not found' using errcode = '23503'; end if;
  select * into e from public.lc_exits where id = s.exit_id for update;
  if not public.lc_is_hr(e.location_id, 'edit') then
    raise exception 'Only HR in this unit can tick exit steps' using errcode = '42501';
  end if;
  if e.status <> 'open' then raise exception 'This exit is %', e.status using errcode = '55000'; end if;

  if p_done and s.step_key = 'asset_return' then
    select count(*) into v_n from public.lc_assets a
     where a.status = 'issued' and coalesce(a.staff_id, a.worker_id) = coalesce(e.staff_id, e.worker_id);
    if v_n > 0 then
      raise exception '% company asset(s) are still issued to this person — mark them returned or lost on Assets first', v_n
        using errcode = '23514';
    end if;
  end if;
  if p_done and s.step_key = 'final_settlement'
     and not exists (select 1 from public.lc_settlements x where x.exit_id = e.id and x.status in ('approved', 'paid')) then
    raise exception 'The full & final settlement is not approved yet' using errcode = '23514';
  end if;

  update public.lc_exit_steps
     set done = p_done,
         done_at = case when p_done then now() end,
         done_by = case when p_done then auth.uid() end,
         note = nullif(upper(btrim(coalesce(p_note, ''))), '')
   where id = s.id;
end $$;

-- Withdraw: the person stays (a resignation taken back, a case opened in error).
create or replace function public.lc_withdraw_exit(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e   public.lc_exits;
  v_run public.approval_runs;
begin
  select * into e from public.lc_exits where id = p_id for update;
  if e.id is null then raise exception 'Not found' using errcode = '23503'; end if;
  if not (public.lc_is_hr(e.location_id, 'edit')
          or (e.staff_id is not null and e.staff_id = public.timeoff_my_staff_id() and e.separation_type = 'resignation')) then
    raise exception 'Only HR, or the person who resigned, can withdraw this' using errcode = '42501';
  end if;
  if e.status not in ('pending_approval', 'open') then
    raise exception 'Only an exit in progress can be withdrawn' using errcode = '55000';
  end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why' using errcode = '22023'; end if;
  if exists (select 1 from public.lc_settlements x where x.exit_id = e.id and x.status in ('pending', 'approved', 'paid')) then
    raise exception 'A settlement for this exit is already with the approver or approved — it cannot be withdrawn now'
      using errcode = '55000';
  end if;

  if e.status = 'pending_approval' then
    select * into v_run from public.approval_runs
     where subject_table = 'lc_exits' and subject_id = e.id and status = 'in_progress'
     order by started_at desc limit 1 for update;
    if v_run.id is not null then
      insert into public.approval_run_events (run_id, step_order, action, actor_id, comment)
      values (v_run.id, v_run.current_step, 'cancel', auth.uid(), upper(btrim(p_reason)));
      -- the terminal trigger runs lc_exit_apply_decision('cancelled') → withdrawn
      update public.approval_runs
         set status = 'cancelled', completed_at = now(), lock_version = lock_version + 1
       where id = v_run.id;
    end if;
  end if;

  update public.lc_exits
     set status = 'withdrawn', closed_by = auth.uid(), closed_at = now(), close_reason = upper(btrim(p_reason))
   where id = e.id;
  update public.lc_settlements set status = 'superseded' where exit_id = e.id and status = 'draft';
end $$;

-- Complete: every step done. With p_mark_left the person's own record gets
-- the last working day as date_of_leaving and is switched off — the only
-- write this phase ever makes to staff / workers, and only on this click.
create or replace function public.lc_complete_exit(p_id uuid, p_mark_left boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare
  e   public.lc_exits;
  v_n int;
begin
  select * into e from public.lc_exits where id = p_id for update;
  if e.id is null then raise exception 'Not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(e.location_id, 'edit') then
    raise exception 'Only HR in this unit can complete an exit' using errcode = '42501';
  end if;
  if e.status <> 'open' then raise exception 'This exit is %', e.status using errcode = '55000'; end if;
  select count(*) into v_n from public.lc_exit_steps where exit_id = e.id and not done;
  if v_n > 0 then raise exception '% step(s) are not done yet', v_n using errcode = '23514'; end if;

  update public.lc_exits
     set status = 'completed', closed_by = auth.uid(), closed_at = now(), marked_left = coalesce(p_mark_left, false)
   where id = e.id;

  if coalesce(p_mark_left, false) then
    if e.staff_id is not null then
      update public.staff set date_of_leaving = e.last_working_day, is_active = false where id = e.staff_id;
    else
      update public.workers set date_of_leaving = e.last_working_day, is_active = false where id = e.worker_id;
    end if;
  end if;
end $$;

-- People reaching retirement age within the look-ahead, with no exit open.
create or replace function public.lc_retirements_due()
returns table (person_kind text, staff_id uuid, worker_id uuid, name text, code text, location_id uuid,
               date_of_birth date, retires_on date, age_now int, has_exit boolean)
language sql stable security definer set search_path = '' as $$
  with cfg as (select retirement_age, retirement_lookahead from public.lc_settings where id),
  people as (
    select 'staff'::text as kind, s.id as staff_id, null::uuid as worker_id, s.name, s.code, s.location_id, s.date_of_birth
      from public.staff s where s.is_active and s.date_of_birth is not null
    union all
    select 'worker', null, w.id, w.name, w.code, w.location_id, w.date_of_birth
      from public.workers w where w.is_active and w.date_of_birth is not null
  )
  select p.kind, p.staff_id, p.worker_id, p.name, p.code, p.location_id, p.date_of_birth,
         (p.date_of_birth + make_interval(years => cfg.retirement_age))::date,
         extract(year from age(public.timeoff_today(), p.date_of_birth))::int,
         exists (select 1 from public.lc_exits e
                  where e.status in ('pending_approval', 'open')
                    and coalesce(e.staff_id, e.worker_id) = coalesce(p.staff_id, p.worker_id))
    from people p, cfg
   where public.lc_is_hr(p.location_id, 'view')
     and (p.date_of_birth + make_interval(years => cfg.retirement_age))::date
         <= (public.timeoff_today() + make_interval(months => cfg.retirement_lookahead))::date
   order by 8;
$$;

-- ════════════════════════════════════════════════════════════════════════════
-- 5. Full & final settlement (MyJKKN §12.5 calculateFnf)
-- ════════════════════════════════════════════════════════════════════════════
--
--   gratuity  monthly-rated: (basic + DA) × 15 / 26 × completed years
--             daily-rated:   daily wage × 15 × completed years
--             zero under gratuity_min_years of service (except death),
--             capped at gratuity_cap. A final part-year of 6 months or more
--             counts as a year (Payment of Gratuity Act §4).
--   leave     monthly: (basic + DA) / 30 × days;  daily: daily wage × days
--   notice    short days × the same day rate, recovered
--   net       generated: earnings − recoveries

create sequence if not exists public.seq_lc_settlement;

create table if not exists public.lc_settlements (
  id                 uuid primary key default gen_random_uuid(),
  code               text,
  exit_id            uuid not null references public.lc_exits(id),
  staff_id           uuid references public.staff(id),
  worker_id          uuid references public.workers(id),
  location_id        uuid not null references public.locations(id),
  version            int not null default 1,
  rated              text not null check (rated in ('monthly', 'daily')),
  basic_da           numeric(14,2) not null default 0 check (basic_da >= 0),
  daily_wage         numeric(14,2) not null default 0 check (daily_wage >= 0),
  joined_on          date,
  service_years      numeric(6,2) not null default 0,
  completed_years    int not null default 0,
  gratuity           numeric(14,2) not null default 0 check (gratuity >= 0),
  leave_days         numeric(6,2) not null default 0 check (leave_days >= 0),
  leave_amount       numeric(14,2) not null default 0 check (leave_amount >= 0),
  salary_due         numeric(14,2) not null default 0 check (salary_due >= 0),
  bonus_due          numeric(14,2) not null default 0 check (bonus_due >= 0),
  other_earnings     numeric(14,2) not null default 0 check (other_earnings >= 0),
  notice_short_days  numeric(6,2) not null default 0 check (notice_short_days >= 0),
  notice_recovery    numeric(14,2) not null default 0 check (notice_recovery >= 0),
  advance_recovery   numeric(14,2) not null default 0 check (advance_recovery >= 0),
  asset_recovery     numeric(14,2) not null default 0 check (asset_recovery >= 0),
  other_deductions   numeric(14,2) not null default 0 check (other_deductions >= 0),
  net_payable        numeric(14,2) generated always as
                     (gratuity + leave_amount + salary_due + bonus_due + other_earnings
                      - notice_recovery - advance_recovery - asset_recovery - other_deductions) stored,
  note               text,
  status             text not null default 'draft'
                     check (status in ('draft', 'pending', 'approved', 'rejected', 'paid', 'superseded')),
  decided_by         uuid,
  decided_at         timestamptz,
  decision_remark    text,
  paid_by            uuid,
  paid_at            timestamptz,
  paid_ref           text,
  created_by         uuid default auth.uid(),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint lc_fnf_person check (num_nonnulls(staff_id, worker_id) = 1),
  unique (exit_id, version)
);
comment on table public.lc_settlements is
  'HR ▸ Team Lifecycle — full & final settlement versions. One live (draft / pending / approved / paid) per exit. 0771.';
create unique index if not exists uq_lc_fnf_live on public.lc_settlements (exit_id)
  where status in ('draft', 'pending', 'approved', 'paid');
drop trigger if exists trg_lc_fnf_code on public.lc_settlements;
create trigger trg_lc_fnf_code before insert on public.lc_settlements
  for each row execute function public.assign_code('FNF', 'public.seq_lc_settlement');
drop trigger if exists trg_lc_fnf_updated on public.lc_settlements;
create trigger trg_lc_fnf_updated before update on public.lc_settlements
  for each row execute function public.set_updated_at();

-- What the settlement form opens with. Every figure can be changed before saving.
create or replace function public.lc_settlement_prefill(p_exit uuid)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  e      public.lc_exits;
  p      record;
  cfg    public.lc_settings;
  v_year uuid;
  v_leave numeric := 0;
  v_adv  numeric := 0;
  v_asset numeric := 0;
  v_req  int;
  v_served int;
begin
  select * into e from public.lc_exits where id = p_exit;
  if e.id is null then raise exception 'Exit not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(e.location_id, 'view') then
    raise exception 'Only HR in this unit can work out a settlement' using errcode = '42501';
  end if;
  select * into p from public.lc_person_pay(e.staff_id, e.worker_id);
  select * into cfg from public.lc_settings where id;

  -- Unused encashable leave this leave year (Time Off, 0770).
  v_year := public.timeoff_year_of(e.last_working_day);
  if v_year is not null then
    select coalesce(sum(greatest(b.available, 0)), 0) into v_leave
      from public.timeoff_balance_sheet(v_year, e.staff_id, e.worker_id, e.last_working_day) b
      join public.timeoff_leave_types t on t.id = b.leave_type_id
     where t.is_encashable;
  end if;

  -- Outstanding salary advances (hr_advances, 0210).
  select coalesce(sum(greatest(a.amount - a.repaid_amount, 0)), 0) into v_adv
    from public.hr_advances a
   where a.employee_type = case when e.staff_id is not null then 'staff' else 'worker' end
     and a.employee_id = coalesce(e.staff_id, e.worker_id)
     and a.status in ('open', 'repaying');

  -- Lost / damaged assets' recovery.
  select coalesce(sum(coalesce(a.recovery_amount, 0)), 0) into v_asset
    from public.lc_assets a
   where coalesce(a.staff_id, a.worker_id) = coalesce(e.staff_id, e.worker_id)
     and a.status in ('lost', 'damaged');

  v_req := case when e.staff_id is not null then cfg.notice_days_staff else cfg.notice_days_workers end;
  v_served := e.last_working_day - e.notice_date;

  return jsonb_build_object(
    'rated', p.rated,
    'basic_da', p.basic_da,
    'daily_wage', p.daily_wage,
    'joined_on', p.joined,
    'last_working_day', e.last_working_day,
    'separation_type', e.separation_type,
    'leave_days', v_leave,
    'advance_recovery', v_adv,
    'asset_recovery', v_asset,
    'notice_required', v_req,
    'notice_short_days', case when e.separation_type = 'resignation' and not e.notice_waived
                              then greatest(v_req - v_served, 0) else 0 end,
    'gratuity_min_years', cfg.gratuity_min_years,
    'gratuity_cap', cfg.gratuity_cap);
end $$;

-- Save (create or update the draft). Gratuity, leave and notice amounts are
-- worked out HERE from the inputs, so the screen's preview cannot drift from
-- what is stored.
create or replace function public.lc_save_settlement(p_exit uuid, p jsonb)
returns uuid language plpgsql security definer set search_path = '' as $$
declare
  e        public.lc_exits;
  cfg      public.lc_settings;
  d        public.lc_settlements;
  v_rated  text := coalesce(p->>'rated', 'monthly');
  v_bda    numeric := round(coalesce((p->>'basic_da')::numeric, 0), 2);
  v_daily  numeric := round(coalesce((p->>'daily_wage')::numeric, 0), 2);
  v_joined date := nullif(p->>'joined_on', '')::date;
  v_age    interval;
  v_years  numeric := 0;
  v_done   int := 0;
  v_rate   numeric;
  v_grat   numeric := 0;
  v_ldays  numeric := round(coalesce((p->>'leave_days')::numeric, 0), 2);
  v_short  numeric := round(coalesce((p->>'notice_short_days')::numeric, 0), 2);
  v_id     uuid;
  v_ver    int;
  n        record;
begin
  select * into e from public.lc_exits where id = p_exit for update;
  if e.id is null then raise exception 'Exit not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(e.location_id, 'edit') then
    raise exception 'Only HR in this unit can save a settlement' using errcode = '42501';
  end if;
  if e.status <> 'open' then raise exception 'The exit is %, not open', e.status using errcode = '55000'; end if;
  if v_rated not in ('monthly', 'daily') then raise exception 'Monthly or daily' using errcode = '22023'; end if;
  select * into cfg from public.lc_settings where id;

  -- every money / day input must be ≥ 0
  for n in select key, value from jsonb_each_text(p)
            where key in ('basic_da', 'daily_wage', 'leave_days', 'salary_due', 'bonus_due', 'other_earnings',
                          'notice_short_days', 'advance_recovery', 'asset_recovery', 'other_deductions') loop
    if coalesce(n.value, '') <> '' and n.value::numeric < 0 then
      raise exception '% cannot be negative', replace(n.key, '_', ' ') using errcode = '22023';
    end if;
  end loop;

  v_rate := case when v_rated = 'monthly' then v_bda / 30.0 else v_daily end;
  if v_joined is not null and v_joined <= e.last_working_day then
    v_age   := age(e.last_working_day, v_joined);
    v_years := round(extract(year from v_age) + extract(month from v_age) / 12.0, 2);
    v_done  := extract(year from v_age)::int + case when extract(month from v_age) >= 6 then 1 else 0 end;
    if extract(year from v_age) >= cfg.gratuity_min_years or e.separation_type = 'death' then
      v_grat := least(cfg.gratuity_cap,
                      round(case when v_rated = 'monthly' then v_bda * 15 / 26.0 else v_daily * 15 end * v_done, 0));
    end if;
  end if;

  select * into d from public.lc_settlements where exit_id = e.id and status in ('draft', 'pending', 'approved', 'paid');
  if d.id is not null and d.status <> 'draft' then
    raise exception 'This exit''s settlement is % — it cannot be changed', d.status using errcode = '55000';
  end if;

  if d.id is null then
    select coalesce(max(version), 0) + 1 into v_ver from public.lc_settlements where exit_id = e.id;
    insert into public.lc_settlements (exit_id, staff_id, worker_id, location_id, version, rated)
    values (e.id, e.staff_id, e.worker_id, e.location_id, v_ver, v_rated)
    returning id into v_id;
  else
    v_id := d.id;
  end if;

  update public.lc_settlements
     set rated = v_rated, basic_da = v_bda, daily_wage = v_daily, joined_on = v_joined,
         service_years = v_years, completed_years = v_done, gratuity = v_grat,
         leave_days = v_ldays, leave_amount = round(v_rate * v_ldays, 0),
         salary_due = round(coalesce((p->>'salary_due')::numeric, 0), 2),
         bonus_due = round(coalesce((p->>'bonus_due')::numeric, 0), 2),
         other_earnings = round(coalesce((p->>'other_earnings')::numeric, 0), 2),
         notice_short_days = v_short,
         notice_recovery = case when e.notice_waived then 0 else round(v_rate * v_short, 0) end,
         advance_recovery = round(coalesce((p->>'advance_recovery')::numeric, 0), 2),
         asset_recovery = round(coalesce((p->>'asset_recovery')::numeric, 0), 2),
         other_deductions = round(coalesce((p->>'other_deductions')::numeric, 0), 2),
         note = nullif(upper(btrim(coalesce(p->>'note', ''))), '')
   where id = v_id;
  return v_id;
end $$;

create or replace function public.lc_submit_settlement(p_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x public.lc_settlements;
  p record;
begin
  select * into x from public.lc_settlements where id = p_id for update;
  if x.id is null then raise exception 'Not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(x.location_id, 'edit') then
    raise exception 'Only HR in this unit can send a settlement for approval' using errcode = '42501';
  end if;
  if x.status <> 'draft' then raise exception 'Only a draft can be sent for approval' using errcode = '55000'; end if;
  select * into p from public.timeoff_person(x.staff_id, x.worker_id);
  update public.lc_settlements set status = 'pending' where id = x.id;
  perform public.approval_start_run(
    'lc_settlement', 'lc_settlements', x.id,
    jsonb_build_object('person_name', p.name, 'net_payable', x.net_payable, 'gratuity', x.gratuity),
    jsonb_build_object('location_id', x.location_id), null, auth.uid());
end $$;

-- Pull a pending settlement back to draft (its run is cancelled).
create or replace function public.lc_recall_settlement(p_id uuid, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x   public.lc_settlements;
  v_run public.approval_runs;
begin
  select * into x from public.lc_settlements where id = p_id for update;
  if x.id is null then raise exception 'Not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(x.location_id, 'edit') then
    raise exception 'Only HR in this unit can recall a settlement' using errcode = '42501';
  end if;
  if x.status <> 'pending' then raise exception 'Only a settlement waiting for approval can be recalled' using errcode = '55000'; end if;
  if btrim(coalesce(p_reason, '')) = '' then raise exception 'Say why' using errcode = '22023'; end if;
  select * into v_run from public.approval_runs
   where subject_table = 'lc_settlements' and subject_id = x.id and status = 'in_progress'
   order by started_at desc limit 1 for update;
  if v_run.id is null then raise exception 'It has no open approval — reload' using errcode = '55000'; end if;
  insert into public.approval_run_events (run_id, step_order, action, actor_id, comment)
  values (v_run.id, v_run.current_step, 'cancel', auth.uid(), upper(btrim(p_reason)));
  update public.approval_runs
     set status = 'cancelled', completed_at = now(), lock_version = lock_version + 1
   where id = v_run.id;
end $$;

create or replace function public.lc_settlement_apply_decision(
  p_id uuid, p_run_status text, p_actor uuid, p_remark text, p_at timestamptz)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x public.lc_settlements;
begin
  select * into x from public.lc_settlements where id = p_id for update;
  if x.id is null or x.status <> 'pending' then
    raise exception 'Settlement % is not awaiting a decision — reload', p_id using errcode = '55000';
  end if;
  update public.lc_settlements
     set status = case p_run_status when 'completed' then 'approved' when 'rejected' then 'rejected' else 'draft' end,
         decided_by = coalesce(auth.uid(), p_actor), decided_at = p_at, decision_remark = p_remark
   where id = x.id;
end $$;

create or replace function public.lc_mark_settlement_paid(p_id uuid, p_ref text)
returns void language plpgsql security definer set search_path = '' as $$
declare
  x public.lc_settlements;
begin
  select * into x from public.lc_settlements where id = p_id for update;
  if x.id is null then raise exception 'Not found' using errcode = '23503'; end if;
  if not public.lc_is_hr(x.location_id, 'edit') then
    raise exception 'Only HR in this unit can mark a settlement paid' using errcode = '42501';
  end if;
  if x.status <> 'approved' then raise exception 'Only an approved settlement can be marked paid' using errcode = '55000'; end if;
  update public.lc_settlements
     set status = 'paid', paid_by = auth.uid(), paid_at = now(),
         paid_ref = nullif(upper(btrim(coalesce(p_ref, ''))), '')
   where id = x.id;
end $$;

-- ════════════════════════════════════════════════════════════════════════════
-- 6. Engine wiring — terminal branches + default flows
-- ════════════════════════════════════════════════════════════════════════════

do $$
declare
  v_def    text := pg_get_functiondef('public.approval_apply_terminal()'::regprocedure);
  v_anchor text := E'    raise exception\n        ''approval_apply_terminal: no terminal callback';
  v_branch text := E'    if new.subject_table = ''lc_exits'' then\n'
                || E'        perform public.lc_exit_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark, coalesce(new.completed_at, now()));\n'
                || E'        return new;\n'
                || E'    end if;\n\n'
                || E'    if new.subject_table = ''lc_settlements'' then\n'
                || E'        perform public.lc_settlement_apply_decision(new.subject_id, new.status, new.final_actor_id, v_remark, coalesce(new.completed_at, now()));\n'
                || E'        return new;\n'
                || E'    end if;\n\n';
begin
  if position('''lc_exits''' in v_def) > 0 then
    return;  -- already there (a re-run)
  end if;
  if position(v_anchor in v_def) = 0 then
    raise exception '0771: approval_apply_terminal''s final refusal was not found — add the lc branches by hand.';
  end if;
  execute replace(v_def, v_anchor, v_branch || v_anchor);
end $$;

insert into public.approval_flows (workflow_key, flow_name, description, criteria, steps, priority, is_active)
select k.key, k.flow_name, k.descr, '{}'::jsonb,
       coalesce((select f.steps from public.approval_flows f
                  where f.workflow_key = 'hr_fine' and f.flow_name = 'HR Fine — default' limit 1),
                '[{"step_order":1,"step_type":"final","step_label":"MD / HR Manager","approver_resolver":"md_or_hr_manager"}]'::jsonb),
       900, true
  from (values
    ('lc_termination', 'Termination — default',
     'Catch-all. Every termination goes to the Managing Director or an HR Manager before its exit steps open. MyJKKN used three steps (SEDC → Legal → Director): add them here if wanted.'),
    ('lc_settlement',  'Full & Final — default',
     'Catch-all. Every full & final settlement goes to the Managing Director or an HR Manager.')
  ) as k(key, flow_name, descr)
 where not exists (select 1 from public.approval_flows x where x.workflow_key = k.key);

-- ════════════════════════════════════════════════════════════════════════════
-- 7. RLS + grants
-- ════════════════════════════════════════════════════════════════════════════

alter table public.lc_settings             enable row level security;
alter table public.lc_checklist_templates  enable row level security;
alter table public.lc_onboardings          enable row level security;
alter table public.lc_onboarding_steps     enable row level security;
alter table public.lc_required_documents   enable row level security;
alter table public.lc_documents            enable row level security;
alter table public.lc_assets               enable row level security;
alter table public.lc_exit_step_catalog    enable row level security;
alter table public.lc_exits                enable row level security;
alter table public.lc_exit_steps           enable row level security;
alter table public.lc_settlements          enable row level security;

-- Shared catalogs + settings: HR view reads, HR edit writes.
do $$
declare t text;
begin
  foreach t in array array['lc_settings', 'lc_checklist_templates', 'lc_required_documents', 'lc_exit_step_catalog'] loop
    execute format('drop policy if exists %I on public.%I', t || '_read', t);
    execute format('drop policy if exists %I on public.%I', t || '_write', t);
    execute format('create policy %I on public.%I for select using (public.has_permission(''hr_payroll'', ''view''))',
                   t || '_read', t);
    execute format('create policy %I on public.%I for all using (public.has_permission(''hr_payroll'', ''edit'')) '
                   'with check (public.has_permission(''hr_payroll'', ''edit''))', t || '_write', t);
  end loop;
end $$;

-- Person records: HR reads the current unit; a staff member reads their own.
drop policy if exists lc_onb_read on public.lc_onboardings;
create policy lc_onb_read on public.lc_onboardings for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or (staff_id is not null and staff_id = public.timeoff_my_staff_id()));

drop policy if exists lc_onb_steps_read on public.lc_onboarding_steps;
create policy lc_onb_steps_read on public.lc_onboarding_steps for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or exists (select 1 from public.lc_onboardings o
                     where o.id = onboarding_id and o.staff_id is not null and o.staff_id = public.timeoff_my_staff_id()));

drop policy if exists lc_doc_read on public.lc_documents;
create policy lc_doc_read on public.lc_documents for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or (staff_id is not null and staff_id = public.timeoff_my_staff_id()));

drop policy if exists lc_exit_read on public.lc_exits;
create policy lc_exit_read on public.lc_exits for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or (staff_id is not null and staff_id = public.timeoff_my_staff_id()));

drop policy if exists lc_exit_steps_read on public.lc_exit_steps;
create policy lc_exit_steps_read on public.lc_exit_steps for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or exists (select 1 from public.lc_exits e
                     where e.id = exit_id and e.staff_id is not null and e.staff_id = public.timeoff_my_staff_id()));

-- A settlement is HR's working paper until it is approved; the person sees
-- their own once approved or paid.
drop policy if exists lc_fnf_read on public.lc_settlements;
create policy lc_fnf_read on public.lc_settlements for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or (staff_id is not null and staff_id = public.timeoff_my_staff_id() and status in ('approved', 'paid')));

-- Assets: a plain register. HR writes in its unit; a person reads their own.
drop policy if exists lc_asset_read  on public.lc_assets;
drop policy if exists lc_asset_write on public.lc_assets;
drop policy if exists lc_asset_edit  on public.lc_assets;
drop policy if exists lc_asset_del   on public.lc_assets;
create policy lc_asset_read on public.lc_assets for select
  using ((public.has_permission('hr_payroll', 'view') and public.is_current_location(location_id))
         or (staff_id is not null and staff_id = public.timeoff_my_staff_id()));
create policy lc_asset_write on public.lc_assets for insert
  with check (public.has_permission('hr_payroll', 'create') and public.is_current_location(location_id));
create policy lc_asset_edit on public.lc_assets for update
  using (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id))
  with check (public.has_permission('hr_payroll', 'edit') and public.is_current_location(location_id));
create policy lc_asset_del on public.lc_assets for delete
  using (public.has_permission('hr_payroll', 'delete') and public.is_current_location(location_id));

revoke insert, update, delete on public.lc_onboardings      from anon, authenticated;
revoke insert, update, delete on public.lc_onboarding_steps from anon, authenticated;
revoke insert, update, delete on public.lc_documents        from anon, authenticated;
revoke insert, update, delete on public.lc_exits            from anon, authenticated;
revoke insert, update, delete on public.lc_exit_steps       from anon, authenticated;
revoke insert, update, delete on public.lc_settlements      from anon, authenticated;
revoke insert, delete         on public.lc_settings         from anon, authenticated;

revoke all on function public.lc_is_hr(uuid, text)                                      from public, anon, authenticated;
revoke all on function public.lc_person_pay(uuid, uuid)                                 from public, anon, authenticated;
revoke all on function public.lc_start_onboarding(uuid, uuid, uuid, date)               from public, anon;
revoke all on function public.lc_tick_onboarding_step(uuid, boolean, text)              from public, anon;
revoke all on function public.lc_cancel_onboarding(uuid, text)                          from public, anon;
revoke all on function public.lc_doc_key_ok(text, text)                                 from public, anon;
revoke all on function public.lc_doc_folder(uuid, uuid)                                  from public, anon;
revoke all on function public.lc_register_document(uuid, uuid, uuid, text, text, text, text, date, date) from public, anon;
revoke all on function public.lc_review_document(uuid[], text, text)                    from public, anon;
revoke all on function public.lc_seed_exit_steps(uuid)                                  from public, anon, authenticated;
revoke all on function public.lc_open_exit(uuid, uuid, text, date, date, text, text, boolean) from public, anon;
revoke all on function public.lc_exit_apply_decision(uuid, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.lc_tick_exit_step(uuid, boolean, text)                    from public, anon;
revoke all on function public.lc_withdraw_exit(uuid, text)                              from public, anon;
revoke all on function public.lc_complete_exit(uuid, boolean)                           from public, anon;
revoke all on function public.lc_retirements_due()                                      from public, anon;
revoke all on function public.lc_settlement_prefill(uuid)                               from public, anon;
revoke all on function public.lc_save_settlement(uuid, jsonb)                           from public, anon;
revoke all on function public.lc_submit_settlement(uuid)                                from public, anon;
revoke all on function public.lc_recall_settlement(uuid, text)                          from public, anon;
revoke all on function public.lc_settlement_apply_decision(uuid, text, uuid, text, timestamptz) from public, anon, authenticated;
revoke all on function public.lc_mark_settlement_paid(uuid, text)                       from public, anon;
revoke all on function public.approval_apply_terminal()                                 from public, anon;

-- lc_doc_key_ok is read by the storage policies, which run as the caller.
grant execute on function public.lc_doc_key_ok(text, text)                              to authenticated;
grant execute on function public.lc_doc_folder(uuid, uuid)                               to authenticated;
grant execute on function public.lc_start_onboarding(uuid, uuid, uuid, date)            to authenticated;
grant execute on function public.lc_tick_onboarding_step(uuid, boolean, text)           to authenticated;
grant execute on function public.lc_cancel_onboarding(uuid, text)                       to authenticated;
grant execute on function public.lc_register_document(uuid, uuid, uuid, text, text, text, text, date, date) to authenticated;
grant execute on function public.lc_review_document(uuid[], text, text)                 to authenticated;
grant execute on function public.lc_open_exit(uuid, uuid, text, date, date, text, text, boolean) to authenticated;
grant execute on function public.lc_tick_exit_step(uuid, boolean, text)                 to authenticated;
grant execute on function public.lc_withdraw_exit(uuid, text)                           to authenticated;
grant execute on function public.lc_complete_exit(uuid, boolean)                        to authenticated;
grant execute on function public.lc_retirements_due()                                   to authenticated;
grant execute on function public.lc_settlement_prefill(uuid)                            to authenticated;
grant execute on function public.lc_save_settlement(uuid, jsonb)                        to authenticated;
grant execute on function public.lc_submit_settlement(uuid)                             to authenticated;
grant execute on function public.lc_recall_settlement(uuid, text)                       to authenticated;
grant execute on function public.lc_mark_settlement_paid(uuid, text)                    to authenticated;
