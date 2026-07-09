-- ============================================================================
-- Raagam ERP — 0248 Master Data ▸ Associates ▸ Consignee: General + Notify tabs
-- Adds the two deferred tabs from 0245:
--   General tab — same shape as the Applicant General tab (currency 1/2/3 →
--     currencies · Ship Mode/Pay Mode fixed lists · Ship Type → config_lookups
--     'ship_type' · Payment Terms → config_lookups 'payment_term' · Bank → banks
--     · A/c No.) PLUS a Registration block (TIN No. [3 boxes] · PAN No · GST No)
--     and a "Marking" child grid (S No + Marking text).
--   Notify tab — a child grid of Notify-party references (SlNo · Notify Short
--     Name → notifies ⓘ · Country [display, from the notify]).
--
-- Kinds ship_type / payment_term already exist (0241); no CHECK change needed.
-- ============================================================================

-- 1) General-tab columns on consignees (additive).
alter table public.consignees
  add column if not exists currency_1       text references public.currencies(code),
  add column if not exists currency_2       text references public.currencies(code),
  add column if not exists currency_3       text references public.currencies(code),
  add column if not exists ship_mode        text,
  add column if not exists ship_type_id     uuid references public.config_lookups(id) on delete set null,
  add column if not exists pay_mode         text,
  add column if not exists payment_term_id  uuid references public.config_lookups(id) on delete set null,
  add column if not exists bank_id          uuid references public.banks(id) on delete set null,
  add column if not exists ac_no            text,
  -- Registration block
  add column if not exists tin_no           text,
  add column if not exists tin_no_2         text,   -- small middle box
  add column if not exists tin_no_3         text,   -- third box
  add column if not exists pan_no           text,
  add column if not exists gst_no           text;

-- 2) Marking child grid (General tab, right side).
create table if not exists public.consignee_markings (
  id           uuid primary key default gen_random_uuid(),
  consignee_id uuid not null references public.consignees(id) on delete cascade,
  sno          integer not null default 0,
  marking      text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_consignee_markings_updated before update on public.consignee_markings
  for each row execute function public.set_updated_at();
create index if not exists idx_consignee_markings_consignee on public.consignee_markings(consignee_id);

-- 3) Notify-party references child grid (Notify tab).
create table if not exists public.consignee_notifies (
  id           uuid primary key default gen_random_uuid(),
  consignee_id uuid not null references public.consignees(id) on delete cascade,
  sno          integer not null default 0,
  notify_id    uuid references public.notifies(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create trigger trg_consignee_notifies_updated before update on public.consignee_notifies
  for each row execute function public.set_updated_at();
create index if not exists idx_consignee_notifies_consignee on public.consignee_notifies(consignee_id);

-- 4) RLS for the two new child tables (read open; write gated by 'masters').
do $$
declare t text;
begin
  foreach t in array array['consignee_markings','consignee_notifies'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated using (true);
      create policy %1$s_insert on public.%1$s for insert to authenticated with check (public.has_permission('masters','create'));
      create policy %1$s_update on public.%1$s for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated using (public.has_permission('masters','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
