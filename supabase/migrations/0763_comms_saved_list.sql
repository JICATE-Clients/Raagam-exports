-- ============================================================================
-- Raagam ERP — 0763 Communication Hub: the Saved list, paged and filtered
--
-- Development Task 07. Saving already works (0737): `comm_saved` is
-- (user_id, message_id) — its primary key, so a message is saved once per
-- person — with saved_at and an index on (user_id, saved_at desc). Its RLS
-- lets a person read, add and remove ONLY THEIR OWN rows, and adding requires
-- comm_message_visible(): nobody can save what they cannot read. Messages
-- load with each person's saved flag in one batched lookup. None of that
-- changes here, and no message text is ever copied into a saved row.
--
-- WHAT WAS MISSING is the list: the Saved page read the newest 200 and stopped,
-- could not be filtered or searched, and a saved message the person can no
-- longer read (they left the private channel, were removed from the group)
-- VANISHED — its row still there, invisible, and impossible to remove.
--
-- comm_my_saved() is SECURITY INVOKER, so both tables' RLS apply as written:
-- comm_saved yields only the caller's rows, and the LEFT JOIN to
-- comm_messages yields the message only when the caller may still read it. A
-- row whose message cannot be read comes back as `available = false` with
-- nothing about the message — not its text, sender or conversation — so the
-- screen can say "no longer available" and offer Remove without revealing
-- what it was. A deleted message (0737 soft delete) stays available and the
-- screen shows "This message was deleted", per the existing policy.
--
-- Filters (conversation, kind, has-file, words) need the message, so a
-- filtered list leaves unavailable rows out by definition. Paging is keyset
-- on (saved_at, message_id) — newest save first, never OFFSET.
--
-- ROLLBACK: drop function public.comm_my_saved(text, uuid, text, boolean,
-- timestamptz, uuid, integer). Nothing else changes.
-- ============================================================================

create or replace function public.comm_my_saved(
  p_text        text default null,
  p_conversation uuid default null,
  p_kind        text default null,
  p_has_file    boolean default false,
  p_before_at   timestamptz default null,
  p_before_id   uuid default null,
  p_limit       integer default 30
)
returns table (message_id uuid, saved_at timestamptz, available boolean,
               conversation_id uuid, parent_id uuid)
language plpgsql stable set search_path = '' as $$
declare
  v_me  uuid := auth.uid();
  v_txt text := nullif(btrim(coalesce(p_text, '')), '');
  v_pat text;
  v_lim integer := least(greatest(coalesce(p_limit, 30), 1), 100);
  v_filtered boolean;
begin
  if v_me is null then
    raise exception 'Sign in to see saved messages.' using errcode = '42501';
  end if;
  if p_kind is not null and p_kind not in ('channel', 'direct', 'group', 'thread') then
    raise exception 'Unknown conversation type.' using errcode = '22023';
  end if;
  if char_length(coalesce(v_txt, '')) > 200 then
    raise exception 'Keep the search to 200 characters.' using errcode = '22023';
  end if;
  -- The typed words are a LIKE pattern with its wildcards escaped: what the
  -- person typed is matched literally, never as a pattern of their making.
  v_pat := case when v_txt is null then null
                else '%' || replace(replace(replace(v_txt, '\', '\\'), '%', '\%'), '_', '\_') || '%' end;
  v_filtered := v_txt is not null or p_conversation is not null or p_kind is not null or coalesce(p_has_file, false);

  return query
  select sv.message_id,
         sv.saved_at,
         g.id is not null,
         g.conversation_id,
         g.parent_id
    from public.comm_saved sv
    left join public.comm_messages g on g.id = sv.message_id
    left join public.comm_conversations c on c.id = g.conversation_id
   where sv.user_id = v_me
     and (not v_filtered or g.id is not null)
     and (v_pat is null or g.body ilike v_pat)
     and (p_conversation is null or g.conversation_id = p_conversation)
     and (p_kind is null
          or (p_kind = 'thread' and g.parent_id is not null)
          or (p_kind <> 'thread' and c.kind = p_kind))
     and (not coalesce(p_has_file, false)
          or exists (select 1 from public.comm_attachments a where a.message_id = g.id))
     and (p_before_at is null or (sv.saved_at, sv.message_id) < (p_before_at, p_before_id))
   order by sv.saved_at desc, sv.message_id desc
   limit v_lim + 1;
end $$;
revoke all on function public.comm_my_saved(text, uuid, text, boolean, timestamptz, uuid, integer) from public, anon;
grant execute on function public.comm_my_saved(text, uuid, text, boolean, timestamptz, uuid, integer) to authenticated;


do $assert$
begin
  if (select p.prosecdef from pg_proc p
       where p.oid = 'public.comm_my_saved(text,uuid,text,boolean,timestamptz,uuid,integer)'::regprocedure) then
    raise exception '0763: comm_my_saved must run as the caller (SECURITY INVOKER)';
  end if;
  if has_function_privilege('anon', 'public.comm_my_saved(text,uuid,text,boolean,timestamptz,uuid,integer)'::regprocedure, 'EXECUTE') then
    raise exception '0763: comm_my_saved is executable by anon';
  end if;
  -- The guarantees this list leans on, from 0737, still hold.
  if not exists (select 1 from pg_constraint where conrelid = 'public.comm_saved'::regclass and contype = 'p') then
    raise exception '0763: comm_saved has lost its (user, message) key';
  end if;
  if not exists (select 1 from pg_policies where schemaname = 'public' and tablename = 'comm_saved'
                  and cmd = 'INSERT' and with_check like '%comm_message_visible%') then
    raise exception '0763: saving no longer requires being able to read the message';
  end if;
end $assert$;
