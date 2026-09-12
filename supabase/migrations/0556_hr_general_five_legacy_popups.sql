-- ===========================================================================
-- 0556 — the five legacy popups hanging off General, for staff AND workers.
--
-- EDP4 ▸ Staff ▸ General reaches five child windows this build never had
-- (client 2026-09-12, five screenshots: "we missed this 5 child in general add
-- these i want all fields from here"):
--
--   Enclosure              flat  — the document numbers a joiner hands in
--   Education & Technical  GRIDS — two lists: schooling, and trade training
--   Language Details       GRID  — speak / read / write, one row per tongue
--   Details                flat  — how they came to us, and their household
--   Other Details          flat  — physical particulars, IDs submitted, grade
--
-- ## FLAT WHERE LEGACY IS FLAT, A TABLE WHERE LEGACY IS A GRID
--
-- The same call 0534–0536 made. A popup of fixed boxes is columns on the
-- person; a popup with an `S No` column and a row cursor is a child table.
-- Getting this backwards is what 0536 had to be reversed for.
--
-- ## HEIGHT AND WEIGHT ARE ONE PAIR, NOT TWO
--
-- They appear on BOTH the "Details" and "Other Details" popups in legacy — the
-- same two numbers rendered twice. Stored once and shown on Other Details,
-- whose whole subject is physical particulars. Two columns would let one record
-- hold two different heights.
--
-- ## WORKERS GET ALL OF IT
--
-- 0553 established that a worker's record IS the staff record, so every column
-- here lands on both tables and every child table takes either parent.
-- ===========================================================================

-- ---------- Enclosure ----------
alter table public.staff
  add column if not exists passbook_no          text,
  add column if not exists ration_card_no       text,
  add column if not exists insurance_policy_no  text,
  add column if not exists passport_no          text,
  add column if not exists passport_valid_upto  date,
  add column if not exists election_card_no     text,
  add column if not exists uan_no               text,
  add column if not exists interview_date       date;

alter table public.workers
  add column if not exists passbook_no          text,
  add column if not exists ration_card_no       text,
  add column if not exists insurance_policy_no  text,
  add column if not exists passport_no          text,
  add column if not exists passport_valid_upto  date,
  add column if not exists election_card_no     text,
  add column if not exists uan_no               text,
  add column if not exists interview_date       date;

-- ---------- "Details": how they reached us, and their household ----------
-- The three "Through …" questions are Yes/No radios in legacy, so boolean with
-- a false default rather than a nullable tri-state: legacy cannot record "not
-- asked" either, and a nullable boolean would invent a state the source screen
-- has no way to produce.
alter table public.staff
  add column if not exists through_advertisement   boolean not null default false,
  add column if not exists through_voluntarily     boolean not null default false,
  add column if not exists through_knowledge       boolean not null default false,
  add column if not exists bus_no                  text,
  add column if not exists physique_illness        text,
  add column if not exists occupation              text,
  add column if not exists no_of_children          smallint,
  add column if not exists dependants              smallint,
  add column if not exists earning_members         smallint,
  add column if not exists properties_owned        text,
  add column if not exists professional_membership text,
  add column if not exists extra_curricular        text,
  add column if not exists achievement_details     text,
  add column if not exists disciplinary_actions    text;

alter table public.workers
  add column if not exists through_advertisement   boolean not null default false,
  add column if not exists through_voluntarily     boolean not null default false,
  add column if not exists through_knowledge       boolean not null default false,
  add column if not exists bus_no                  text,
  add column if not exists physique_illness        text,
  add column if not exists occupation              text,
  add column if not exists no_of_children          smallint,
  add column if not exists dependants              smallint,
  add column if not exists earning_members         smallint,
  add column if not exists properties_owned        text,
  add column if not exists professional_membership text,
  add column if not exists extra_curricular        text,
  add column if not exists achievement_details     text,
  add column if not exists disciplinary_actions    text;

-- ---------- "Other Details": physical particulars, IDs submitted, grade ------
-- `id_submitted_*` are nine independent tick boxes, so nine booleans rather
-- than one text[]: each is a separate question legacy asks, and an array could
-- not be filtered or counted without unnesting it on every read.
alter table public.staff
  add column if not exists mother_tongue           text,
  add column if not exists height_cm               numeric(6,2),
  add column if not exists weight_kg               numeric(6,2),
  add column if not exists eye_sight               text,
  add column if not exists house_type              text,
  add column if not exists id_submitted_dl         boolean not null default false,
  add column if not exists id_submitted_vote_id    boolean not null default false,
  add column if not exists id_submitted_ration     boolean not null default false,
  add column if not exists id_submitted_passport   boolean not null default false,
  add column if not exists id_submitted_tc         boolean not null default false,
  add column if not exists id_submitted_mark_sheet boolean not null default false,
  add column if not exists id_submitted_aadhaar    boolean not null default false,
  add column if not exists id_submitted_pan        boolean not null default false,
  add column if not exists id_submitted_others     boolean not null default false,
  add column if not exists id_submitted_specify    text,
  add column if not exists prior_experience        text,
  add column if not exists handicap_details        text,
  add column if not exists has_passport            boolean not null default false,
  add column if not exists two_wheeler_licence     boolean not null default false,
  add column if not exists four_wheeler_licence    boolean not null default false,
  add column if not exists major_operation         boolean not null default false,
  add column if not exists operation_details       text,
  add column if not exists only_earning_member     boolean not null default false,
  add column if not exists willing_donate_blood    boolean not null default false,
  add column if not exists grade                   text,
  add column if not exists employee_classification text;

alter table public.workers
  add column if not exists mother_tongue           text,
  add column if not exists height_cm               numeric(6,2),
  add column if not exists weight_kg               numeric(6,2),
  add column if not exists eye_sight               text,
  add column if not exists house_type              text,
  add column if not exists id_submitted_dl         boolean not null default false,
  add column if not exists id_submitted_vote_id    boolean not null default false,
  add column if not exists id_submitted_ration     boolean not null default false,
  add column if not exists id_submitted_passport   boolean not null default false,
  add column if not exists id_submitted_tc         boolean not null default false,
  add column if not exists id_submitted_mark_sheet boolean not null default false,
  add column if not exists id_submitted_aadhaar    boolean not null default false,
  add column if not exists id_submitted_pan        boolean not null default false,
  add column if not exists id_submitted_others     boolean not null default false,
  add column if not exists id_submitted_specify    text,
  add column if not exists prior_experience        text,
  add column if not exists handicap_details        text,
  add column if not exists has_passport            boolean not null default false,
  add column if not exists two_wheeler_licence     boolean not null default false,
  add column if not exists four_wheeler_licence    boolean not null default false,
  add column if not exists major_operation         boolean not null default false,
  add column if not exists operation_details       text,
  add column if not exists only_earning_member     boolean not null default false,
  add column if not exists willing_donate_blood    boolean not null default false,
  add column if not exists grade                   text,
  add column if not exists employee_classification text;

-- ---------- the three grids ----------
-- Same shape as the eight `hr_*` child tables 0553 settled on: either parent,
-- exactly one, `sno` for the operator's row number, RLS keyed on the
-- `hr_payroll` permission rather than on ownership.
create table if not exists public.hr_education (
  id                uuid primary key default gen_random_uuid(),
  staff_id          uuid references public.staff(id)   on delete cascade,
  worker_id         uuid references public.workers(id) on delete cascade,
  sno               integer not null,
  type_of_training  text,
  institution       text,
  month_year_passed text,
  class_marks       text,
  special_subjects  text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint hr_education_one_parent check ((staff_id is null) <> (worker_id is null))
);

create table if not exists public.hr_technical_details (
  id            uuid primary key default gen_random_uuid(),
  staff_id      uuid references public.staff(id)   on delete cascade,
  worker_id     uuid references public.workers(id) on delete cascade,
  sno           integer not null,
  qualification text,
  institution   text,
  major_subject text,
  class_pct     text,
  duration      text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint hr_technical_one_parent check ((staff_id is null) <> (worker_id is null))
);

create table if not exists public.hr_languages (
  id         uuid primary key default gen_random_uuid(),
  staff_id   uuid references public.staff(id)   on delete cascade,
  worker_id  uuid references public.workers(id) on delete cascade,
  sno        integer not null,
  language   text,
  can_speak  boolean not null default false,
  can_read   boolean not null default false,
  can_write  boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint hr_languages_one_parent check ((staff_id is null) <> (worker_id is null))
);

create index if not exists idx_hr_education_staff  on public.hr_education (staff_id);
create index if not exists idx_hr_education_worker on public.hr_education (worker_id);
create index if not exists idx_hr_technical_staff  on public.hr_technical_details (staff_id);
create index if not exists idx_hr_technical_worker on public.hr_technical_details (worker_id);
create index if not exists idx_hr_languages_staff  on public.hr_languages (staff_id);
create index if not exists idx_hr_languages_worker on public.hr_languages (worker_id);

do $do$
declare t text;
begin
  foreach t in array array['hr_education','hr_technical_details','hr_languages'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('create policy %I on public.%I for select using (true)',
                   t || '_read', t);
    execute format('create policy %I on public.%I for insert with check (has_permission(''hr_payroll'',''create''))',
                   t || '_insert', t);
    execute format('create policy %I on public.%I for update using (has_permission(''hr_payroll'',''edit''))',
                   t || '_update', t);
    execute format('create policy %I on public.%I for delete using (has_permission(''hr_payroll'',''delete''))',
                   t || '_delete', t);
    execute format('create trigger %I before update on public.%I for each row execute function public.set_updated_at()',
                   'trg_' || t || '_updated', t);
  end loop;
end $do$;
