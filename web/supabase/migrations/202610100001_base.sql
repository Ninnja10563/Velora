-- Velora PostgreSQL / Supabase schema. Apply with a privileged migration role.
-- No sample business events, conversions, prices, or user accounts are inserted.
begin;

create table if not exists public.profiles (
  user_id text primary key check (length(user_id) between 1 and 200),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.user_state (
  user_id text primary key references public.profiles(user_id) on delete cascade,
  state jsonb not null default '{}'::jsonb check (jsonb_typeof(state) = 'object'),
  updated_at timestamptz not null default now()
);

create table if not exists public.products (
  id text primary key,
  canonical_key text not null unique,
  category text not null,
  brand text not null,
  model text not null,
  variant jsonb not null default '{}'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  attribute_sources jsonb not null default '{}'::jsonb,
  data_mode text not null check (data_mode in ('demo', 'cached', 'live')),
  updated_at timestamptz not null default now()
);

create table if not exists public.offers (
  id text primary key,
  product_id text not null references public.products(id) on delete cascade,
  retailer_id text not null,
  retailer_listing_id text not null,
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  price numeric(14, 2) check (price >= 0),
  shipping_price numeric(14, 2) check (shipping_price >= 0),
  ordinary_url text not null check (ordinary_url ~ '^https://'),
  affiliate_url text check (affiliate_url ~ '^https://'),
  availability text not null default 'unknown',
  source_url text not null check (source_url ~ '^https://'),
  data_mode text not null check (data_mode in ('demo', 'cached', 'live')),
  last_checked_at timestamptz,
  unique (retailer_id, retailer_listing_id)
);

create table if not exists public.price_observations (
  id bigint generated always as identity primary key,
  offer_id text not null references public.offers(id) on delete cascade,
  price numeric(14, 2) not null check (price >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  data_mode text not null check (data_mode in ('cached', 'live')),
  observed_at timestamptz not null default now()
);
create index if not exists price_observations_offer_time on public.price_observations(offer_id, observed_at desc);

create table if not exists public.affiliate_programs (
  id text primary key,
  retailer_id text not null,
  network text not null,
  approval_status text not null default 'unconfigured' check (approval_status in ('unconfigured', 'pending', 'approved', 'disabled')),
  tracking_configuration jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now()
);

create table if not exists public.search_events (
  id uuid primary key,
  search_id text,
  category text,
  success boolean not null,
  created_at timestamptz not null default now()
);
create index if not exists search_events_time on public.search_events(created_at desc);
create index if not exists search_events_search on public.search_events(search_id);

create table if not exists public.outbound_clicks (
  id uuid primary key,
  search_id text,
  -- These are dimensions, not foreign keys: a feed refresh must not erase historical analytics.
  product_id text,
  retailer text,
  category text,
  source text,
  recommendation_id text,
  created_at timestamptz not null default now()
);
create index if not exists outbound_clicks_time on public.outbound_clicks(created_at desc);
create index if not exists outbound_clicks_search on public.outbound_clicks(search_id);

create table if not exists public.confirmed_conversions (
  id uuid primary key default gen_random_uuid(),
  network text not null,
  network_event_id text not null,
  outbound_click_id uuid references public.outbound_clicks(id) on delete set null,
  commission_amount numeric(14, 4) not null check (commission_amount >= 0),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  confirmed_at timestamptz not null,
  unique (network, network_event_id)
);

-- The browser receives no direct SQL privileges. Every operation is authorized
-- in server routes, which use a secret service-role key over HTTPS.
alter table public.profiles enable row level security;
alter table public.user_state enable row level security;
alter table public.products enable row level security;
alter table public.offers enable row level security;
alter table public.price_observations enable row level security;
alter table public.affiliate_programs enable row level security;
alter table public.search_events enable row level security;
alter table public.outbound_clicks enable row level security;
alter table public.confirmed_conversions enable row level security;

-- Supabase's standard roles. No anon/authenticated RLS policies are added.
revoke all on public.profiles, public.user_state, public.products, public.offers,
  public.price_observations, public.affiliate_programs, public.search_events,
  public.outbound_clicks, public.confirmed_conversions from anon, authenticated;
grant all on public.profiles, public.user_state, public.products, public.offers,
  public.price_observations, public.affiliate_programs, public.search_events,
  public.outbound_clicks, public.confirmed_conversions to service_role;
grant usage, select on sequence public.price_observations_id_seq to service_role;

create or replace function public.velora_admin_metrics(since_time timestamptz)
returns jsonb
language sql
stable
security invoker
set search_path = public
as $$
  with searches as (
    select * from public.search_events where created_at >= since_time
  ), clicks as (
    select * from public.outbound_clicks where created_at >= since_time
  ), linked_searches as (
    select distinct search_id from searches where search_id is not null
  ), engaged as (
    select distinct c.search_id from clicks c inner join linked_searches s using (search_id)
  )
  select jsonb_build_object(
    'since', since_time,
    'searchCount', (select count(*) from searches),
    'failedSearchCount', (select count(*) from searches where not success),
    'outboundClickCount', (select count(*) from clicks),
    'linkedSearchCount', (select count(*) from linked_searches),
    'searchesWithClicks', (select count(*) from engaged),
    'searchToClickRate', (select count(*)::numeric from engaged) / nullif((select count(*) from linked_searches), 0),
    'popularCategories', coalesce((select jsonb_agg(row_to_json(t)) from (select category as name, count(*) as count from searches where category is not null group by category order by count(*) desc limit 8) t), '[]'::jsonb),
    'topProducts', coalesce((select jsonb_agg(row_to_json(t)) from (select product_id as name, count(*) as count from clicks where product_id is not null group by product_id order by count(*) desc limit 8) t), '[]'::jsonb),
    'retailers', coalesce((select jsonb_agg(row_to_json(t)) from (select retailer as name, count(*) as count from clicks where retailer is not null group by retailer order by count(*) desc limit 8) t), '[]'::jsonb),
    'confirmedConversions', (select count(*) from public.confirmed_conversions where confirmed_at >= since_time),
    'revenueByCurrency', coalesce((select jsonb_agg(row_to_json(t)) from (select currency, sum(commission_amount) as amount from public.confirmed_conversions where confirmed_at >= since_time group by currency) t), '[]'::jsonb)
  );
$$;

revoke all on function public.velora_admin_metrics(timestamptz) from public, anon, authenticated;
grant execute on function public.velora_admin_metrics(timestamptz) to service_role;

commit;
