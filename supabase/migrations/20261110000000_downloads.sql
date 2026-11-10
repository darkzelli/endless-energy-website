-- Downloads: the thanks page Stripe sends a buyer to gives one; after that, the buyer asks for a link
-- by email (resend-link), and each emailed link gives one more. Only the Edge Functions touch any of it.

alter table public.purchases add column downloads integer not null default 0;
create index purchases_email on public.purchases (lower(email));

-- Single-use links sent by email: thanks.html?token=…, good for a day.
create table public.download_tokens (
  token text primary key,
  session_id text not null references public.purchases (session_id) on delete cascade,
  created_at timestamptz not null default now(),
  used_at timestamptz
);
create index download_tokens_session on public.download_tokens (session_id, created_at);
alter table public.download_tokens enable row level security;

-- Uses one of a purchase's downloads from its thanks page, if it has one left: true if it did.
-- One UPDATE, so two loads at once can't both take the last one.
create function public.claim_download(p_session_id text, p_max integer)
returns boolean
language sql
as $$
  with used as (
    update public.purchases set downloads = downloads + 1
    where session_id = p_session_id and downloads < p_max
    returning 1
  )
  select exists (select 1 from used);
$$;

-- Uses an emailed link: its purchase's session_id, or null if it's used, too old or made up.
create function public.claim_token(p_token text)
returns text
language sql
as $$
  update public.download_tokens set used_at = now()
  where token = p_token and used_at is null and created_at > now() - interval '1 day'
  returning session_id;
$$;

-- Visitors can't call these through the public API: only the service role.
revoke execute on function public.claim_download(text, integer) from public, anon, authenticated;
revoke execute on function public.claim_token(text) from public, anon, authenticated;
grant execute on function public.claim_download(text, integer) to service_role;
grant execute on function public.claim_token(text) to service_role;
