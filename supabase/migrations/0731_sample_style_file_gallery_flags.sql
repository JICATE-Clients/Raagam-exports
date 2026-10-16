-- 0731 — Sample Entry's style pictures get Order Entry's two flags
-- (user, 2026-10-15: "picture report yes/no in order style tab … same feature
-- copy and update in sample entry style image section").
--
-- The exact pair 0621 put on `garment_order_amendment_files`, on the sample's
-- own file table (`sample_style_files`, 0686):
--
--   * `is_primary` — the style's cover picture, ONE per style: a PARTIAL unique
--     index (`where is_primary`) so the un-starred rows never collide. Here a
--     file belongs to a style by `style_id` (a real FK — sample styles keep
--     their ids across saves, 0686), so no `coalesce(style_ref_no)` is needed.
--     Not backfilled: `coverOf()` falls back to the first sketch, then the first
--     picture, so every sample already has a cover without a star.
--   * `print_on_report` — the picture the Costing sheet and Quotation print.
--     Opt-in, `false` by default, never inferred.
--
-- ## THE ONE BACKFILL, AND WHY IT IS NOT A GUESS
--
-- Until today the Costing sheet printed each style's FIRST picture,
-- unconditionally. From today it prints only a ticked one. Leaving every
-- existing row `false` would silently blank the photo on every costing already
-- sent to a buyer. So the first picture of each existing style is ticked — that
-- records what the report ALREADY prints, not a choice invented for it. New
-- uploads start unticked, as on Order Entry.
--
-- ## THE SAVE FUNCTION IS EDITED IN PLACE, FROM ITS LIVE BODY
--
-- `save_sample_entry` deletes and re-inserts a style's files on every save, so
-- it must carry the two columns or the next save wipes them. Rather than copy
-- the whole function here (and risk dropping a later migration's line — the
-- way 0617's guard was lost twice), this rewrites ONLY the files INSERT of the
-- definition currently in the database, and refuses if that statement is not
-- found exactly once.

alter table public.sample_style_files
  add column if not exists is_primary boolean not null default false,
  add column if not exists print_on_report boolean not null default false;

create unique index if not exists sample_style_files_one_primary
  on public.sample_style_files (style_id)
  where is_primary;

update public.sample_style_files f
   set print_on_report = true
  from (
    select distinct on (style_id) id
      from public.sample_style_files
     where coalesce(mime_type, '') like 'image/%'
     order by style_id, sno, created_at
  ) first_image
 where f.id = first_image.id;

do $$
declare
  v_def text := pg_get_functiondef('public.save_sample_entry(uuid,jsonb)'::regprocedure);
  v_old text := $old$    insert into public.sample_style_files (style_id, sno, doc_kind, file_name, storage_path, mime_type, size_bytes)
    select v_sid, (x ->> 'sno')::int, nullif(x ->> 'doc_kind', ''), x ->> 'file_name', x ->> 'storage_path',
           nullif(x ->> 'mime_type', ''), nullif(x ->> 'size_bytes', '')::bigint
      from jsonb_array_elements(coalesce(s -> 'files', '[]'::jsonb)) x$old$;
  v_new text := $new$    insert into public.sample_style_files (style_id, sno, doc_kind, file_name, storage_path, mime_type, size_bytes,
                                           is_primary, print_on_report)  -- 0731
    select v_sid, (x ->> 'sno')::int, nullif(x ->> 'doc_kind', ''), x ->> 'file_name', x ->> 'storage_path',
           nullif(x ->> 'mime_type', ''), nullif(x ->> 'size_bytes', '')::bigint,
           coalesce((x ->> 'is_primary')::boolean, false),
           coalesce((x ->> 'print_on_report')::boolean, false)  -- 0731
      from jsonb_array_elements(coalesce(s -> 'files', '[]'::jsonb)) x$new$;
  v_count int;
begin
  v_count := (length(v_def) - length(replace(v_def, v_old, ''))) / length(v_old);
  if v_count <> 1 then
    raise exception '0731: expected the sample_style_files INSERT exactly once in save_sample_entry, found %', v_count;
  end if;
  execute replace(v_def, v_old, v_new);
end
$$;
