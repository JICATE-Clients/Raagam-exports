-- ============================================================================
-- Raagam ERP — 0263 Master Data ▸ GST ▸ HSN detail
-- Legacy EDP2 "HSN detail" form (screenshot _16312): a flat master —
-- Item Class (red ⓘ → config_lookups 'item_class') · For (Materials / Process)
-- · Description · HSN Code · Blocked + Save / Save As Drafts (→ is_draft).
-- Richer than the simple `hsn_code` config_lookups kind (0231) that the
-- Material/Process/Commodity HSN pickers reference — see
-- doc/masters-open-questions.md (should those re-point at this table?).
-- RLS = masters (read open, write gated by has_permission('masters', …)).
-- ============================================================================

create table if not exists public.hsn_details (
  id            uuid primary key default gen_random_uuid(),
  item_class_id uuid not null references public.config_lookups(id),
  for_type      text not null default 'materials'
                  check (for_type in ('materials','process')),
  description   text,
  hsn_code      text,
  blocked       boolean not null default false,
  is_draft      boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create trigger trg_hsn_details_updated before update on public.hsn_details
  for each row execute function public.set_updated_at();
create index if not exists idx_hsn_details_item_class on public.hsn_details(item_class_id);

do $$
begin
  execute $f$
    create policy hsn_details_read on public.hsn_details for select to authenticated using (true);
    create policy hsn_details_insert on public.hsn_details for insert to authenticated with check (public.has_permission('masters','create'));
    create policy hsn_details_update on public.hsn_details for update to authenticated using (public.has_permission('masters','edit')) with check (public.has_permission('masters','edit'));
    create policy hsn_details_delete on public.hsn_details for delete to authenticated using (public.has_permission('masters','delete'));
  $f$;
  alter table public.hsn_details enable row level security;
end $$;
