-- 0810 · "DELETE requires a WHERE clause" on Assign a bin / stock transfer post (user 2026-11-05).
--
-- PostgREST loads pg_safeupdate, which refuses a DELETE with no WHERE — even on a temp table
-- the function itself just created. stock_transfer_post (0803, which 0809's bin_to_bin move
-- posts through) and stock_adjustment_post (0805) each clear their scratch table with a bare
-- `delete from pg_temp._x;`, so both fail on every call from the app. SQL-editor tests passed
-- because that session does not load safeupdate.
--
-- `where true` satisfies it and changes nothing else. Patched IN PLACE on the live bodies
-- (anchor asserted), like 0804, so no later edit to either function is reverted.

do $mig$
declare
  r record;
  v_def text;
begin
  for r in
    select * from (values
      ('public.stock_transfer_post(uuid)',   'delete from pg_temp._str_avail;'),
      ('public.stock_adjustment_post(uuid)', 'delete from pg_temp._sadj_avail;')
    ) t(fn, anchor)
  loop
    v_def := pg_get_functiondef(r.fn::regprocedure);
    if position(r.anchor in v_def) = 0 then
      raise notice '% has no bare scratch delete — skipped', r.fn;
      continue;
    end if;
    execute replace(v_def, r.anchor, replace(r.anchor, ';', ' where true;'));
  end loop;
end
$mig$;
