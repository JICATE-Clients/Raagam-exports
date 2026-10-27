-- ============================================================================
-- Raagam ERP — 0762 Communication Hub: message search
--
-- Development Task 06. Huddle ▸ Search already existed (0737's service): an
-- unindexed `ilike` over every message the caller could read, newest 50, no
-- filters, a link to the conversation only. Correct — RLS scoped it — but it
-- scans the table and cannot filter, rank or page.
--
-- POSTGRES FULL-TEXT SEARCH, NOT A NEW SERVICE. One GIN index on the message
-- text and one function. The 'simple' configuration: no English stemming and
-- no stop-word list, because these messages mix English, Tamil and the
-- trade's own words (RE numbers, style codes, COTTON SLUB) — stemming would
-- "correct" a code and a stop list would drop words people search for. Each
-- word typed matches as a PREFIX, so "inv" finds "invoice".
--
-- AUTHORISATION IS RLS, NOT THIS FUNCTION. comm_search_messages is SECURITY
-- INVOKER (no `security definer`): it runs as the caller, so comm_messages'
-- SELECT policy — comm_can_read_at(), which already knows membership, removal
-- cut-offs, public channels and 0750's deactivation — decides every row. No
-- filter argument can widen it: a sender or conversation id the caller cannot
-- read simply matches nothing. Deleted messages are excluded (their text is
-- gone anyway, 0737).
--
-- THE QUERY IS BUILT HERE, FROM WORDS. The text is split on spaces and
-- punctuation and each word becomes a quoted prefix lexeme, so nothing a
-- person types is ever read as tsquery syntax (no &, |, !, parentheses) — and
-- nothing is ever SQL, the function takes values, not fragments.
--
-- DATES are calendar days in IST (Asia/Kolkata), the business's clock: "from
-- 1 Jan" is 1 Jan 00:00 IST, "to 31 Jan" runs to the end of 31 Jan IST.
--
-- RELEVANCE is ts_rank over the message text — real ranking, not a relabel of
-- "newest". Ties, and every search with no words (filters only), fall back to
-- newest first. Paging is KEYSET on (rank, created_at, id) or (created_at, id)
-- — never OFFSET — so a message arriving mid-search cannot shift a page and
-- show a result twice or skip one.
--
-- ROLLBACK: drop function public.comm_search_messages(...); drop index
-- public.idx_comm_msg_fts; drop index public.idx_comm_msg_author.
-- ============================================================================

create index if not exists idx_comm_msg_fts
  on public.comm_messages using gin (to_tsvector('simple', coalesce(body, '')))
  where deleted_at is null;

-- "from:" — one person's messages, newest first.
create index if not exists idx_comm_msg_author
  on public.comm_messages (author_id, created_at desc) where deleted_at is null;


create or replace function public.comm_search_messages(
  p_text            text default null,
  p_by_person          uuid default null,
  p_conversation    uuid default null,
  p_from_day        date default null,
  p_to_day          date default null,
  p_has_file        boolean default false,
  p_kind            text default null,
  p_sort            text default 'relevance',
  p_after_rank      real default null,
  p_after_at        timestamptz default null,
  p_after_id        uuid default null,
  p_limit           integer default 20
)
returns table (id uuid, conversation_id uuid, parent_id uuid, created_at timestamptz, rank real)
language plpgsql stable set search_path = '' as $$
declare
  v_q    tsquery;
  v_sort text := coalesce(nullif(p_sort, ''), 'relevance');
  v_lim  integer := least(greatest(coalesce(p_limit, 20), 1), 50);
begin
  if (select auth.uid()) is null then
    raise exception 'Sign in to search messages.' using errcode = '42501';
  end if;
  if v_sort not in ('relevance', 'newest') then
    raise exception 'Sort by relevance or newest.' using errcode = '22023';
  end if;
  if p_kind is not null and p_kind not in ('channel', 'direct', 'group', 'thread') then
    raise exception 'Unknown conversation type.' using errcode = '22023';
  end if;
  if p_from_day is not null and p_to_day is not null and p_from_day > p_to_day then
    raise exception 'The start date is after the end date.' using errcode = '22023';
  end if;
  if char_length(coalesce(p_text, '')) > 200 then
    raise exception 'Keep the search to 200 characters.' using errcode = '22023';
  end if;

  -- Words → quoted prefix lexemes, ANDed. Never parsed as tsquery syntax.
  select to_tsquery('simple', string_agg(quote_literal(w) || ':*', ' & '))
    into v_q
    from (select w from regexp_split_to_table(lower(coalesce(p_text, '')), '[[:space:][:punct:]]+') w
           where w <> '' limit 12) words;

  if v_q is null and p_by_person is null and p_conversation is null and p_from_day is null
     and p_to_day is null and not coalesce(p_has_file, false) and p_kind is null then
    raise exception 'Type something to search for, or choose a filter.' using errcode = '22023';
  end if;
  -- Without words there is nothing to rank by.
  if v_q is null then
    v_sort := 'newest';
  end if;

  return query
  with hits as (
    select g.id, g.conversation_id, g.parent_id, g.created_at,
           case when v_q is null then 0::real
                else ts_rank(to_tsvector('simple', coalesce(g.body, '')), v_q) end as rank
      from public.comm_messages g
      join public.comm_conversations c on c.id = g.conversation_id
     where g.deleted_at is null
       and g.kind = 'message'
       and c.workspace_id = (select w.id from public.comm_workspace w limit 1)
       and (v_q is null or to_tsvector('simple', coalesce(g.body, '')) @@ v_q)
       and (p_by_person is null or g.author_id = p_by_person)
       and (p_conversation is null or g.conversation_id = p_conversation)
       and (p_from_day is null or g.created_at >= (p_from_day::timestamp at time zone 'Asia/Kolkata'))
       and (p_to_day is null or g.created_at < ((p_to_day + 1)::timestamp at time zone 'Asia/Kolkata'))
       and (not coalesce(p_has_file, false)
            or exists (select 1 from public.comm_attachments a where a.message_id = g.id))
       and (p_kind is null
            or (p_kind = 'thread' and g.parent_id is not null)
            or (p_kind <> 'thread' and c.kind = p_kind))
  )
  select h.id, h.conversation_id, h.parent_id, h.created_at, h.rank
    from hits h
   where p_after_at is null
      or (v_sort = 'newest' and (h.created_at, h.id) < (p_after_at, p_after_id))
      or (v_sort = 'relevance' and (h.rank, h.created_at, h.id) < (p_after_rank, p_after_at, p_after_id))
   order by case when v_sort = 'relevance' then h.rank end desc nulls last,
            h.created_at desc, h.id desc
   limit v_lim + 1;
end $$;
revoke all on function public.comm_search_messages(text, uuid, uuid, date, date, boolean, text, text, real, timestamptz, uuid, integer) from public, anon;
grant execute on function public.comm_search_messages(text, uuid, uuid, date, date, boolean, text, text, real, timestamptz, uuid, integer) to authenticated;


do $assert$
declare
  n integer;
begin
  -- SECURITY INVOKER, so RLS decides every row. A definer here would read
  -- every private conversation in the database.
  if (select p.prosecdef from pg_proc p
       where p.oid = 'public.comm_search_messages(text,uuid,uuid,date,date,boolean,text,text,real,timestamptz,uuid,integer)'::regprocedure) then
    raise exception '0762: comm_search_messages must run as the caller (SECURITY INVOKER)';
  end if;
  if has_function_privilege('anon', 'public.comm_search_messages(text,uuid,uuid,date,date,boolean,text,text,real,timestamptz,uuid,integer)'::regprocedure, 'EXECUTE') then
    raise exception '0762: comm_search_messages is executable by anon';
  end if;
  if not exists (select 1 from pg_indexes where schemaname = 'public' and indexname = 'idx_comm_msg_fts') then
    raise exception '0762: the full-text index is missing';
  end if;
  -- Typed operators are words, not syntax: this must parse, not raise.
  select count(*) into n
    from (select to_tsquery('simple', string_agg(quote_literal(w) || ':*', ' & ')) q
            from regexp_split_to_table(lower('a & b | !c (d) '' ; drop table x; -- <@x>'), '[[:space:][:punct:]]+') w
           where w <> '') t;
  if n <> 1 then
    raise exception '0762: hostile search text did not reduce to plain words';
  end if;
end $assert$;
