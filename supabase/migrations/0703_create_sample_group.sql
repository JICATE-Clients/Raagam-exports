-- 0703 · Sample ▸ Grouping — create a group and its styles in ONE transaction.
--
-- A group without its styles is a Draft with nothing in it, and the only
-- clean-up is a delete the creator may not be allowed to make (the delete
-- policy wants Sales ▸ Delete). So the header and its items go in together.
--
-- SECURITY INVOKER: RLS and 0702's guards apply exactly as they do to the
-- tables. The figures come from the server action, which weighs every style
-- from its costing (lib/sales/sample-grouping/calc.ts) — the same trust the
-- costing's own save gives its summary.

create or replace function public.create_sample_group(p jsonb)
returns jsonb
language plpgsql
security invoker
set search_path = pg_catalog, public
as $$
declare
  h      jsonb := p -> 'header';
  v_id   uuid;
  v_code text;
  x      jsonb;
begin
  if jsonb_array_length(coalesce(p -> 'items', '[]'::jsonb)) = 0 then
    raise exception 'A group needs at least one style.' using errcode = '23502';
  end if;

  insert into public.sample_product_groups (
    season_id, season, season_year, fabric_structure_id, fabric_structure, yarn_blend, blend_key,
    moq_kg, batch_kg, cutting_waste_pct, net_required_weight_kg, moq_purchased_weight_kg, remarks
  ) values (
    nullif(h ->> 'season_id', '')::uuid,
    h ->> 'season',
    (h ->> 'season_year')::int,
    nullif(h ->> 'fabric_structure_id', '')::uuid,
    nullif(h ->> 'fabric_structure', ''),
    h ->> 'yarn_blend',
    h ->> 'blend_key',
    coalesce(nullif(h ->> 'moq_kg', '')::numeric, 60),
    coalesce(nullif(h ->> 'batch_kg', '')::numeric, 30),
    coalesce(nullif(h ->> 'cutting_waste_pct', '')::numeric, 0),
    coalesce(nullif(h ->> 'net_required_weight_kg', '')::numeric, 0),
    coalesce(nullif(h ->> 'moq_purchased_weight_kg', '')::numeric, 0),
    nullif(h ->> 'remarks', '')
  ) returning id, group_code into v_id, v_code;

  for x in select * from jsonb_array_elements(p -> 'items') loop
    insert into public.sample_group_items (
      group_id, sample_entry_id, style_id, cost_sheet_id, fabric_structure_id, blend_key,
      component_name, sample_qty_pcs, calculated_weight_kg
    ) values (
      v_id,
      (x ->> 'sample_entry_id')::uuid,
      (x ->> 'style_id')::uuid,
      nullif(x ->> 'cost_sheet_id', '')::uuid,
      nullif(x ->> 'fabric_structure_id', '')::uuid,
      x ->> 'blend_key',
      coalesce(x ->> 'component_name', ''),
      round(coalesce(nullif(x ->> 'sample_qty_pcs', '')::numeric, 0))::int,
      (x ->> 'calculated_weight_kg')::numeric
    );
  end loop;

  return jsonb_build_object('id', v_id, 'code', v_code);
end;
$$;

-- Function grants (AGENTS.md): both revokes in one statement, then the login.
revoke all on function public.create_sample_group(jsonb) from public, anon;
grant execute on function public.create_sample_group(jsonb) to authenticated, service_role;
