-- 0678 — A LINE of an order document is deletable by whoever may EDIT the document.
--
-- THE BUG (found 2026-09-30 during the permission-override work, AGENTS.md
-- "KNOWN, NOT FIXED: delete-and-reinsert saves need orders:delete"):
-- every order editor saves its grids by DELETING the document's lines and
-- INSERTING the new set. The insert/update policies ask `orders:edit`; the
-- delete policies asked `orders:delete`. So for a role holding edit without
-- delete (Merchandiser), RLS turned each DELETE into "0 rows" — not an error —
-- and the INSERTs went through: every save doubled every line, silently.
--
-- THE RULE: rewriting a document's lines IS editing it. `orders:delete` keeps
-- its meaning for the DOCUMENT itself — an order, a BOM, a budget, a plan, an
-- advice — which is what the operator's Delete button removes (its lines
-- cascade, and the cascade runs as the table owner, so a document delete never
-- needed this change).
--
-- WHAT IT DOES NOT LOOSEN:
--   * The approval locks. `refuse_when_order_locked` / `refuse_when_budget_approved`
--     are triggers, not policies; an approved or pending-MD order's lines are
--     refused exactly as before, whoever asks.
--   * Row scoping. Each policy keeps its own `has_amendment_access` /
--     `has_order_access` clause — only the permission half is widened.
--
-- The list is explicit (line tables = cascade children of an order document,
-- minus the children that are documents in their own right). The policy body
-- is rewritten in place with ALTER POLICY, so its roles and scoping survive.

do $$
declare
  t text;
  p record;
  n int := 0;
  lines text[] := array[
    -- Order Entry (garment_order_amendments) grids
    'garment_order_amendment_approval_qtys', 'garment_order_amendment_assort_line_sizes',
    'garment_order_amendment_assort_lines', 'garment_order_amendment_charges',
    'garment_order_amendment_combo_components', 'garment_order_amendment_combo_structures',
    'garment_order_amendment_combos', 'garment_order_amendment_country_sizes',
    'garment_order_amendment_dyeings', 'garment_order_amendment_files',
    'garment_order_amendment_pack_components', 'garment_order_amendment_pack_type_lines',
    'garment_order_amendment_pack_types', 'garment_order_amendment_price_details',
    'garment_order_amendment_prints', 'garment_order_amendment_quantities',
    'garment_order_amendment_structures', 'garment_order_amendment_style_components',
    'garment_order_amendment_style_coordinates', 'garment_order_amendment_style_prices',
    'garment_order_amendment_style_processes', 'garment_order_amendment_style_sizes',
    'garment_order_amendment_styles', 'garment_order_amendment_ta_activities',
    'garment_order_amendment_ta_approvals',
    -- sales_orders lines
    'so_line_items', 'order_descriptions', 'order_coordinate_colors', 'order_fabrics',
    'order_fabric_components', 'order_fabric_yarn_colors', 'order_garment_processes',
    'order_trims', 'order_approval_params', 'ta_milestones',
    -- Fabric BOM
    'order_fabric_bom_dias', 'order_fabric_bom_lines', 'order_fabric_bom_manual_combos',
    'order_fabric_bom_manual_components', 'order_fabric_bom_manual_entries',
    'order_fabric_bom_manual_sizes', 'order_fabric_bom_process_scope',
    'order_fabric_bom_processes', 'order_fabric_bom_requirements',
    'order_fabric_bom_yarn_stages', 'order_fabric_bom_yarns',
    -- Material BOM
    'material_bom_amendment_item_components', 'material_bom_amendment_item_slices',
    'material_bom_amendment_items', 'material_bom_amendment_processes',
    'material_bom_amendment_requirements',
    -- Budget
    'order_budget_lines', 'order_budget_orders',
    -- IWO
    'iwo_budget_lines', 'iwo_fabric_bom_dias', 'iwo_fabric_bom_lines', 'iwo_fabric_bom_palette',
    'iwo_fabric_bom_process_scope', 'iwo_fabric_bom_processes', 'iwo_fabric_bom_yarn_shades',
    'iwo_fabric_bom_yarn_stages', 'iwo_fabric_bom_yarns', 'iwo_fabric_bom_yd_combination_colors',
    'iwo_fabric_bom_yd_combinations', 'iwo_fabric_bom_yd_repeats',
    'iwo_material_bom_item_slices', 'iwo_material_bom_items', 'iwo_material_bom_processes',
    -- CAD, fabric plan, pack ratio, prices, price confirmation
    'order_cad_marker_layouts', 'order_cad_component_weights',
    'order_fabric_plan_lines', 'order_fabric_plan_stages',
    'order_pack_ratio_lines', 'order_pack_ratio_size_labels',
    'order_price_combo_rates', 'order_price_size_rates',
    'pc_cmt_operations', 'pc_cmt_operation_details', 'pc_processes', 'pc_process_items',
    'pc_purchase_items',
    -- other documents' lines
    'contract_review_styles', 'due_date_confirmation_items', 'excess_order_items',
    'excess_order_item_sizes', 'order_booking_certifications', 'color_card_colors',
    'garment_process_amendment_lines', 'garment_style_components',
    'garment_style_component_processes', 'garment_style_coordinates', 'garment_style_sizes',
    'ta_department_assign_lines', 'ta_plan_activities', 'ta_style_activities',
    'ta_template_milestones'
  ];
begin
  foreach t in array lines loop
    for p in
      select policyname, qual from pg_policies
      where schemaname = 'public' and tablename = t and cmd = 'DELETE'
        and qual like '%has_permission(''orders''::text, ''delete''::text)%'
    loop
      execute format(
        'alter policy %I on public.%I using (%s)',
        p.policyname, t,
        replace(p.qual,
          'has_permission(''orders''::text, ''delete''::text)',
          '(has_permission(''orders''::text, ''edit''::text) OR has_permission(''orders''::text, ''delete''::text))')
      );
      n := n + 1;
    end loop;
  end loop;
  -- Every listed table must have been found: a renamed table or a policy
  -- already rewritten elsewhere should stop this, not pass as a no-op.
  if n <> array_length(lines, 1) then
    raise exception '0678: rewrote % delete policies, expected %', n, array_length(lines, 1);
  end if;
end $$;
