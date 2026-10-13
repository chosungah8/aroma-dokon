-- AROMA DO'KON: first run in the existing Supabase project SQL Editor.
-- Collects only pseudonymous, verified Telegram Web App activity AFTER installation.
-- Re-running is safe. No changes to orders, coupons, products or promotion tables.

create table if not exists public.aroma_visitor_events (
    id bigint generated always as identity primary key,
    visitor_key text not null check (visitor_key ~ '^[a-f0-9]{64}$'),
    event_type text not null check (event_type in ('visit','product_view','cart_add','order')),
    product_id integer not null default 0 check (product_id >= 0),
    event_day date not null default ((now() at time zone 'Asia/Tashkent')::date),
    created_at timestamptz not null default now(),
    constraint aroma_visitor_event_unique unique (visitor_key, event_type, event_day, product_id),
    constraint aroma_visitor_product_check check (
        (event_type in ('visit','order') and product_id = 0) or
        (event_type in ('product_view','cart_add') and product_id > 0)
    )
);
create index if not exists aroma_visitor_day_event_idx
    on public.aroma_visitor_events(event_day desc, event_type);

-- Never allow public clients to read or write analytics directly.
alter table public.aroma_visitor_events enable row level security;
revoke all on table public.aroma_visitor_events from public, anon, authenticated;
grant select, insert on table public.aroma_visitor_events to service_role;

-- Called from a server endpoint ONLY after verifying the signed admin session.
-- The RPC is explicitly unavailable to ordinary Supabase clients.
create or replace function public.aroma_analytics_summary_v1()
returns jsonb
language sql stable
set search_path = ''
as $$
    with bounds as (
        select (now() at time zone 'Asia/Tashkent')::date as today
    ),
    visits as (
        select visitor_key, event_day from public.aroma_visitor_events
        where event_type = 'visit'
    ),
    today as (
        select count(distinct visitor_key) as n from visits, bounds
        where event_day = bounds.today
    ),
    week_visits as (
        select count(distinct visitor_key) as n from visits, bounds
        where event_day >= bounds.today - 6
    ),
    month_visits as (
        select count(distinct visitor_key) as n from visits, bounds
        where event_day >= bounds.today - 29
    ),
    all_visits as (
        select count(distinct visitor_key) as n from visits
    ),
    month_active as (
        select count(distinct visitor_key) as n from public.aroma_visitor_events, bounds
        where event_day >= bounds.today - 29
          and event_type in ('product_view','cart_add','order')
    ),
    month_cart as (
        select count(distinct visitor_key) as n from public.aroma_visitor_events, bounds
        where event_day >= bounds.today - 29 and event_type = 'cart_add'
    ),
    month_buyers as (
        select count(distinct visitor_key) as n from public.aroma_visitor_events, bounds
        where event_day >= bounds.today - 29 and event_type = 'order'
    ),
    month_converted as (
        select count(distinct e.visitor_key) as n
        from public.aroma_visitor_events e, bounds
        where e.event_day >= bounds.today - 29 and e.event_type = 'order'
          and exists (select 1 from visits v
                      where v.visitor_key = e.visitor_key and v.event_day >= bounds.today - 29)
    )
    select jsonb_build_object(
        'timezone', 'Asia/Tashkent',
        'visitors_today', (select n from today),
        'visitors_7d', (select n from week_visits),
        'visitors_30d', (select n from month_visits),
        'visitors_all', (select n from all_visits),
        'active_30d', (select n from month_active),
        'cart_30d', (select n from month_cart),
        'buyers_30d', (select n from month_buyers),
        'converted_30d', (select n from month_converted),
        'daily_7d', (
            select coalesce(jsonb_agg(jsonb_build_object('day', days.d::date, 'visitors', (
                select count(distinct v.visitor_key) from visits v where v.event_day = days.d::date
            )) order by days.d), '[]'::jsonb)
            from bounds, generate_series(bounds.today - 6, bounds.today, interval '1 day') as days(d)
        ),
        'top_products', (
            select coalesce(jsonb_agg(jsonb_build_object(
                'id', ranked.product_id,
                'name', coalesce(p.name, 'Mahsulot #' || ranked.product_id::text),
                'visitors', ranked.visitors
            ) order by ranked.visitors desc, ranked.product_id), '[]'::jsonb)
            from (
                select product_id, count(distinct visitor_key) as visitors
                from public.aroma_visitor_events, bounds
                where event_type = 'product_view' and event_day >= bounds.today - 29
                group by product_id order by visitors desc, product_id limit 5
            ) ranked
            left join public.products p on p.id = ranked.product_id
        )
    );
$$;
revoke all on function public.aroma_analytics_summary_v1() from public, anon, authenticated;
grant execute on function public.aroma_analytics_summary_v1() to service_role;
