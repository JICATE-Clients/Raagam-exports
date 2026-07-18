-- ============================================================================
-- Raagam ERP — 0321 Sales ▸ SQ Detail + SQ Groups/Notes/Cancellation
--
-- SQ Detail = Sales Quote allocation document. Links opportunities to orders
-- with pack/quantity breakdowns by combo and size. Tracks delivery windows,
-- excess/rejection tolerances, and merchandiser assignment.
--
-- SQ Groups = logical grouping of multiple SQs by customer.
-- SQ Notes = free-text remarks per SQ.
-- SQ Cancellation = cancellation record with reason tracking.
-- ============================================================================

-- ==========================================================================
-- 1. SQ Details (Sales Quote — quantity allocation)
-- ==========================================================================
create sequence if not exists public.seq_sq_detail;
create table if not exists public.sq_details (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  opportunity_id        uuid not null references public.opportunities(id) on delete cascade,
  sq_date               date not null default current_date,
  customer_id           uuid references public.buyers(id),
  sq_sub_type           text check (sq_sub_type is null or sq_sub_type in ('orders','salesman_sample')),
  sourcing_type         text check (sourcing_type is null or sourcing_type in ('in_house','outsource')),
  merchandiser_id       uuid references public.profiles(id),
  delivery_date         date,
  proposed_delivery_date date,
  delivery_window_from  date,
  delivery_window_to    date,
  uom_id                text,
  order_qty             numeric(14,3) default 0,
  excess_pct            numeric(8,2) default 0,
  excess_qty            numeric(14,3) default 0,
  rejection_pct         numeric(8,2) default 0,
  rejection_qty         numeric(14,3) default 0,
  approval_qty          numeric(14,3) default 0,
  gross_qty             numeric(14,3) default 0,
  sq_qty                numeric(14,3) default 0,
  sq_description        text,
  amendment_sno         integer default 0,
  is_cancelled          boolean not null default false,
  status                text not null default 'draft'
    check (status in ('draft','confirmed','cancelled')),
  notes                 text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_sq_detail_code before insert on public.sq_details
  for each row execute function public.assign_code('SQ','public.seq_sq_detail');
create trigger trg_sq_detail_updated before update on public.sq_details
  for each row execute function public.set_updated_at();
create index if not exists idx_sq_details_opp on public.sq_details(opportunity_id);
create index if not exists idx_sq_details_cust on public.sq_details(customer_id);

-- ==========================================================================
-- 2. SQ Packs — shipment packing breakdown
-- ==========================================================================
create table if not exists public.sq_packs (
  id                    uuid primary key default gen_random_uuid(),
  sq_detail_id          uuid not null references public.sq_details(id) on delete cascade,
  sno                   integer not null default 0,
  country_code          text,
  pack_no               integer,
  customer_order_no     text,
  design                text,
  consignee_name        text,
  assortment_type       text check (assortment_type is null or assortment_type in ('solid','assorted')),
  no_of_cartons         integer,
  sq_qty                numeric(14,3) default 0,
  delivery_date         date,
  excess_pct            numeric(8,2) default 0,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_sq_packs_updated before update on public.sq_packs
  for each row execute function public.set_updated_at();
create index if not exists idx_sq_packs_sq on public.sq_packs(sq_detail_id);

-- ==========================================================================
-- 3. SQ Quantities — per-style quantity breakdown
-- ==========================================================================
create table if not exists public.sq_quantities (
  id                    uuid primary key default gen_random_uuid(),
  sq_detail_id          uuid not null references public.sq_details(id) on delete cascade,
  sq_pack_id            uuid references public.sq_packs(id) on delete cascade,
  sno                   integer not null default 0,
  style_ref_no          text,
  style_no              text,
  article_no            text,
  uom_id                text,
  order_qty             numeric(14,3) default 0,
  excess_qty            numeric(14,3) default 0,
  approval_qty          numeric(14,3) default 0,
  gross_qty             numeric(14,3) default 0,
  rejection_qty         numeric(14,3) default 0,
  rejection_pct         numeric(8,2) default 0,
  sq_qty                numeric(14,3) default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_sq_qty_sq on public.sq_quantities(sq_detail_id);
create index if not exists idx_sq_qty_pack on public.sq_quantities(sq_pack_id);

-- ==========================================================================
-- 4. SQ Quantity Combos — color/combo breakdown per quantity line
-- ==========================================================================
create table if not exists public.sq_qty_combos (
  id                    uuid primary key default gen_random_uuid(),
  sq_quantity_id        uuid not null references public.sq_quantities(id) on delete cascade,
  sno                   integer not null default 0,
  combo                 text,
  order_qty             numeric(14,3) default 0,
  excess_qty            numeric(14,3) default 0,
  approval_qty          numeric(14,3) default 0,
  gross_qty             numeric(14,3) default 0,
  rejection_qty         numeric(14,3) default 0,
  rejection_pct         numeric(8,2) default 0,
  sq_qty                numeric(14,3) default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_sq_qty_combos_qty on public.sq_qty_combos(sq_quantity_id);

-- ==========================================================================
-- 5. SQ Quantity Sizes — size breakdown per combo
-- ==========================================================================
create table if not exists public.sq_qty_sizes (
  id                    uuid primary key default gen_random_uuid(),
  sq_qty_combo_id       uuid references public.sq_qty_combos(id) on delete cascade,
  sq_quantity_id        uuid references public.sq_quantities(id) on delete cascade,
  sno                   integer not null default 0,
  garment_size          text not null,
  order_qty             numeric(14,3) default 0,
  excess_qty            numeric(14,3) default 0,
  approval_qty          numeric(14,3) default 0,
  gross_qty             numeric(14,3) default 0,
  rejection_qty         numeric(14,3) default 0,
  rejection_pct         numeric(8,2) default 0,
  sq_qty                numeric(14,3) default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_sq_qty_sizes_combo on public.sq_qty_sizes(sq_qty_combo_id);
create index if not exists idx_sq_qty_sizes_qty on public.sq_qty_sizes(sq_quantity_id);

-- ==========================================================================
-- 6. SQ Groups — group multiple SQs for a customer
-- ==========================================================================
create sequence if not exists public.seq_sq_group;
create table if not exists public.sq_groups (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  group_date            date not null default current_date,
  group_description     text,
  customer_id           uuid references public.buyers(id),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_sq_group_code before insert on public.sq_groups
  for each row execute function public.assign_code('SQG','public.seq_sq_group');
create trigger trg_sq_group_updated before update on public.sq_groups
  for each row execute function public.set_updated_at();

-- ==========================================================================
-- 7. SQ Group Members — SQs in a group
-- ==========================================================================
create table if not exists public.sq_group_members (
  id                    uuid primary key default gen_random_uuid(),
  sq_group_id           uuid not null references public.sq_groups(id) on delete cascade,
  sq_detail_id          uuid not null references public.sq_details(id) on delete cascade,
  sno                   integer not null default 0,
  created_at            timestamptz not null default now()
);
create index if not exists idx_sq_grp_members_grp on public.sq_group_members(sq_group_id);

-- ==========================================================================
-- 8. SQ Notes — free-text notes per SQ
-- ==========================================================================
create sequence if not exists public.seq_sq_detail_note;
create table if not exists public.sq_detail_notes (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  sq_detail_id          uuid not null references public.sq_details(id) on delete cascade,
  entry_date            date not null default current_date,
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_sq_detail_note_code before insert on public.sq_detail_notes
  for each row execute function public.assign_code('SQN','public.seq_sq_detail_note');
create trigger trg_sq_detail_note_updated before update on public.sq_detail_notes
  for each row execute function public.set_updated_at();
create index if not exists idx_sq_detail_notes_sq on public.sq_detail_notes(sq_detail_id);

-- ==========================================================================
-- 9. SQ Cancellations — cancellation with reason
-- ==========================================================================
create sequence if not exists public.seq_sq_cancel;
create table if not exists public.sq_cancellations (
  id                    uuid primary key default gen_random_uuid(),
  code                  text unique,
  sq_detail_id          uuid not null references public.sq_details(id) on delete cascade,
  entry_date            date not null default current_date,
  reason                text,
  task_owner            text,
  notes                 text,
  created_by            uuid references public.profiles(id) default auth.uid(),
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now()
);
create trigger trg_sq_cancel_code before insert on public.sq_cancellations
  for each row execute function public.assign_code('SQC','public.seq_sq_cancel');
create trigger trg_sq_cancel_updated before update on public.sq_cancellations
  for each row execute function public.set_updated_at();
create index if not exists idx_sq_cancel_sq on public.sq_cancellations(sq_detail_id);

-- ==========================================================================
-- 10. RLS
-- ==========================================================================
do $$
declare t text;
begin
  foreach t in array array[
    'sq_details','sq_packs','sq_quantities','sq_qty_combos','sq_qty_sizes',
    'sq_groups','sq_group_members','sq_detail_notes','sq_cancellations'
  ] loop
    execute format('alter table public.%I enable row level security;', t);
    execute format($f$
      create policy %1$s_read on public.%1$s for select to authenticated
        using (public.has_permission('sales','view'));
      create policy %1$s_insert on public.%1$s for insert to authenticated
        with check (public.has_permission('sales','create'));
      create policy %1$s_update on public.%1$s for update to authenticated
        using (public.has_permission('sales','edit'))
        with check (public.has_permission('sales','edit'));
      create policy %1$s_delete on public.%1$s for delete to authenticated
        using (public.has_permission('sales','delete'));
    $f$, t);
  end loop;
end $$;
