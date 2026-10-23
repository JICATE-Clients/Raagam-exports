-- 0736: Sample cost ₹ / pc on each costing piece (user 2026-10-22: "add sample costing per
-- pc under the testing in overheads table"). A flat rupee figure per garment piece, costed
-- exactly like Testing and Bank charges: it adds into the piece's net cost, so Rejection %,
-- Overhead %, Margin % and the quote all ride on it.
--
-- save_sample_costing is patched IN PLACE from its live body rather than re-declared: the
-- function is ~300 lines and has been re-created by four migrations, and copying it here
-- would risk restoring an older body over a newer one. The replace must FIND its anchor —
-- a body that no longer carries it raises instead of silently saving without the column.

alter table public.sample_costing_pieces add column if not exists sample_cost numeric(14,2);

do $mig$
declare
  d      text := pg_get_functiondef('public.save_sample_costing(uuid,jsonb)'::regprocedure);
  anchor text := E'    ) returning id into v_new;\n    v_pieces := v_pieces || v_new;';
begin
  if position(anchor in d) = 0 then
    raise exception '0736: save_sample_costing no longer has the piece insert anchor';
  end if;
  d := replace(d, anchor,
    E'    ) returning id into v_new;\n'
    || E'    -- 0736: Sample cost per piece.\n'
    || E'    update public.sample_costing_pieces set sample_cost = nullif(x ->> ''sample_cost'', '''')::numeric where id = v_new;\n'
    || E'    v_pieces := v_pieces || v_new;');
  execute d;
end
$mig$;
