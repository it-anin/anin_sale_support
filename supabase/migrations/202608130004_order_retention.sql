-- Keep incomplete Orders indefinitely. Completed Orders are deleted one month
-- after all three branch workflow stamps have been confirmed.

alter table public.ss_orders
  add column if not exists workflow_completed_at timestamptz;

create or replace function public.ss_track_order_workflow_completion()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  all_steps_done boolean :=
    upper(trim(coalesce(new.branch, ''))) in ('SRC', 'KKL', 'SSS')
    and coalesce(new.arrived_branch, '') like '%แล้ว%'
    and coalesce(new.arrived_branch, '') not like '%ยังไม่%'
    and coalesce(new.customer_notified, '') like '%แล้ว%'
    and coalesce(new.customer_notified, '') not like '%ยังไม่%'
    and coalesce(new.delivered, '') like '%แล้ว%'
    and coalesce(new.delivered, '') not like '%ยังไม่%';
  old_all_steps_done boolean := false;
begin
  if tg_op = 'UPDATE' then
    old_all_steps_done :=
      upper(trim(coalesce(old.branch, ''))) in ('SRC', 'KKL', 'SSS')
      and coalesce(old.arrived_branch, '') like '%แล้ว%'
      and coalesce(old.arrived_branch, '') not like '%ยังไม่%'
      and coalesce(old.customer_notified, '') like '%แล้ว%'
      and coalesce(old.customer_notified, '') not like '%ยังไม่%'
      and coalesce(old.delivered, '') like '%แล้ว%'
      and coalesce(old.delivered, '') not like '%ยังไม่%';
  end if;

  if all_steps_done then
    if tg_op = 'INSERT' then
      new.workflow_completed_at := now();
    elsif not old_all_steps_done or old.workflow_completed_at is null then
      new.workflow_completed_at := now();
    else
      new.workflow_completed_at := old.workflow_completed_at;
    end if;
  else
    new.workflow_completed_at := null;
  end if;
  return new;
end;
$$;

drop trigger if exists ss_track_order_workflow_completion_trigger on public.ss_orders;
create trigger ss_track_order_workflow_completion_trigger
before insert or update of branch, arrived_branch, customer_notified, delivered, workflow_completed_at
on public.ss_orders
for each row execute function public.ss_track_order_workflow_completion();

-- Existing completed Orders start their one-month retention period now because
-- the historical time of the third stamp was not previously recorded.
update public.ss_orders
set workflow_completed_at = now()
where workflow_completed_at is null
  and upper(trim(coalesce(branch, ''))) in ('SRC', 'KKL', 'SSS')
  and arrived_branch like '%แล้ว%' and arrived_branch not like '%ยังไม่%'
  and customer_notified like '%แล้ว%' and customer_notified not like '%ยังไม่%'
  and delivered like '%แล้ว%' and delivered not like '%ยังไม่%';

create index if not exists ss_orders_workflow_completed_at_idx
  on public.ss_orders (workflow_completed_at)
  where workflow_completed_at is not null;

create or replace function public.ss_delete_expired_completed_orders()
returns bigint
language plpgsql
security definer
set search_path = public
as $$
declare deleted_count bigint;
begin
  delete from public.ss_branch_notification_events as event
  using public.ss_orders as order_row
  where event.table_name = 'ss_orders'
    and event.record_id = order_row.id::text
    and order_row.workflow_completed_at < now() - interval '1 month'
    and upper(trim(coalesce(order_row.branch, ''))) in ('SRC', 'KKL', 'SSS')
    and order_row.arrived_branch like '%แล้ว%' and order_row.arrived_branch not like '%ยังไม่%'
    and order_row.customer_notified like '%แล้ว%' and order_row.customer_notified not like '%ยังไม่%'
    and order_row.delivered like '%แล้ว%' and order_row.delivered not like '%ยังไม่%';

  delete from public.ss_orders
  where workflow_completed_at < now() - interval '1 month'
    and upper(trim(coalesce(branch, ''))) in ('SRC', 'KKL', 'SSS')
    and arrived_branch like '%แล้ว%' and arrived_branch not like '%ยังไม่%'
    and customer_notified like '%แล้ว%' and customer_notified not like '%ยังไม่%'
    and delivered like '%แล้ว%' and delivered not like '%ยังไม่%';
  get diagnostics deleted_count = row_count;
  return deleted_count;
end;
$$;

revoke all on function public.ss_delete_expired_completed_orders()
  from public, anon, authenticated;

-- Supabase Cron uses UTC. 19:30 UTC is 02:30 in Thailand on the next day.
create extension if not exists pg_cron;
select cron.schedule(
  'salesupport-delete-completed-orders-after-one-month',
  '30 19 * * *',
  $$select public.ss_delete_expired_completed_orders();$$
);

notify pgrst, 'reload schema';
