-- 0726 · Sample Entry ▸ Product Info ▸ Fabric — a COMPOSITION per structure
--        (doc/sample/developer-ui-field-updates-report-v8.md §7.1; user
--        2026-10-14 Q5: "add a Composition column to Sample Entry's fabric grid,
--        selectable from the Composition Master").
--
-- The costing's pre-fill (§7.1: "auto-populates fabric rows from the sample's
-- fabric structures — Structure, GSM, Composition") had Structure and GSM to
-- read and nothing for Composition, because Sample Entry never asked for it.
-- Now each structure row names a `compositions` row (0225 — the fibres and
-- their mixing %), and the costing seeds that fabric's Yarn Mix from it.
--
-- Optional, and ON DELETE SET NULL: a composition retired from the master
-- must not take the sample's structure row with it.
--
-- save_sample_entry is EXTENDED, not retyped: the DO block swaps the one 0715
-- insert in the LIVE body (pg_get_functiondef, 2026-10-14) for the same insert
-- plus the new column, and refuses to run if that text is not found exactly
-- once — a silent no-op is the failure this shape exists to prevent.

alter table public.sample_style_fabric_structures
  add column if not exists composition_id uuid references public.compositions(id) on delete set null;

comment on column public.sample_style_fabric_structures.composition_id is
  'Sample Entry (0726): the structure''s fibre composition from the Composition master; seeds the costing''s Yarn Mix.';

do $do$
declare
  v_def  text;
  v_old  text := $old$    insert into public.sample_style_fabric_structures (style_id, sno, structure_id, gsm)
    select v_sid, (x ->> 'sno')::int, (x ->> 'structure_id')::uuid, nullif(x ->> 'gsm', '')::numeric
      from jsonb_array_elements(coalesce(s -> 'structures', '[]'::jsonb)) x$old$;
  v_new  text := $new$    insert into public.sample_style_fabric_structures (style_id, sno, structure_id, gsm, composition_id)  -- 0726
    select v_sid, (x ->> 'sno')::int, (x ->> 'structure_id')::uuid, nullif(x ->> 'gsm', '')::numeric,
           nullif(x ->> 'composition_id', '')::uuid
      from jsonb_array_elements(coalesce(s -> 'structures', '[]'::jsonb)) x$new$;
begin
  select pg_get_functiondef(p.oid) into v_def
    from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'save_sample_entry';
  if v_def is null then
    raise exception '0726: save_sample_entry not found';
  end if;
  if position('composition_id' in v_def) > 0 then
    return;  -- already applied
  end if;
  if (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old) <> 1 then
    raise exception '0726: the 0715 structures insert was not found exactly once in save_sample_entry';
  end if;
  execute replace(v_def, v_old, v_new);
end
$do$;
