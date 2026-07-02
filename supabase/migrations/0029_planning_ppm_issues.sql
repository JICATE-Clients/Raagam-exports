-- ============================================================================
-- Raagam ERP — 0029 Planning ▸ Issue PPM (Production Planning Material)
-- Additive sub-module (legacy EDP2: Planning ▸ "Issue PPM for garment
-- production (+ receipt completion, cancellation, rate amendment)"). Issues
-- planned materials for garment production with lines; draft → issued →
-- received → cancelled. Line rate is amendable while draft/issued. 'planning'.
-- ============================================================================

create sequence if not exists public.seq_ppm_issue;
create table if not exists public.ppm_issues (
  id             uuid primary key default gen_random_uuid(),
  code           text unique,                                  -- PPM-0001
  sales_order_id uuid references public.sales_orders(id) on delete set null,
  description    text,
  issue_date     date,
  status         text not null default 'draft'
                   check (status in ('draft','issued','received','cancelled')),
  notes          text,
  created_by     uuid references public.profiles(id) default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create trigger trg_ppm_code before insert on public.ppm_issues
  for each row execute function public.assign_code('PPM','public.seq_ppm_issue');
create trigger trg_ppm_updated before update on public.ppm_issues
  for each row execute function public.set_updated_at();
create index if not exists idx_ppm_order  on public.ppm_issues(sales_order_id);
create index if not exists idx_ppm_status on public.ppm_issues(status);

create table if not exists public.ppm_issue_lines (
  id            uuid primary key default gen_random_uuid(),
  ppm_issue_id  uuid not null references public.ppm_issues(id) on delete cascade,
  item_id       uuid references public.items(id),
  description   text not null,
  issued_qty    numeric(14,3) not null default 0,
  received_qty  numeric(14,3) not null default 0,
  uom_id        uuid references public.uoms(id),
  rate          numeric(14,4) not null default 0,
  sort_order    int not null default 0
);
create index if not exists idx_ppm_lines_issue on public.ppm_issue_lines(ppm_issue_id);

do $$
declare t text;
begin
  foreach t in array array['ppm_issues','ppm_issue_lines'] loop
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
