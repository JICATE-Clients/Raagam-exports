-- ============================================================================
-- 0354  GSTIN lookup cache
--
-- Backs the OPTIONAL online GSTIN lookup (lib/masters/gstin-lookup-actions.ts).
-- Dormant until a provider is configured — no provider is registered today, so
-- nothing writes here yet.
--
-- Exists because every GSTIN lookup provider bills per call while the registry
-- facts behind a GSTIN change rarely: legal name, trade name and constitution
-- are effectively static, and status/filing data moves on the order of months.
-- Keyed by GSTIN rather than by vendor so two vendors sharing a PAN, or a GSTIN
-- re-typed on a different master later, both hit the same cached answer.
--
-- Nothing here duplicates what the GST NUMBER ITSELF encodes (state, PAN,
-- constitution, checksum) — that is decoded offline in lib/validation/gstin.ts
-- and never needs a round trip.
-- ============================================================================

create table if not exists public.gstin_lookup_cache (
  gstin               text primary key,
  -- Which adapter produced this row, so a provider switch stays traceable.
  provider            text not null,
  -- ok | not_found | error — negative answers are cached too, so a typo'd GSTIN
  -- isn't re-billed on every retry.
  status              text not null default 'ok',

  legal_name          text,
  trade_name          text,
  constitution        text,
  taxpayer_type       text,
  gst_status          text,
  registered_on       date,
  cancelled_on        date,
  principal_address   text,
  state_code          text,
  jurisdiction_centre text,
  jurisdiction_state  text,
  nature_of_business  text[],

  -- Verbatim provider payload. Kept so a later parser change can re-derive the
  -- normalized columns without paying for the same lookups again.
  raw                 jsonb,
  error_message       text,

  fetched_at          timestamptz not null default now(),
  expires_at          timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now()
);

drop trigger if exists trg_gstin_lookup_cache_updated on public.gstin_lookup_cache;
create trigger trg_gstin_lookup_cache_updated before update on public.gstin_lookup_cache
  for each row execute function public.set_updated_at();

create index if not exists idx_gstin_lookup_cache_expires
  on public.gstin_lookup_cache (expires_at);

-- ---------- RLS (read open like other masters; write gated by 'masters') ----------
alter table public.gstin_lookup_cache enable row level security;

drop policy if exists gstin_lookup_cache_read on public.gstin_lookup_cache;
create policy gstin_lookup_cache_read on public.gstin_lookup_cache
  for select to authenticated using (true);

drop policy if exists gstin_lookup_cache_insert on public.gstin_lookup_cache;
create policy gstin_lookup_cache_insert on public.gstin_lookup_cache
  for insert to authenticated with check (public.has_permission('masters','edit'));

drop policy if exists gstin_lookup_cache_update on public.gstin_lookup_cache;
create policy gstin_lookup_cache_update on public.gstin_lookup_cache
  for update to authenticated using (public.has_permission('masters','edit'))
  with check (public.has_permission('masters','edit'));

-- No delete policy: entries expire via expires_at rather than being removed.
