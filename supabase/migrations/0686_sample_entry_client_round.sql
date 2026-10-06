-- 0686 — Sample Entry, the client's 2026-10-06 round (itemised list):
--
--   1. Enquiry No prefix OPP → SMP, written SMP/26-27/0001. The year is DASHED
--      through fiscal_year_label() (0431) — the client's 2026-08-18 rule for
--      every document number — so the Sample No (PRD) series gains the dash
--      too: both go through sample_series_format(), and one series dashed while
--      the other is not is the punctuation drift 0431 exists to prevent.
--      Existing new-scheme codes are restamped (OPP/2627/n → SMP/26-27/n,
--      PRD/2627/n → PRD/26-27/n); legacy OPP-0003 codes match neither pattern
--      and are left alone, exactly as 0683 left them.
--   2. Season comes from the SEASON MASTER (`seasons`, 0308) instead of a fixed
--      list. `opportunities.season_id → seasons` already existed (unused); the
--      save writes it and copies the master's name into the old `season` text,
--      which Cost Sheets / Samples / the opportunity page still read. Seeds the
--      quarterly buying cycles Q1–Q4 the client named.
--   3. Agent is a VENDOR — Service Provider ▸ Buying Agent / Service Agent —
--      not the `agent` config lookup. Both agent_id FKs move to master_vendors;
--      a value that is not a vendor id (the lookup ids, test data only) is
--      cleared first or the new FK could not be created. The two service types
--      are seeded into `vendor_service_type` so a vendor can be classified.
--   4. Receipt Dt moves to the header (opportunities.receipt_date). Lines keep
--      their own column and inherit it, as before.
--   5. Billable lines carry an Exchange Rate (styles.exchange_rate). The Local
--      Value (Price × Exchange Rate) is DERIVED on screen and never stored —
--      Order Entry's INR Value rule: a column holding a product of two stored
--      columns is a third number that can disagree.
--   6. Image & Tech Pack attachments per style line: sample_style_files, bytes
--      in a PRIVATE `sample-docs` bucket (signed reads, never a public URL —
--      a buyer's tech pack carries prices and names, the 0416 reasoning).
--   7. Combos lose Extra Qty on screen; style_combos.extra_qty is no longer
--      written (null on save) but the column stays.
--
-- save_sample_entry is re-created FROM 0685'S BODY with only those changes.

-- ---------------------------------------------------------------------------
-- 1. Numbering
-- ---------------------------------------------------------------------------
create or replace function public.sample_series_next_no(p_series text, p_fy text)
returns int
language plpgsql
stable
security definer
set search_path = pg_catalog, public
as $$
declare
  v_re text := '^' || p_series || '/' || public.fiscal_year_label(p_fy) || '/([0-9]+)$';
  v_next int;
begin
  if p_series = 'SMP' then
    with used as (
      select substring(o.code from v_re)::int as n from public.opportunities o where o.code ~ v_re
    )
    select case when not exists (select 1 from used where n = 1) then 1
                else (select min(u.n + 1) from used u where not exists (select 1 from used v where v.n = u.n + 1))
           end into v_next;
  elsif p_series = 'PRD' then
    with used as (
      select substring(s.sample_no from v_re)::int as n from public.styles s where s.sample_no ~ v_re
    )
    select case when not exists (select 1 from used where n = 1) then 1
                else (select min(u.n + 1) from used u where not exists (select 1 from used v where v.n = u.n + 1))
           end into v_next;
  else
    raise exception 'Unknown sample series %', p_series;
  end if;
  return v_next;
end;
$$;

comment on function public.sample_series_next_no(text, text) is
  'Sample Entry numbering (0683, SMP + dashed year 0686): the lowest positive number no existing Enquiry (SMP) '
  'or Sample (PRD) of this financial year holds. SECURITY DEFINER so RLS cannot hide a taken number.';

revoke all on function public.sample_series_next_no(text, text) from public, anon;
grant execute on function public.sample_series_next_no(text, text) to authenticated;

create or replace function public.sample_series_format(p_series text, p_fy text, p_n int)
returns text
language sql
immutable
set search_path = pg_catalog, public
as $$
  select p_series || '/' || public.fiscal_year_label(p_fy) || '/' || lpad(p_n::text, 4, '0')
$$;
revoke all on function public.sample_series_format(text, text, int) from public, anon;
grant execute on function public.sample_series_format(text, text, int) to authenticated;

create or replace function public.assign_opportunity_number()
returns trigger
language plpgsql
set search_path = pg_catalog, public
as $$
declare
  v_fy text;
begin
  if new.code is not null and new.code <> '' then
    return new;
  end if;
  v_fy := public.fiscal_year_segment(coalesce(new.received_date, current_date));
  perform pg_advisory_xact_lock(hashtext('sample_series:SMP:' || v_fy));
  new.code := public.sample_series_format('SMP', v_fy, public.sample_series_next_no('SMP', v_fy));
  return new;
end;
$$;
revoke all on function public.assign_opportunity_number() from public, anon;

-- Restamp the codes written under 0683's scheme. Only `OPP/dddd/n` and
-- `PRD/dddd/n` match; anything already dashed or legacy is untouched, so a
-- second run selects zero rows.
update public.opportunities
   set code = 'SMP/' || public.fiscal_year_label(substring(code from '^OPP/([0-9]{4})/')) || '/'
              || substring(code from '^OPP/[0-9]{4}/([0-9]+)$')
 where code ~ '^OPP/[0-9]{4}/[0-9]+$';

update public.styles
   set sample_no = 'PRD/' || public.fiscal_year_label(substring(sample_no from '^PRD/([0-9]{4})/')) || '/'
                   || substring(sample_no from '^PRD/[0-9]{4}/([0-9]+)$')
 where sample_no ~ '^PRD/[0-9]{4}/[0-9]+$';

-- ---------------------------------------------------------------------------
-- 2. Season master — the quarterly buying cycles
-- ---------------------------------------------------------------------------
insert into public.seasons (season, season_name)
select v, v
  from unnest(array['Q1', 'Q2', 'Q3', 'Q4']) as v
 where not exists (select 1 from public.seasons s where lower(trim(s.season_name)) = lower(v));

-- ---------------------------------------------------------------------------
-- 3. Agent → vendor
-- ---------------------------------------------------------------------------
insert into public.config_lookups (kind, code, name, is_active)
select 'vendor_service_type', v, v, true
  from unnest(array['BUYING AGENT', 'SERVICE AGENT']) as v
 where not exists (
   select 1 from public.config_lookups c
    where c.kind = 'vendor_service_type' and lower(trim(c.name)) = lower(v)
 );

update public.opportunities o set agent_id = null
 where agent_id is not null and not exists (select 1 from public.master_vendors v where v.id = o.agent_id);
update public.styles s set agent_id = null
 where agent_id is not null and not exists (select 1 from public.master_vendors v where v.id = s.agent_id);

alter table public.opportunities drop constraint if exists opportunities_agent_id_fkey;
alter table public.opportunities add constraint opportunities_agent_id_fkey
  foreign key (agent_id) references public.master_vendors(id) on delete set null;
alter table public.styles drop constraint if exists styles_agent_id_fkey;
alter table public.styles add constraint styles_agent_id_fkey
  foreign key (agent_id) references public.master_vendors(id) on delete set null;

-- ---------------------------------------------------------------------------
-- 4 · 5. Header Receipt Dt, line Exchange Rate
-- ---------------------------------------------------------------------------
alter table public.opportunities add column if not exists receipt_date date;
alter table public.styles add column if not exists exchange_rate numeric(14, 4);
alter table public.styles drop constraint if exists styles_exchange_rate_check;
alter table public.styles add constraint styles_exchange_rate_check
  check (exchange_rate is null or exchange_rate >= 0);

-- ---------------------------------------------------------------------------
-- 6. Attachments
-- ---------------------------------------------------------------------------
create table if not exists public.sample_style_files (
  id            uuid primary key default gen_random_uuid(),
  style_id      uuid not null references public.styles(id) on delete cascade,
  sno           int not null default 0,
  doc_kind      text check (doc_kind is null or doc_kind in ('sketch', 'tech_pack')),
  file_name     text not null,
  storage_path  text not null,
  mime_type     text,
  size_bytes    bigint check (size_bytes is null or size_bytes >= 0),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  created_by    uuid default auth.uid()
);
create index if not exists sample_style_files_style_idx on public.sample_style_files(style_id);
comment on table public.sample_style_files is
  'Garment images and buyer tech packs attached to a Sample Entry style line (0686). Bytes live in the PRIVATE '
  'sample-docs bucket; storage_path is the key, never a URL.';

drop trigger if exists trg_sample_style_files_updated on public.sample_style_files;
create trigger trg_sample_style_files_updated before update on public.sample_style_files
  for each row execute function public.set_updated_at();

-- A LINE table: insert = create OR edit, delete = edit OR delete (0683 §4).
alter table public.sample_style_files enable row level security;
drop policy if exists sample_style_files_read on public.sample_style_files;
create policy sample_style_files_read on public.sample_style_files for select to authenticated
  using (public.has_permission('sales', 'view'));
drop policy if exists sample_style_files_update on public.sample_style_files;
create policy sample_style_files_update on public.sample_style_files for update to authenticated
  using (public.has_permission('sales', 'edit'))
  with check (public.has_permission('sales', 'edit'));
drop policy if exists sample_style_files_insert on public.sample_style_files;
create policy sample_style_files_insert on public.sample_style_files for insert to authenticated
  with check (public.has_permission('sales', 'create') or public.has_permission('sales', 'edit'));
drop policy if exists sample_style_files_delete on public.sample_style_files;
create policy sample_style_files_delete on public.sample_style_files for delete to authenticated
  using (public.has_permission('sales', 'edit') or public.has_permission('sales', 'delete'));

insert into storage.buckets (id, name, public)
values ('sample-docs', 'sample-docs', false)
on conflict (id) do nothing;

drop policy if exists sample_docs_read   on storage.objects;
drop policy if exists sample_docs_insert on storage.objects;
drop policy if exists sample_docs_update on storage.objects;
drop policy if exists sample_docs_delete on storage.objects;

create policy sample_docs_read on storage.objects
  for select to authenticated
  using (bucket_id = 'sample-docs' and public.has_permission('sales', 'view'));
-- create OR edit: an edit-only merchandiser attaching a tech pack to an
-- existing entry uploads the file before the row exists.
create policy sample_docs_insert on storage.objects
  for insert to authenticated
  with check (bucket_id = 'sample-docs'
              and (public.has_permission('sales', 'create') or public.has_permission('sales', 'edit')));
create policy sample_docs_update on storage.objects
  for update to authenticated
  using (bucket_id = 'sample-docs' and public.has_permission('sales', 'edit'))
  with check (bucket_id = 'sample-docs' and public.has_permission('sales', 'edit'));
create policy sample_docs_delete on storage.objects
  for delete to authenticated
  using (bucket_id = 'sample-docs' and public.has_permission('sales', 'delete'));

-- ---------------------------------------------------------------------------
-- 7. save_sample_entry — 0685's body plus season_id, receipt_date,
--    exchange_rate and files; extra_qty no longer written.
-- ---------------------------------------------------------------------------
create or replace function public.save_sample_entry(p_id uuid, p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  h          jsonb := p -> 'header';
  v_id       uuid := p_id;
  v_code     text;
  v_title    text;
  v_season   uuid := nullif(h ->> 'season_id', '')::uuid;
  v_seasontx text;
  s          jsonb;
  c          jsonb;
  q          jsonb;
  l          jsonb;
  v_sid      uuid;
  v_cid      uuid;
  v_qid      uuid;
  v_lid      uuid;
  v_keep     uuid[] := '{}';
begin
  if nullif(h ->> 'customer_id', '') is null then
    raise exception 'Choose the Customer before saving the sample entry.' using errcode = '23502';
  end if;

  select name into v_title from public.customers where id = (h ->> 'customer_id')::uuid;
  if v_title is null then
    raise exception 'That customer no longer exists.' using errcode = '23503';
  end if;

  -- The master's name rides along in the old text column, for the screens
  -- that still read `season`.
  if v_season is not null then
    select coalesce(nullif(season_name, ''), season) into v_seasontx from public.seasons where id = v_season;
    if v_seasontx is null then
      raise exception 'That season no longer exists.' using errcode = '23503';
    end if;
  end if;

  if v_id is null then
    insert into public.opportunities (
      title, customer_id, stage, received_date, enquiry_against, enquiry_action,
      country_id, season_id, season, season_year, customer_reference, agent_id,
      receipt_mode, receipt_date, delivery_to, delivery_mode, is_draft, multi_order
    ) values (
      v_title,
      (h ->> 'customer_id')::uuid,
      'enquiry',
      nullif(h ->> 'received_date', '')::date,
      nullif(h ->> 'enquiry_against', ''),
      nullif(h ->> 'enquiry_action', ''),
      nullif(h ->> 'country_id', '')::uuid,
      v_season,
      v_seasontx,
      nullif(h ->> 'season_year', '')::int,
      nullif(h ->> 'customer_reference', ''),
      nullif(h ->> 'agent_id', '')::uuid,
      nullif(h ->> 'receipt_mode', ''),
      nullif(h ->> 'receipt_date', '')::date,
      nullif(h ->> 'delivery_to', ''),
      nullif(h ->> 'delivery_mode', ''),
      coalesce((h ->> 'is_draft')::boolean, false),
      coalesce((h ->> 'multi_order')::boolean, false)
    )
    returning id, code into v_id, v_code;
  else
    update public.opportunities set
      title              = v_title,
      customer_id        = (h ->> 'customer_id')::uuid,
      received_date      = nullif(h ->> 'received_date', '')::date,
      enquiry_against    = nullif(h ->> 'enquiry_against', ''),
      enquiry_action     = nullif(h ->> 'enquiry_action', ''),
      country_id         = nullif(h ->> 'country_id', '')::uuid,
      season_id          = v_season,
      season             = v_seasontx,
      season_year        = nullif(h ->> 'season_year', '')::int,
      customer_reference = nullif(h ->> 'customer_reference', ''),
      agent_id           = nullif(h ->> 'agent_id', '')::uuid,
      receipt_mode       = nullif(h ->> 'receipt_mode', ''),
      receipt_date       = nullif(h ->> 'receipt_date', '')::date,
      delivery_to        = nullif(h ->> 'delivery_to', ''),
      delivery_mode      = nullif(h ->> 'delivery_mode', ''),
      is_draft           = coalesce((h ->> 'is_draft')::boolean, false),
      multi_order        = coalesce((h ->> 'multi_order')::boolean, false)
    where id = v_id
    returning code into v_code;
    -- RLS hides a row the caller may not edit: zero rows is a refusal, not a
    -- success with nothing to do.
    if not found then
      raise exception 'This sample entry no longer exists, or you do not have permission to edit it.'
        using errcode = '42501';
    end if;
  end if;

  -- Which existing lines survive this save.
  for s in select * from jsonb_array_elements(coalesce(p -> 'styles', '[]'::jsonb)) loop
    if nullif(s ->> 'id', '') is not null then
      v_keep := v_keep || (s ->> 'id')::uuid;
    end if;
  end loop;
  delete from public.styles where opportunity_id = v_id and not (id = any (v_keep));

  for s in select * from jsonb_array_elements(coalesce(p -> 'styles', '[]'::jsonb)) loop
    v_sid := nullif(s ->> 'id', '')::uuid;
    if v_sid is not null then
      update public.styles set
        sno = (s ->> 'sno')::int,
        name = s ->> 'name',
        article_no = nullif(s ->> 'article_no', ''),
        description = nullif(s ->> 'description', ''),
        unit_kind = nullif(s ->> 'unit_kind', ''),
        sample_qty = nullif(s ->> 'sample_qty', '')::numeric,
        delivery_date = nullif(s ->> 'delivery_date', '')::date,
        merchandiser_id = nullif(s ->> 'merchandiser_id', '')::uuid,
        order_date = nullif(s ->> 'order_date', '')::date,
        fabric_structure_id = nullif(s ->> 'fabric_structure_id', '')::uuid,
        fabric_id = nullif(s ->> 'fabric_id', '')::uuid,
        gsm = nullif(s ->> 'gsm', '')::numeric,
        tech_pack = nullif(s ->> 'tech_pack', ''),
        customer_reference = nullif(s ->> 'customer_reference', ''),
        receipt_mode = nullif(s ->> 'receipt_mode', ''),
        receipt_date = nullif(s ->> 'receipt_date', '')::date,
        delivery_to = nullif(s ->> 'delivery_to', ''),
        agent_id = nullif(s ->> 'agent_id', '')::uuid,
        delivery_mode = nullif(s ->> 'delivery_mode', ''),
        delivery_through = nullif(s ->> 'delivery_through', ''),
        accessories_reqd = coalesce((s ->> 'accessories_reqd')::boolean, false),
        billable = coalesce((s ->> 'billable')::boolean, false),
        ship_type_id = nullif(s ->> 'ship_type_id', '')::uuid,
        ship_mode = nullif(s ->> 'ship_mode', ''),
        currency_code = nullif(s ->> 'currency_code', ''),
        price = nullif(s ->> 'price', '')::numeric,
        exchange_rate = nullif(s ->> 'exchange_rate', '')::numeric
      where id = v_sid and opportunity_id = v_id;
      if not found then
        raise exception 'A style line on this entry was removed by someone else. Reopen the entry and try again.'
          using errcode = '40001';
      end if;
    else
      insert into public.styles (
        opportunity_id, sno, name, article_no, description, unit_kind, sample_qty, delivery_date,
        merchandiser_id, order_date, fabric_structure_id, fabric_id, gsm, tech_pack,
        customer_reference, receipt_mode, receipt_date, delivery_to, agent_id, delivery_mode,
        delivery_through, accessories_reqd, billable, ship_type_id, ship_mode, currency_code, price,
        exchange_rate
      ) values (
        v_id, (s ->> 'sno')::int, s ->> 'name', nullif(s ->> 'article_no', ''),
        nullif(s ->> 'description', ''), nullif(s ->> 'unit_kind', ''),
        nullif(s ->> 'sample_qty', '')::numeric, nullif(s ->> 'delivery_date', '')::date,
        nullif(s ->> 'merchandiser_id', '')::uuid, nullif(s ->> 'order_date', '')::date,
        nullif(s ->> 'fabric_structure_id', '')::uuid, nullif(s ->> 'fabric_id', '')::uuid,
        nullif(s ->> 'gsm', '')::numeric, nullif(s ->> 'tech_pack', ''),
        nullif(s ->> 'customer_reference', ''), nullif(s ->> 'receipt_mode', ''),
        nullif(s ->> 'receipt_date', '')::date, nullif(s ->> 'delivery_to', ''),
        nullif(s ->> 'agent_id', '')::uuid, nullif(s ->> 'delivery_mode', ''),
        nullif(s ->> 'delivery_through', ''),
        coalesce((s ->> 'accessories_reqd')::boolean, false),
        coalesce((s ->> 'billable')::boolean, false),
        nullif(s ->> 'ship_type_id', '')::uuid, nullif(s ->> 'ship_mode', ''),
        nullif(s ->> 'currency_code', ''), nullif(s ->> 'price', '')::numeric,
        nullif(s ->> 'exchange_rate', '')::numeric
      )
      returning id into v_sid;
    end if;

    -- Child trees, rewritten whole.
    delete from public.sample_style_coordinates where style_id = v_sid;
    delete from public.style_sizes where style_id = v_sid;
    delete from public.style_combos where style_id = v_sid;
    delete from public.sample_style_quantities where style_id = v_sid;
    delete from public.sample_style_files where style_id = v_sid;

    insert into public.sample_style_coordinates (style_id, sno, coordinate_id)
    select v_sid, (x ->> 'sno')::int, (x ->> 'coordinate_id')::uuid
      from jsonb_array_elements(coalesce(s -> 'coordinates', '[]'::jsonb)) x
     where nullif(x ->> 'coordinate_id', '') is not null;

    insert into public.style_sizes (style_id, sno, garment_size)
    select v_sid, (x ->> 'sno')::int, x ->> 'garment_size'
      from jsonb_array_elements(coalesce(s -> 'sizes', '[]'::jsonb)) x
     where nullif(x ->> 'garment_size', '') is not null;

    insert into public.sample_style_files (style_id, sno, doc_kind, file_name, storage_path, mime_type, size_bytes)
    select v_sid, (x ->> 'sno')::int, nullif(x ->> 'doc_kind', ''), x ->> 'file_name', x ->> 'storage_path',
           nullif(x ->> 'mime_type', ''), nullif(x ->> 'size_bytes', '')::bigint
      from jsonb_array_elements(coalesce(s -> 'files', '[]'::jsonb)) x
     where nullif(x ->> 'storage_path', '') is not null;

    for c in select * from jsonb_array_elements(coalesce(s -> 'combos', '[]'::jsonb)) loop
      insert into public.style_combos (style_id, sno, combo, order_qty)
      values (v_sid, (c ->> 'sno')::int, c ->> 'combo', nullif(c ->> 'order_qty', '')::numeric)
      returning id into v_cid;
      insert into public.style_combo_sizes (style_combo_id, sno, garment_size, order_qty)
      select v_cid, (x ->> 'sno')::int, x ->> 'garment_size', nullif(x ->> 'order_qty', '')::numeric
        from jsonb_array_elements(coalesce(c -> 'sizes', '[]'::jsonb)) x
       where nullif(x ->> 'garment_size', '') is not null;
    end loop;

    for q in select * from jsonb_array_elements(coalesce(s -> 'quantities', '[]'::jsonb)) loop
      insert into public.sample_style_quantities (
        style_id, sno, country_id, ref_no, consignee_id, assortment_type_id, po_qty,
        delivery_date, earlier_shipment_date, discharge_port_id, final_destination_id,
        pack, no_of_cartons, master_carton_name, po_no, ratio_for, is_single_style_pack
      ) values (
        v_sid, (q ->> 'sno')::int, nullif(q ->> 'country_id', '')::uuid, nullif(q ->> 'ref_no', ''),
        nullif(q ->> 'consignee_id', '')::uuid, nullif(q ->> 'assortment_type_id', '')::uuid,
        nullif(q ->> 'po_qty', '')::numeric, nullif(q ->> 'delivery_date', '')::date,
        nullif(q ->> 'earlier_shipment_date', '')::date, nullif(q ->> 'discharge_port_id', '')::uuid,
        nullif(q ->> 'final_destination_id', '')::uuid, nullif(q ->> 'pack', ''),
        nullif(q ->> 'no_of_cartons', '')::int, nullif(q ->> 'master_carton_name', ''),
        nullif(q ->> 'po_no', ''), nullif(q ->> 'ratio_for', ''),
        coalesce((q ->> 'is_single_style_pack')::boolean, true)
      )
      returning id into v_qid;
      for l in select * from jsonb_array_elements(coalesce(q -> 'lines', '[]'::jsonb)) loop
        insert into public.sample_quantity_assort_lines (
          quantity_id, sno, combo, style_ref, no_of_cartons, inners_per_carton
        ) values (
          v_qid, (l ->> 'sno')::int, nullif(l ->> 'combo', ''), nullif(l ->> 'style_ref', ''),
          nullif(l ->> 'no_of_cartons', '')::numeric, nullif(l ->> 'inners_per_carton', '')::numeric
        )
        returning id into v_lid;
        insert into public.sample_quantity_assort_sizes (line_id, sno, garment_size, qty)
        select v_lid, (x ->> 'sno')::int, x ->> 'garment_size', nullif(x ->> 'qty', '')::numeric
          from jsonb_array_elements(coalesce(l -> 'sizes', '[]'::jsonb)) x
         where nullif(x ->> 'garment_size', '') is not null;
      end loop;
    end loop;
  end loop;

  return jsonb_build_object('id', v_id, 'code', v_code);
end;
$$;

comment on function public.save_sample_entry(uuid, jsonb) is
  'Sample Entry (0683, quantities 0685, client round 0686): writes the enquiry header, its style lines (updated in place '
  'by id) and every child tree in one transaction. SECURITY INVOKER — every write passes RLS.';

revoke all on function public.save_sample_entry(uuid, jsonb) from public, anon;
grant execute on function public.save_sample_entry(uuid, jsonb) to authenticated;

-- ---------------------------------------------------------------------------
-- Read it back — `success: true` means the SQL ran, not that it did its job.
-- ---------------------------------------------------------------------------
do $$
begin
  if public.sample_series_format('SMP', '2627', 1) <> 'SMP/26-27/0001' then
    raise exception '0686: SMP format is %', public.sample_series_format('SMP', '2627', 1);
  end if;
  if exists (select 1 from public.opportunities where code ~ '^OPP/[0-9]{4}/') then
    raise exception '0686: an OPP/dddd code survived the restamp';
  end if;
  if (select count(*) from public.seasons where season_name in ('Q1', 'Q2', 'Q3', 'Q4')) <> 4 then
    raise exception '0686: Q1–Q4 seasons are not all present';
  end if;
  if (select confrelid::regclass::text from pg_constraint where conname = 'opportunities_agent_id_fkey') <> 'master_vendors' then
    raise exception '0686: opportunities.agent_id does not reference master_vendors';
  end if;
  if exists (
    select 1 from information_schema.role_routine_grants
     where routine_schema = 'public' and routine_name = 'save_sample_entry' and grantee in ('anon', 'PUBLIC')
  ) then
    raise exception '0686: save_sample_entry is executable without a login';
  end if;
end $$;
