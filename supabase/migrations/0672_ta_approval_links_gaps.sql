-- ============================================================================
-- Raagam ERP — 0672 Buyer approval links: the gaps after 0668
-- (user 2026-10-01: "complete the gaps")
--
-- Two additions to `ta_approval_links`, and `ta_link_decide` taking the
-- buyer's attachments:
--
--   1. AUTO_NEXT — the merchandiser ticks "send the next approval's link
--      automatically". When the buyer APPROVES through such a link, the next
--      approval of the same order (by `ta_approvals.sequence`) gets its own
--      link to the same buyer — at once if it is already Sent, or the moment
--      staff mark it Sent. The chaining itself lives in the server
--      (lib/ta/approval-links-service.ts); the column is only the intent,
--      carried link to link.
--
--   2. BUYER_FILES — on Rework the buyer may attach up to three photos or
--      PDFs. They are uploaded straight to the private `order-approval-docs`
--      bucket through a signed upload URL the server mints for this link
--      only, under `<amendment>/<row>/buyer/<link id>/`. The function below
--      REFUSES any path outside that folder, so a crafted request cannot point
--      the record at another order's files.
--
-- `ta_link_decide` keeps its 0668 contract (SECURITY DEFINER, service_role
-- only, the token hash is the authorisation) and gains `p_files`. The 4-arg
-- version is dropped in the same migration: two overloads competing to be the
-- one the public page calls is a door left open (AGENTS.md "Function grants").
-- ============================================================================

alter table public.ta_approval_links
  add column if not exists auto_next   boolean not null default false,
  add column if not exists buyer_files jsonb   not null default '[]'::jsonb;

alter table public.ta_approval_links
  drop constraint if exists ta_approval_links_buyer_files_chk;
alter table public.ta_approval_links
  add constraint ta_approval_links_buyer_files_chk
  check (jsonb_typeof(buyer_files) = 'array' and jsonb_array_length(buyer_files) <= 3);

comment on column public.ta_approval_links.auto_next is
  '0672: when the buyer approves through this link, send the next approval''s link (same order, next ta_approvals.sequence) to the same buyer automatically.';
comment on column public.ta_approval_links.buyer_files is
  '0672: files the buyer attached with the answer — [{path,name,mime}] under <amendment>/<row>/buyer/<link id>/ in order-approval-docs. At most 3.';

drop function if exists public.ta_link_decide(text, text, text, text);

create or replace function public.ta_link_decide(
  p_token_hash text,
  p_decision   text,
  p_name       text,
  p_comment    text,
  p_files      jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_link    public.ta_approval_links%rowtype;
  v_row     public.garment_order_amendment_ta_approvals%rowtype;
  v_name    text := nullif(btrim(coalesce(p_name, '')), '');
  v_comment text := nullif(btrim(coalesce(p_comment, '')), '');
  v_files   jsonb := coalesce(p_files, '[]'::jsonb);
  v_prefix  text;
  v_file    jsonb;
  v_today   date := (now() at time zone 'Asia/Kolkata')::date;
  v_note    text;
begin
  if p_decision not in ('approved', 'rework') then
    return jsonb_build_object('ok', false, 'reason', 'bad_decision');
  end if;
  if v_name is null or length(v_name) > 120 then
    return jsonb_build_object('ok', false, 'reason', 'name_required');
  end if;
  if p_decision = 'rework' and v_comment is null then
    return jsonb_build_object('ok', false, 'reason', 'comment_required');
  end if;
  if v_comment is not null and length(v_comment) > 2000 then
    return jsonb_build_object('ok', false, 'reason', 'comment_too_long');
  end if;
  if jsonb_typeof(v_files) <> 'array' or jsonb_array_length(v_files) > 3 then
    return jsonb_build_object('ok', false, 'reason', 'bad_files');
  end if;

  select * into v_link from public.ta_approval_links
   where token_hash = p_token_hash
   for update;
  if not found then
    return jsonb_build_object('ok', false, 'reason', 'not_found');
  end if;
  if v_link.status <> 'open' then
    return jsonb_build_object('ok', false, 'reason', v_link.status);
  end if;
  if v_link.expires_at < now() then
    update public.ta_approval_links set status = 'expired' where id = v_link.id;
    return jsonb_build_object('ok', false, 'reason', 'expired');
  end if;

  -- Every attached path must sit in THIS link's own buyer folder.
  v_prefix := v_link.amendment_id::text || '/' || v_link.approval_row_id::text || '/buyer/' || v_link.id::text || '/';
  for v_file in select * from jsonb_array_elements(v_files) loop
    if jsonb_typeof(v_file) <> 'object'
       or jsonb_typeof(v_file -> 'path') <> 'string'
       or left(v_file ->> 'path', length(v_prefix)) <> v_prefix
       or position('..' in (v_file ->> 'path')) > 0 then
      return jsonb_build_object('ok', false, 'reason', 'bad_files');
    end if;
  end loop;

  select * into v_row from public.garment_order_amendment_ta_approvals
   where id = v_link.approval_row_id
   for update;
  if not found or v_row.status <> 'sent' or v_row.active_version <> v_link.version then
    update public.ta_approval_links set status = 'superseded' where id = v_link.id;
    return jsonb_build_object('ok', false, 'reason', 'superseded');
  end if;

  if p_decision = 'approved' then
    update public.garment_order_amendment_ta_approvals
       set status               = 'approved',
           actual_received_date = v_today,
           decided_by_name      = v_name,
           decision_comment     = v_comment,
           decided_at           = now(),
           decided_via          = 'link'
     where id = v_row.id;
  else
    v_note := 'BUYER (' || v_name || '): ' || v_comment
      || case when jsonb_array_length(v_files) > 0
              then ' [' || jsonb_array_length(v_files) || ' file(s) attached]' else '' end;
    insert into public.garment_order_amendment_ta_approval_history (
      source_row_id, amendment_id, approval_id, version, target_date,
      actual_sent_date, actual_sent_time, actual_received_date,
      proof_path, proof_reference, mime_type, size_bytes, status, remarks
    ) values (
      v_row.id, v_row.amendment_id, v_row.approval_id, v_row.active_version, v_row.target_date,
      v_row.actual_sent_date, v_row.actual_sent_time, v_today,
      v_row.proof_path, v_row.proof_reference, v_row.mime_type, v_row.size_bytes, 'rework',
      v_note
    );
    update public.garment_order_amendment_ta_approvals
       set status               = 'pending',
           active_version       = v_row.active_version + 1,
           actual_sent_date     = null,
           actual_sent_time     = null,
           actual_received_date = null,
           proof_path           = null,
           proof_reference      = null,
           mime_type            = null,
           size_bytes           = null,
           decided_by_name      = v_name,
           decision_comment     = v_comment,
           decided_at           = now(),
           decided_via          = 'link'
     where id = v_row.id;
  end if;

  update public.ta_approval_links
     set status           = p_decision,
         decided_at       = now(),
         decided_by_name  = v_name,
         decision_comment = v_comment,
         buyer_files      = v_files
   where id = v_link.id;

  return jsonb_build_object(
    'ok', true,
    'decision', p_decision,
    'link_id', v_link.id,
    'approval_row_id', v_row.id,
    'amendment_id', v_row.amendment_id,
    'approval_id', v_row.approval_id,
    'auto_next', v_link.auto_next,
    'recipient_email', v_link.recipient_email,
    'recipient_name', v_link.recipient_name,
    'file_count', jsonb_array_length(v_files)
  );
end;
$$;

revoke all on function public.ta_link_decide(text, text, text, text, jsonb) from public, anon, authenticated;
grant execute on function public.ta_link_decide(text, text, text, text, jsonb) to service_role;

comment on function public.ta_link_decide(text, text, text, text, jsonb) is
  '0668/0672: the buyer''s decision on an emailed approval link, with up to 3 attached files under the link''s own buyer folder. service_role only — the caller hashes the token; the hash is the authorisation.';

-- ---------- assertions ---------------------------------------------------------
do $assert$
begin
  if exists (
    select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = 'ta_link_decide' and p.pronargs = 4
  ) then
    raise exception '0672: the 4-argument ta_link_decide still exists';
  end if;
  if has_function_privilege('anon', 'public.ta_link_decide(text, text, text, text, jsonb)', 'execute') then
    raise exception '0672: ta_link_decide is executable by anon';
  end if;
  if has_function_privilege('authenticated', 'public.ta_link_decide(text, text, text, text, jsonb)', 'execute') then
    raise exception '0672: ta_link_decide is executable by authenticated';
  end if;
  if not has_function_privilege('service_role', 'public.ta_link_decide(text, text, text, text, jsonb)', 'execute') then
    raise exception '0672: ta_link_decide is not executable by service_role';
  end if;
  if not exists (
    select 1 from information_schema.columns
     where table_schema = 'public' and table_name = 'ta_approval_links' and column_name = 'auto_next'
  ) then
    raise exception '0672: auto_next missing';
  end if;
end;
$assert$;
