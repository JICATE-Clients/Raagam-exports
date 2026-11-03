-- ============================================================================
-- Raagam ERP — 0795 Purchase ▸ Purchase Store ▸ Department Return
--
-- A department gives UNUSED / EXCESS material back to the store it got it from.
-- Always AGAINST an ISSUED Material Requisition Slip (0201) — never free-standing,
-- and never against Department Delivery (interdept), which moves no stock.
--
--   draft → posted      (department_return_post: one `return` stock_ledger row per
--                         line, back into the MRS's store; read-only from then on)
--   draft → cancelled
--
-- WHAT THE DATABASE ENFORCES, NOT JUST THE SCREEN:
--   * a line must point at a line of the header's own MRS, and its item is taken
--     from that MRS line (never typed);
--   * at post: the MRS is `issued`, and for every line
--       return_qty <= MRS line issued_qty - returns already POSTED against that line
--     with the MRS row locked, so two returns posted at once cannot both pass;
--   * only `department_return_post` can move a return to `posted` (a transaction-
--     local flag the header trigger checks) — a direct UPDATE status='posted' from
--     the client would mark it posted without touching stock;
--   * a posted or cancelled return, and its lines, refuse every write.
--
-- Unit scoping mirrors the MRS: the header through `lv_stores(store_id)`, the lines
-- through the generated-style `lv_department_returns(return_id)` (0680's shape).
-- Line DELETE is `edit OR delete` — the draft save replaces its lines (AGENTS.md,
-- "a LINE of an order document is deletable by edit").
-- ============================================================================

create sequence if not exists public.seq_department_return;

create table if not exists public.department_returns (
  id                      uuid primary key default gen_random_uuid(),
  code                    text unique,                                   -- DPR-0001
  material_requisition_id uuid not null references public.material_requisitions(id),
  store_id                uuid not null references public.stores(id),
  department              text not null,
  return_date             date not null default current_date,
  reason                  text not null check (btrim(reason) <> ''),
  notes                   text,
  status                  text not null default 'draft'
                            check (status in ('draft','posted','cancelled')),
  posted_at               timestamptz,
  created_by              uuid references public.profiles(id) default auth.uid(),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
create index if not exists idx_dpr_mrs    on public.department_returns(material_requisition_id);
create index if not exists idx_dpr_store  on public.department_returns(store_id);
create index if not exists idx_dpr_status on public.department_returns(status);

create trigger trg_dpr_code before insert on public.department_returns
  for each row execute function public.assign_code('DPR','public.seq_department_return');
create trigger trg_dpr_updated before update on public.department_returns
  for each row execute function public.set_updated_at();

create table if not exists public.department_return_lines (
  id          uuid primary key default gen_random_uuid(),
  return_id   uuid not null references public.department_returns(id) on delete cascade,
  mrs_line_id uuid not null references public.material_requisition_lines(id),
  item_id     uuid not null references public.items(id),
  return_qty  numeric(14,3) not null check (return_qty > 0),
  bin_id      uuid references public.bins(id),
  lot_no      text,
  sort_order  int not null default 0,
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  unique (return_id, mrs_line_id)
);
create index if not exists idx_dpr_lines_return  on public.department_return_lines(return_id);
create index if not exists idx_dpr_lines_mrsline on public.department_return_lines(mrs_line_id);
create index if not exists idx_dpr_lines_bin     on public.department_return_lines(bin_id);

create trigger trg_dpr_lines_updated before update on public.department_return_lines
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------------
-- Header guard: the MRS must be issued (on create), store/department copied from
-- it, and status moves only draft→cancelled by hand, draft→posted by the post fn.
-- ---------------------------------------------------------------------------
create or replace function public.department_return_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_mrs record;
begin
  if tg_op = 'DELETE' then
    if old.status = 'posted' then
      raise exception 'A posted department return cannot be deleted';
    end if;
    return old;
  end if;

  if tg_op = 'UPDATE' and old.status <> 'draft' then
    raise exception 'This department return is % — it can no longer be changed', old.status;
  end if;

  if tg_op = 'INSERT' or new.material_requisition_id is distinct from old.material_requisition_id then
    select m.status, m.store_id, m.department into v_mrs
      from public.material_requisitions m where m.id = new.material_requisition_id;
    if not found then
      raise exception 'Material requisition not found';
    end if;
    if v_mrs.status <> 'issued' then
      raise exception 'A department return must be against an ISSUED requisition';
    end if;
    new.store_id   := v_mrs.store_id;
    new.department := v_mrs.department;
  end if;

  if tg_op = 'INSERT' then
    new.status := 'draft';
    new.posted_at := null;
  elsif new.status = 'posted' and old.status = 'draft' then
    if coalesce(current_setting('raagam.dpr_posting', true), '') <> new.id::text then
      raise exception 'Post a department return with Post — it writes the stock back';
    end if;
  elsif new.status <> old.status and not (old.status = 'draft' and new.status = 'cancelled') then
    raise exception 'A department return cannot move from % to %', old.status, new.status;
  end if;

  new.reason := upper(btrim(new.reason));
  new.notes  := nullif(upper(btrim(coalesce(new.notes, ''))), '');
  return new;
end;
$$;
revoke all on function public.department_return_guard() from public, anon;

create trigger trg_dpr_guard before insert or update or delete on public.department_returns
  for each row execute function public.department_return_guard();

-- ---------------------------------------------------------------------------
-- Line guard: parent must be draft; the MRS line must belong to the parent's MRS;
-- the item is the MRS line's.
-- ---------------------------------------------------------------------------
create or replace function public.department_return_line_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_status text;
  v_mrs    uuid;
  v_item   uuid;
begin
  select r.status, r.material_requisition_id into v_status, v_mrs
    from public.department_returns r
   where r.id = case when tg_op = 'DELETE' then old.return_id else new.return_id end;

  -- A cascade from a deleted header finds no parent: let it through.
  if not found then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if v_status <> 'draft' then
    raise exception 'This department return is % — its lines can no longer be changed', v_status;
  end if;
  if tg_op = 'DELETE' then
    return old;
  end if;

  select l.item_id into v_item
    from public.material_requisition_lines l
   where l.id = new.mrs_line_id and l.material_requisition_id = v_mrs;
  if not found then
    raise exception 'That line is not on this return''s requisition';
  end if;
  new.item_id := v_item;
  new.lot_no  := nullif(upper(btrim(coalesce(new.lot_no, ''))), '');
  return new;
end;
$$;
revoke all on function public.department_return_line_guard() from public, anon;

create trigger trg_dpr_lines_guard before insert or update or delete on public.department_return_lines
  for each row execute function public.department_return_line_guard();

-- ---------------------------------------------------------------------------
-- Unit predicate for the lines (0680's generated shape).
-- ---------------------------------------------------------------------------
create or replace function public.lv_department_returns(p_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$ select p_id is null or exists (select 1 from public.department_returns x where x.id = p_id and public.lv_stores(x.store_id)) $$;
revoke all on function public.lv_department_returns(uuid) from public, anon;
grant execute on function public.lv_department_returns(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------------
alter table public.department_returns enable row level security;
alter table public.department_return_lines enable row level security;

create policy department_returns_read on public.department_returns for select to authenticated
  using (public.has_permission('stores','view') and public.lv_stores(store_id));
create policy department_returns_insert on public.department_returns for insert to authenticated
  with check (public.has_permission('stores','create') and public.lv_stores(store_id));
create policy department_returns_update on public.department_returns for update to authenticated
  using (public.has_permission('stores','edit') and public.lv_stores(store_id))
  with check (public.has_permission('stores','edit') and public.lv_stores(store_id));
create policy department_returns_delete on public.department_returns for delete to authenticated
  using (public.has_permission('stores','delete') and public.lv_stores(store_id));

create policy department_return_lines_read on public.department_return_lines for select to authenticated
  using (public.has_permission('stores','view') and public.lv_department_returns(return_id));
create policy department_return_lines_insert on public.department_return_lines for insert to authenticated
  with check ((public.has_permission('stores','create') or public.has_permission('stores','edit'))
              and public.lv_department_returns(return_id));
create policy department_return_lines_update on public.department_return_lines for update to authenticated
  using (public.has_permission('stores','edit') and public.lv_department_returns(return_id))
  with check (public.has_permission('stores','edit') and public.lv_department_returns(return_id));
create policy department_return_lines_delete on public.department_return_lines for delete to authenticated
  using ((public.has_permission('stores','edit') or public.has_permission('stores','delete'))
         and public.lv_department_returns(return_id));

-- ---------------------------------------------------------------------------
-- Post: one transaction. SECURITY INVOKER — the caller's RLS applies to every
-- read and to the stock_ledger insert, exactly as an MRS issue does.
-- ---------------------------------------------------------------------------
create or replace function public.department_return_post(p_id uuid)
returns void
language plpgsql
set search_path = ''
as $$
declare
  v_ret   record;
  v_mrs   record;
  v_loc   uuid;
  l       record;
  v_prior numeric;
  v_rate  numeric;
  v_lot   text;
  v_n     int := 0;
begin
  if not public.has_permission('stores','edit') then
    raise exception 'Forbidden';
  end if;

  select * into v_ret from public.department_returns where id = p_id for update;
  if not found then
    raise exception 'Department return not found';
  end if;
  if v_ret.status <> 'draft' then
    raise exception 'Only a draft department return can be posted (this one is %)', v_ret.status;
  end if;

  -- Lock the MRS: every return against it posts one at a time.
  select m.id, m.status, m.code into v_mrs
    from public.material_requisitions m where m.id = v_ret.material_requisition_id for update;
  if not found or v_mrs.status <> 'issued' then
    raise exception 'The requisition is no longer issued — nothing can be returned against it';
  end if;

  select s.location_id into v_loc from public.stores s where s.id = v_ret.store_id;

  for l in
    select dl.*, ml.issued_qty, ml.material_requisition_id as line_mrs
      from public.department_return_lines dl
      join public.material_requisition_lines ml on ml.id = dl.mrs_line_id
     where dl.return_id = p_id
     order by dl.sort_order, dl.created_at
  loop
    if l.line_mrs <> v_ret.material_requisition_id then
      raise exception 'A line is not on this return''s requisition';
    end if;

    select coalesce(sum(o.return_qty), 0) into v_prior
      from public.department_return_lines o
      join public.department_returns r on r.id = o.return_id
     where o.mrs_line_id = l.mrs_line_id and r.status = 'posted' and r.id <> p_id;

    if l.return_qty > coalesce(l.issued_qty, 0) - v_prior then
      raise exception 'Return qty % is more than can be returned on this line (issued %, already returned %)',
        l.return_qty, coalesce(l.issued_qty, 0), v_prior;
    end if;

    -- The rate (and lot, when none was typed) the material went out at.
    select sl.rate, sl.lot_no into v_rate, v_lot
      from public.stock_ledger sl
     where sl.reference_type = 'material_requisition'
       and sl.reference_id = v_ret.material_requisition_id
       and sl.item_id = l.item_id
       and sl.movement_type = 'issue'
     order by sl.created_at
     limit 1;

    insert into public.stock_ledger
      (store_id, item_id, movement_type, quantity, reference_type, reference_id,
       note, txn_date, rate, location_id, bin_id, lot_no)
    values
      (v_ret.store_id, l.item_id, 'return', l.return_qty, 'department_return', p_id,
       'Department return ' || coalesce(v_ret.code, '') || ' against ' || coalesce(v_mrs.code, ''),
       v_ret.return_date, v_rate, v_loc, l.bin_id, coalesce(l.lot_no, v_lot));
    v_n := v_n + 1;
  end loop;

  if v_n = 0 then
    raise exception 'Enter a return qty on at least one line before posting';
  end if;

  perform set_config('raagam.dpr_posting', p_id::text, true);
  update public.department_returns
     set status = 'posted', posted_at = now()
   where id = p_id;
  perform set_config('raagam.dpr_posting', '', true);
end;
$$;
revoke all on function public.department_return_post(uuid) from public, anon;
grant execute on function public.department_return_post(uuid) to authenticated;
