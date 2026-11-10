-- One row per paid Stripe Checkout Session. Only the Edge Functions (service role) touch it.
create table public.purchases (
  session_id text primary key,
  email text,
  amount_total integer not null,
  currency text not null,
  created_at timestamptz not null default now()
);
alter table public.purchases enable row level security;

-- The builds (Radial-Keys-<version>-Mac.dmg, -Windows.exe), handed out only as short-lived signed links.
insert into storage.buckets (id, name, public) values ('radial-keys', 'radial-keys', false)
on conflict (id) do nothing;
