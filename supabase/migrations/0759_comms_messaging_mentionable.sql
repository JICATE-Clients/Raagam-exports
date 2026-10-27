-- ============================================================================
-- Raagam ERP — 0759 Communication Hub: who the composer may offer for @mention
--
-- Development Task 03 (channel messaging). 0737 already IS the messaging
-- engine — comm_messages with soft delete, (author, client_id) retry key,
-- keyset history, author-only edit, server-parsed <@uuid> mentions and an
-- RLS-filtered Realtime publication — and 0750 / 0751 put the workspace and
-- channel rules inside its gates. This migration adds the one missing read.
--
-- THE GAP: the composer offered every member on the conversation's list,
-- including one a workspace admin had DEACTIVATED (0750) or whose ERP login was
-- switched off. comm_parse_mentions already ignores those, so nothing leaked —
-- but the operator was offered a name that would silently mention nobody.
--
-- comm_mentionable_members(conv) answers "who can be @mentioned HERE": active
-- members of the conversation whose login is active and not deactivated, minus
-- the caller. That is comm_parse_mentions's set (active member, not
-- deactivated) less a login switched off in Users & Access, who cannot sign in
-- to read it — so the list never offers a name the parser would drop.
-- It answers only an ACTIVE MEMBER of the conversation (the only person with a
-- composer there); anyone else gets no rows — not an error, so the call cannot
-- be used to probe which private channels exist.
-- Ids only: names come through creator_names(), as every other comm screen.
--
-- ADD-ONLY.
-- ============================================================================

create or replace function public.comm_mentionable_members(p_conv uuid)
returns setof uuid language sql stable security definer set search_path = '' as $$
  select m.user_id
    from public.comm_members m
    join public.profiles p on p.id = m.user_id
   where m.conversation_id = p_conv
     and m.removed_at is null
     and m.user_id is distinct from (select auth.uid())
     and coalesce(p.is_active, true)
     and not public.comm_workspace_blocked(m.user_id)
     and public.comm_is_member(p_conv)
     and not public.comm_workspace_blocked((select auth.uid()));
$$;
revoke all on function public.comm_mentionable_members(uuid) from public, anon;
grant execute on function public.comm_mentionable_members(uuid) to authenticated;

do $assert$
begin
  if has_function_privilege('anon', 'public.comm_mentionable_members(uuid)'::regprocedure, 'EXECUTE') then
    raise exception '0759: comm_mentionable_members is executable by anon';
  end if;
  -- The parser's rule and this list's rule are the same three conditions.
  if pg_get_functiondef('public.comm_parse_mentions(uuid,text,uuid)'::regprocedure) not like '%comm_workspace_blocked%' then
    raise exception '0759: comm_parse_mentions no longer drops deactivated people (0750) — the list would disagree with it';
  end if;
end $assert$;
