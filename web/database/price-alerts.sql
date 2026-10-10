begin;

create table if not exists public.price_alerts (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(user_id) on delete cascade,
  product_id text not null,
  product_name text not null,
  variant_key text not null,
  target_price numeric(14,2) not null check (target_price > 0 and target_price <= 100000),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  enabled boolean not null default true,
  revision integer not null default 1,
  is_below boolean not null default false,
  last_price numeric(14,2),
  last_checked_at timestamptz,
  last_error text,
  next_check_at timestamptz not null default now(),
  lease_token uuid,
  lease_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, product_id, variant_key, currency)
);
create index if not exists price_alerts_due on public.price_alerts(next_check_at) where enabled;
create index if not exists price_alerts_owner on public.price_alerts(user_id);
create unique index if not exists price_observations_offer_snapshot on public.price_observations(offer_id, observed_at);
alter table public.price_observations add column if not exists source_url text check (source_url ~ '^https://');

create table if not exists public.alert_notifications (
  id uuid primary key default gen_random_uuid(),
  user_id text not null references public.profiles(user_id) on delete cascade,
  alert_id uuid not null references public.price_alerts(id) on delete cascade,
  revision integer not null,
  observation_id bigint not null references public.price_observations(id),
  product_id text not null,
  product_name text not null,
  price numeric(14,2) not null,
  target_price numeric(14,2) not null,
  currency text not null,
  created_at timestamptz not null default now(),
  read_at timestamptz,
  unique (alert_id, revision, observation_id)
);
create index if not exists alert_notifications_owner on public.alert_notifications(user_id, created_at desc);
alter table public.price_alerts enable row level security;
alter table public.alert_notifications enable row level security;
revoke all on public.price_alerts, public.alert_notifications from anon, authenticated;
grant all on public.price_alerts, public.alert_notifications to service_role;

-- The profile row serializes concurrent create requests so the per-user cap is atomic.
create or replace function public.velora_create_price_alert(owner_id text, product_snapshot jsonb, target numeric)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare result public.price_alerts;
begin
  perform 1 from public.profiles where user_id = owner_id for update;
  if not found then raise exception 'Profile required'; end if;
  if (select count(*) from public.price_alerts where user_id = owner_id) >= 100 then raise exception 'Alert limit reached'; end if;
  insert into public.price_alerts(user_id, product_id, product_name, variant_key, target_price, currency)
  values(owner_id, product_snapshot->>'id', product_snapshot->>'name', product_snapshot->>'variant', target, product_snapshot->>'currency')
  on conflict(user_id,product_id,variant_key,currency) do update set target_price=excluded.target_price, enabled=true,
    revision=price_alerts.revision+1,is_below=false,next_check_at=now(),lease_token=null,lease_until=null,updated_at=now()
  returning * into result;
  return to_jsonb(result);
end;
$$;

create or replace function public.velora_update_price_alert(owner_id text, alert_id uuid, new_target numeric default null, new_enabled boolean default null)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare result public.price_alerts;
begin
  update public.price_alerts set target_price=coalesce(new_target,target_price),enabled=coalesce(new_enabled,enabled),
    revision=revision+1,is_below=false,next_check_at=now(),lease_token=null,lease_until=null,updated_at=now()
  where id=alert_id and user_id=owner_id returning * into result;
  return case when result.id is null then null else to_jsonb(result) end;
end;
$$;

-- A lease is issued atomically with SKIP LOCKED. The service cannot process the
-- same alert twice concurrently, and an interrupted check is reclaimable.
create or replace function public.velora_claim_price_alerts(batch_size integer default 20)
returns setof public.price_alerts language plpgsql security invoker set search_path = public as $$
begin
  return query with due as (
    select id from public.price_alerts where enabled and next_check_at <= now()
      and (lease_until is null or lease_until <= now()) order by next_check_at,id
    for update skip locked limit greatest(1,least(batch_size,20))
  ) update public.price_alerts a set lease_token=gen_random_uuid(),lease_until=now()+interval '2 minutes'
    from due where a.id=due.id returning a.*;
end;
$$;

create or replace function public.velora_fail_price_alert(alert_id uuid, claim_token uuid, reason text)
returns boolean language plpgsql security invoker set search_path = public as $$
begin
  update public.price_alerts set last_error=left(reason,200),lease_token=null,lease_until=null,
    next_check_at=now()+interval '15 minutes',updated_at=now()
  where id=alert_id and lease_token=claim_token;
  return found;
end;
$$;

-- One transaction persists a verified observation and, only on entering the
-- target-price range, its notification. A lease replay changes no data.
create or replace function public.velora_complete_price_alert(alert_id uuid, claim_token uuid, snapshot jsonb)
returns jsonb language plpgsql security invoker set search_path = public as $$
declare
  a public.price_alerts;
  checked timestamptz;
  observed_price numeric;
  observation bigint;
  existing_price numeric;
  existing_currency text;
  notify_id uuid;
  below_target boolean;
begin
  select * into a from public.price_alerts where id=alert_id and lease_token=claim_token and enabled for update;
  if a.id is null then return jsonb_build_object('status','lease_lost','notified',false); end if;
  checked := (snapshot->>'checkedAt')::timestamptz;
  observed_price := (snapshot->>'price')::numeric;
  if snapshot->>'status' is distinct from 'live' or snapshot->>'availability' is distinct from 'in_stock'
    or snapshot->>'productId' is distinct from a.product_id or snapshot->>'variant' is distinct from a.variant_key
    or snapshot->>'currency' is distinct from a.currency or observed_price <= 0 or observed_price > 100000000
    or checked is null or checked > now()+interval '1 minute' or checked < now()-interval '24 hours'
    or snapshot->>'url' !~ '^https://' then raise exception 'Invalid verified observation'; end if;
  if a.last_checked_at is not null and checked <= a.last_checked_at then
    update public.price_alerts set lease_token=null,lease_until=null,next_check_at=now()+interval '15 minutes' where id=a.id;
    return jsonb_build_object('status','unchanged','notified',false);
  end if;
  insert into public.products(id,canonical_key,category,brand,model,variant,attributes,attribute_sources,data_mode)
  values(a.product_id,a.product_id||':'||md5(a.variant_key),snapshot->>'category',snapshot->>'brand',coalesce(snapshot->>'model',a.product_name),
    jsonb_build_object('description',a.variant_key),coalesce(snapshot->'specs','{}'::jsonb),coalesce(snapshot->'attributeSources','{}'::jsonb),'live')
  on conflict(id) do update set updated_at=now(),attributes=excluded.attributes,attribute_sources=excluded.attribute_sources,data_mode='live'
    where products.canonical_key=excluded.canonical_key;
  if not found then raise exception 'Product configuration conflict'; end if;
  insert into public.offers(id,product_id,retailer_id,retailer_listing_id,currency,price,ordinary_url,availability,source_url,data_mode,last_checked_at)
  values(snapshot->>'offerId',a.product_id,snapshot->>'retailer',snapshot->>'offerId',a.currency,observed_price,snapshot->>'url','in_stock',snapshot->>'sourceUrl','live',checked)
  on conflict(id) do update set price=excluded.price,ordinary_url=excluded.ordinary_url,availability=excluded.availability,
    source_url=excluded.source_url,data_mode='live',last_checked_at=excluded.last_checked_at
    where offers.product_id=excluded.product_id and offers.currency=excluded.currency;
  if not found then raise exception 'Offer configuration conflict'; end if;
  insert into public.price_observations(offer_id,price,currency,data_mode,observed_at,source_url)
  values(snapshot->>'offerId',observed_price,a.currency,'live',checked,snapshot->>'sourceUrl')
  on conflict(offer_id,observed_at) do nothing returning id into observation;
  if observation is null then
    select id,price,currency into observation,existing_price,existing_currency from public.price_observations
      where offer_id=snapshot->>'offerId' and observed_at=checked;
    if existing_price <> observed_price or existing_currency <> a.currency then raise exception 'Conflicting observation'; end if;
  end if;
  below_target := observed_price <= a.target_price;
  if below_target and not a.is_below then
    insert into public.alert_notifications(user_id,alert_id,revision,observation_id,product_id,product_name,price,target_price,currency)
    values(a.user_id,a.id,a.revision,observation,a.product_id,a.product_name,observed_price,a.target_price,a.currency)
    on conflict on constraint alert_notifications_alert_id_revision_observation_id_key do nothing returning id into notify_id;
  end if;
  update public.price_alerts set last_price=observed_price,last_checked_at=checked,last_error=null,is_below=below_target,
    lease_token=null,lease_until=null,next_check_at=now()+interval '15 minutes',updated_at=now() where id=a.id;
  return jsonb_build_object('status','checked','notified',notify_id is not null);
end;
$$;

create or replace function public.velora_alert_history(owner_id text, alert_id uuid)
returns jsonb language sql stable security invoker set search_path = public as $$
  select coalesce(jsonb_agg(row_to_json(t)), '[]'::jsonb) from (
    select p.price,p.currency,p.observed_at as "checkedAt",coalesce(p.source_url,o.source_url) as "sourceUrl"
    from public.price_alerts a join public.offers o on o.product_id=a.product_id and o.currency=a.currency
    join public.price_observations p on p.offer_id=o.id and p.currency=a.currency
    where a.id=alert_id and a.user_id=owner_id and p.data_mode='live'
    order by p.observed_at desc limit 100
  ) t;
$$;

revoke all on function public.velora_create_price_alert(text,jsonb,numeric),public.velora_update_price_alert(text,uuid,numeric,boolean),
  public.velora_claim_price_alerts(integer),public.velora_fail_price_alert(uuid,uuid,text),public.velora_complete_price_alert(uuid,uuid,jsonb),
  public.velora_alert_history(text,uuid) from public,anon,authenticated;
grant execute on function public.velora_create_price_alert(text,jsonb,numeric),public.velora_update_price_alert(text,uuid,numeric,boolean),
  public.velora_claim_price_alerts(integer),public.velora_fail_price_alert(uuid,uuid,text),public.velora_complete_price_alert(uuid,uuid,jsonb),
  public.velora_alert_history(text,uuid) to service_role;
commit;
