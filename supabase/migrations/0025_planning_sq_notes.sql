-- ============================================================================
-- Raagam ERP — 0025 Planning ▸ SQ Notes & Allocation
-- Additive sub-module (legacy EDP2: Planning ▸ "SQ Note / SQ Allocation
-- (+ Allocation Amendment, SQ Cancellation)"). A Sample-Quote note with
-- material/qty allocation lines; draft → allocated → cancelled (amendment =
-- edit lines while draft). Gated by the EXISTING 'planning' permission.
-- ============================================================================

create sequence if not exists public.seq_sq_note;
create table if not exists public.sq_notes (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                  -- SQN-0001
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  buyer_id       uuid references public.buyers(id) on delete set null,
  description    text not null,
  status         text not null default 'draft'
                   check (status in ('draft','allocated','cancelled')),
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_sq_note_code before insert on public.sq_notes
  for each row execute function public.assign_code('SQN','public.seq_sq_note');
create trigger trg_sq_note_updated before update on public.sq_notes
  for each row execute function public.set_updated_at();
create index if not exists idx_sq_notes_order  on public.sq_notes(sales_order_id);
create index if not exists idx_sq_notes_status on public.sq_notes(status);

create table if not exists public.sq_allocations (
  id            uuid primary key default gen_random_uuid(),
  sq_note_id    uuid not null references public.sq_notes(id) on delete cascade,
  item_id       uuid references public.items(id),
  description   text not null,
  allocated_qty numeric(14,3) not null default 0,
  uom_id        uuid references public.uoms(id),
  sort_order    int not null default 0
);
create index if not exists idx_sq_alloc_note on public.sq_allocations(sq_note_id);

do $$
declare t text;
begin
  foreach t in array array['sq_notes','sq_allocations'] loop
    execute format($f$
      create policy %1$s_read on public.%1$s
        for select to authenticated using (public.has_permission('planning','view'));
      create policy %1$s_insert on public.%1$s
        for insert to authenticated with check (public.has_permission('planning','create'));
      create policy %1$s_update on public.%1$s
        for update to authenticated
        using (public.has_permission('planning','edit'))
        with check (public.has_permission('planning','edit'));
      create policy %1$s_delete on public.%1$s
        for delete to authenticated using (public.has_permission('planning','delete'));
    $f$, t);
    execute format('alter table public.%I enable row level security;', t);
  end loop;
end $$;
