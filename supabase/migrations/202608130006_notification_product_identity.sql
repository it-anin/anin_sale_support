-- Store product identity on notification history so each update is unambiguous.
alter table public.ss_branch_notification_events
  add column if not exists item_sku text;

alter table public.ss_branch_notification_events
  add column if not exists item_name text;

-- New signature used by the current application.
create or replace function public.ss_create_branch_notifications(
  target_branches text[],
  target_actor_code text,
  target_menu_id text,
  target_table_name text,
  target_record_id text,
  event_title text,
  event_detail text,
  event_item_sku text,
  event_item_name text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  event_time timestamptz := now();
begin
  insert into public.ss_branch_notification_events
    (branch, actor_code, menu_id, table_name, record_id, title, detail,
     item_sku, item_name, created_at)
  select distinct
    upper(trim(value)),
    case when upper(trim(target_actor_code)) = 'WAREHOUSE' then 'WAREHOUSE' else 'PURCHASING' end,
    coalesce(nullif(trim(target_menu_id), ''), 'salesupport'),
    coalesce(nullif(trim(target_table_name), ''), 'unknown'),
    nullif(trim(target_record_id), ''),
    coalesce(nullif(trim(event_title), ''), 'อัปเดตข้อมูล'),
    nullif(trim(event_detail), ''),
    nullif(trim(event_item_sku), ''),
    nullif(trim(event_item_name), ''),
    event_time
  from unnest(coalesce(target_branches, array[]::text[])) as branches(value)
  where upper(trim(value)) in ('SRC', 'KKL', 'SSS');

  insert into public.ss_branch_notifications (branch, last_update_at)
  select distinct upper(trim(value)), event_time
  from unnest(coalesce(target_branches, array[]::text[])) as branches(value)
  where upper(trim(value)) in ('SRC', 'KKL', 'SSS')
  on conflict (branch) do update
    set last_update_at = excluded.last_update_at;
end;
$$;

-- Keep the old signature during a rolling deployment of the frontend.
create or replace function public.ss_create_branch_notifications(
  target_branches text[],
  target_actor_code text,
  target_menu_id text,
  target_table_name text,
  target_record_id text,
  event_title text,
  event_detail text
)
returns void
language plpgsql
security invoker
set search_path = public
as $$
begin
  perform public.ss_create_branch_notifications(
    target_branches,
    target_actor_code,
    target_menu_id,
    target_table_name,
    target_record_id,
    event_title,
    event_detail,
    null,
    null
  );
end;
$$;

grant execute on function public.ss_create_branch_notifications(
  text[], text, text, text, text, text, text, text, text
) to anon, authenticated;

grant execute on function public.ss_create_branch_notifications(
  text[], text, text, text, text, text, text
) to anon, authenticated;

notify pgrst, 'reload schema';
