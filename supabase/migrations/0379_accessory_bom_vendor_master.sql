-- =============================================================================
-- 0379 — Accessory BOM items point at the Vendor MASTER
-- -----------------------------------------------------------------------------
-- Third and last table in the 0376 / 0377 set. 0376 moved
-- `customer_nominated_vendors.vendor_id` onto `public.master_vendors`, 0377
-- moved the Material BOM Amendment lines that consume those nominations. This
-- one moves Planning ▸ Accessory BOM, whose lines carry the same idea:
-- `accessory_bom_items.supply_type` is one of customer / nominated /
-- recommended / others, and the parent `accessory_boms` names a `customer_id`.
--
-- It was the worst of the three. The column existed (0368:407) and the actions
-- accepted it, but the screen rendered NO vendor input at all — the grid printed
-- `vendor_id.slice(0, 8)`, a truncated UUID — so a line could be marked
-- "nominated" and its vendor stayed null forever. The picker is wired in this
-- change; the FK has to move with it or every save of a nominated line fails
-- with `violates foreign key constraint accessory_bom_items_vendor_id_fkey`.
--
-- ## Guarded, because this table may not exist yet
--
-- `0368_planning_bom_foundation.sql` has NOT been applied to the live project —
-- it collides on number with `0368_caps_ship_values.sql` (the two parallel
-- migration lanes), and only the latter ran. An unguarded `alter table` here
-- would abort the whole migration run on that database. So the work is wrapped
-- in a `to_regclass` check and no-ops until the planning lane's schema lands; on
-- a fresh database 0368 sorts first and this finds the table normally.
--
-- ## One deliberate change from the 0376 / 0377 remap
--
-- Those matched a name and took `order by created_at limit 1`. There is no
-- unique index on `master_vendors.name` — uniqueness is enforced app-side by
-- `checkDuplicateName`, which import and direct SQL bypass — so two same-named
-- vendors would silently bind the line to whichever was created first, and
-- nothing would record that a guess had been made. Here a name is remapped only
-- when it resolves to EXACTLY ONE master vendor; anything ambiguous is blanked
-- for the operator to re-pick, and the count is raised as a notice.
-- =============================================================================

do $$
declare
  ambiguous bigint := 0;
  orphans   bigint := 0;
begin
  if to_regclass('public.accessory_bom_items') is null then
    raise notice '0379: accessory_bom_items does not exist (0368 not applied here) — skipping.';
    return;
  end if;

  execute 'alter table public.accessory_bom_items
             drop constraint if exists accessory_bom_items_vendor_id_fkey';

  -- Count what the name match cannot decide, BEFORE blanking it, so the run
  -- leaves a trace. A silent blank reads afterwards as "there was no vendor".
  execute $q$
    select count(*)
      from public.accessory_bom_items x
      join public.vendors v on v.id = x.vendor_id
     where x.vendor_id is not null
       and not exists (select 1 from public.master_vendors mv where mv.id = x.vendor_id)
       and (select count(*) from public.master_vendors mv
             where upper(btrim(mv.name)) = upper(btrim(v.name))) > 1
  $q$ into ambiguous;

  if ambiguous > 0 then
    raise notice '0379: % line(s) named a vendor matching more than one master row — blanked, not guessed.', ambiguous;
  end if;

  execute $q$
    update public.accessory_bom_items x
       set vendor_id = (
             select mv.id
               from public.master_vendors mv, public.vendors v
              where v.id = x.vendor_id
                and upper(btrim(mv.name)) = upper(btrim(v.name))
                -- Exactly one match, or nothing: never the oldest of several.
                and (select count(*) from public.master_vendors m2
                      where upper(btrim(m2.name)) = upper(btrim(v.name))) = 1
           )
     where x.vendor_id is not null
       -- Only rows that do not already resolve in the master, so this is
       -- re-runnable and a vendor picked after the screen was rewired is left alone.
       and not exists (select 1 from public.master_vendors mv where mv.id = x.vendor_id)
  $q$;

  execute $q$
    select count(*) from public.accessory_bom_items x
     where x.vendor_id is not null
       and not exists (select 1 from public.master_vendors mv where mv.id = x.vendor_id)
  $q$ into orphans;

  if orphans > 0 then
    raise exception
      '0379: accessory_bom_items.vendor_id still has % row(s) outside public.master_vendors', orphans;
  end if;

  execute 'alter table public.accessory_bom_items
             add constraint accessory_bom_items_vendor_id_fkey
             foreign key (vendor_id) references public.master_vendors(id) on delete set null';

  execute $q$
    comment on column public.accessory_bom_items.vendor_id is
      'FK to public.master_vendors (the Vendor master), NOT public.vendors — see 0379. '
      'When supply_type is ''nominated'' or ''recommended'' the UI narrows this to the '
      'parent BOM customer''s customer_nominated_vendors rows.'
  $q$;
end $$;
