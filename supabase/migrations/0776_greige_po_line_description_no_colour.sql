-- 0776 — Greige-fabric PO lines raised before 0775 drop their colourway from the
-- description too (user 2026-10-31: "we need update the po also").
--
-- 0775 re-keyed them (req_key "…|DIA 30|WHITE" → "…|DIA 30|") but left the text, so
-- HO/PO/26-27/0007 still printed "… · DIA 30 · WHITE" on grey cloth. This strips the
-- " · <colourway>" part — only a colourway the line's own order holds on that fabric,
-- matched exactly, so nothing else in the text can be touched. A note in brackets
-- ("… (PROCESS: X)", 0755) after it is kept.
--
-- Description only: neither po_line_items trigger fires on it
-- (trg_po_line_requirement_cap watches quantity / req_key / source; refuse_advised_po_line
-- returns early when item, order and quantity are unchanged).

update public.po_line_items l
set description = regexp_replace(
      l.description,
      ' · ' || regexp_replace(c.combo, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '( \(|$)',
      '\1'
    )
from (
  select distinct b.garment_order_id, r.item_id, upper(trim(r.combo)) as combo
  from public.order_fabric_boms b
  join public.order_fabric_bom_requirements r on r.bom_id = b.id
  join public.order_fabric_bom_process_scope sc
    on sc.bom_id = b.id and sc.item_id = r.item_id and sc.source = 'greige_purchase'
  where nullif(trim(r.combo), '') is not null
) c
where c.garment_order_id = l.garment_order_id
  and c.item_id = l.item_id
  and l.req_key ~ '\|$'
  and l.description ~ (' · ' || regexp_replace(c.combo, '([.^$*+?()\[\]{}|\\])', '\\\1', 'g') || '( \(|$)');
