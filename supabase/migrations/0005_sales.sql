-- ============================================================================
-- Raagam ERP — 0005 Sales & Marketing
-- Opportunity → Style card → Cost sheet (clone/revise) → Quote (+ sample).
-- ============================================================================

-- reusable human-readable code generator (PREFIX-0001) via a sequence
create or replace function public.assign_code()
returns trigger language plpgsql as $$
declare
  v_prefix text := tg_argv[0];
  v_seq    text := tg_argv[1];
begin
  if new.code is null or new.code = '' then
    new.code := v_prefix || '-' || lpad(nextval(v_seq::regclass)::text, 4, '0');
  end if;
  return new;
end;
$$;

-- ---------- opportunities ----------
create sequence if not exists public.seq_opportunity;
create table if not exists public.opportunities (
  id            uuid primary key default gen_random_uuid(),
  code          text unique,
  buyer_id      uuid not null references public.buyers(id),
  title         text not null,
  season        text,
  stage         text not null default 'enquiry'
                  check (stage in ('enquiry','costing','quoted','won','lost')),
  target_fob    numeric(14,2),
  currency_code text references public.currencies(code),
  owner_id      uuid references public.profiles(id) default auth.uid(),
  notes         text,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_opp_code before insert on public.opportunities
  for each row execute function public.assign_code('OPP','public.seq_opportunity');
create trigger trg_opp_updated before update on public.opportunities
  for each row execute function public.set_updated_at();
create index if not exists idx_opp_buyer on public.opportunities(buyer_id);
create index if not exists idx_opp_stage on public.opportunities(stage);

-- ---------- styles (style card) ----------
create table if not exists public.styles (
  id              uuid primary key default gen_random_uuid(),
  opportunity_id  uuid not null references public.opportunities(id) on delete cascade,
  style_code      text,
  name            text not null,
  fabric_type     text check (fabric_type in ('woven','circular','flat_knit')),
  fabric_subtype  text check (fabric_subtype in ('solid','yarn_dyed','melange')),
  description     text,
  image_url       text,
  specs           jsonb not null default '{}'::jsonb,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
create trigger trg_styles_updated before update on public.styles
  for each row execute function public.set_updated_at();
create index if not exists idx_styles_opp on public.styles(opportunity_id);

-- ---------- cost sheets (+ clone/revise) ----------
create table if not exists public.cost_sheets (
  id                   uuid primary key default gen_random_uuid(),
  opportunity_id       uuid not null references public.opportunities(id) on delete cascade,
  style_id             uuid references public.styles(id) on delete set null,
  version              int not null default 1,
  status               text not null default 'draft'
                         check (status in ('draft','submitted','approved','rejected','superseded')),
  currency_code        text references public.currencies(code),
  target_fob           numeric(14,2),
  computed_fob         numeric(14,2) not null default 0,
  margin_pct           numeric(6,2),
  notes                text,
  parent_cost_sheet_id uuid references public.cost_sheets(id),
  created_by           uuid references public.profiles(id) default auth.uid(),
  approved_by          uuid references public.profiles(id),
  approved_at          timestamptz,
  created_at           timestamptz not null default now(),
  updated_at           timestamptz not null default now()
);
create trigger trg_cs_updated before update on public.cost_sheets
  for each row execute function public.set_updated_at();
create index if not exists idx_cs_opp on public.cost_sheets(opportunity_id);

create table if not exists public.cost_sheet_items (
  id            uuid primary key default gen_random_uuid(),
  cost_sheet_id uuid not null references public.cost_sheets(id) on delete cascade,
  category      text not null default 'material'
                  check (category in ('material','labour','overhead','other')),
  description   text not null,
  quantity      numeric(14,3) not null default 0,
  uom_id        uuid references public.uoms(id),
  unit_cost     numeric(14,4) not null default 0,
  amount        numeric(14,2) not null default 0,
  sort_order    int not null default 0
);
create index if not exists idx_csi_sheet on public.cost_sheet_items(cost_sheet_id);

-- ---------- quotes ----------
create sequence if not exists public.seq_quote;
create table if not exists public.quotes (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  cost_sheet_id  uuid references public.cost_sheets(id),
  buyer_id       uuid not null references public.buyers(id),
  fob_price      numeric(14,2) not null default 0,
  currency_code  text references public.currencies(code),
  quantity       numeric(14,0),
  incoterm       text default 'FOB',
  include_sample boolean not null default false,
  status         text not null default 'draft'
                   check (status in ('draft','sent','accepted','rejected')),
  valid_until    date,
  sent_at        timestamptz,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_quote_code before insert on public.quotes
  for each row execute function public.assign_code('QT','public.seq_quote');
create trigger trg_quote_updated before update on public.quotes
  for each row execute function public.set_updated_at();

-- ---------- samples ----------
create table if not exists public.samples (
  id             uuid primary key default gen_random_uuid(),
  opportunity_id uuid not null references public.opportunities(id) on delete cascade,
  style_id       uuid references public.styles(id) on delete set null,
  quote_id       uuid references public.quotes(id) on delete set null,
  type           text not null default 'proto'
                   check (type in ('proto','fit','sms','pp','top')),
  status         text not null default 'requested'
                   check (status in ('requested','in_progress','sent','approved','rejected')),
  dispatched_at  timestamptz,
  courier_ref    text,
  notes          text,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_samples_updated before update on public.samples
  for each row execute function public.set_updated_at();

-- ---------- RLS (all gated by 'sales' module) ----------
do $$
declare t text;
begin
  foreach t in array array[
    'opportunities','styles','cost_sheets','cost_sheet_items','quotes','samples'
  ] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('sales','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('sales','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('sales','edit'))
        with check (public.has_permission('sales','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('sales','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
