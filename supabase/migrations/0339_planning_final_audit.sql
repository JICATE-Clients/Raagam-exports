-- ============================================================================
-- Raagam ERP — 0339 Planning final audit catch-up
-- Adds missing updated_at to fabric_consumption_sizes.
-- ============================================================================

alter table public.fabric_consumption_sizes
  add column if not exists updated_at timestamptz not null default now();

do $$
begin
  if not exists (
    select 1 from pg_trigger where tgname = 'trg_fabric_consumption_sizes_updated'
  ) then
    create trigger trg_fabric_consumption_sizes_updated
      before update on public.fabric_consumption_sizes
      for each row execute function public.set_updated_at();
  end if;
end $$;
