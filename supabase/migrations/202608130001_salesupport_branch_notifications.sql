-- จุดแจ้งเตือน SaleSupport แยกตามรหัสสาขา
create table if not exists public.ss_branch_notifications (
  branch         text primary key check (branch in ('SRC', 'KKL', 'SSS')),
  last_update_at timestamptz,
  last_read_at   timestamptz
);

insert into public.ss_branch_notifications (branch)
values ('SRC'), ('KKL'), ('SSS')
on conflict (branch) do nothing;

alter table public.ss_branch_notifications enable row level security;

drop policy if exists "anon all ss_branch_notifications" on public.ss_branch_notifications;
create policy "anon all ss_branch_notifications"
  on public.ss_branch_notifications
  for all
  using (true)
  with check (true);

-- ใช้เวลาจากฐานข้อมูล เพื่อไม่พึ่งนาฬิกาของเครื่องคลัง/จัดซื้อ
create or replace function public.ss_notify_branches(target_branches text[])
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.ss_branch_notifications (branch, last_update_at)
  select upper(trim(value)), now()
  from unnest(coalesce(target_branches, array[]::text[])) as branches(value)
  where upper(trim(value)) in ('SRC', 'KKL', 'SSS')
  on conflict (branch) do update
    set last_update_at = excluded.last_update_at;
$$;

create or replace function public.ss_mark_branch_notifications_read(target_branch text)
returns void
language sql
security invoker
set search_path = public
as $$
  insert into public.ss_branch_notifications (branch, last_read_at)
  select upper(trim(target_branch)), now()
  where upper(trim(target_branch)) in ('SRC', 'KKL', 'SSS')
  on conflict (branch) do update
    set last_read_at = excluded.last_read_at;
$$;

grant select, insert, update on public.ss_branch_notifications to anon, authenticated;
grant execute on function public.ss_notify_branches(text[]) to anon, authenticated;
grant execute on function public.ss_mark_branch_notifications_read(text) to anon, authenticated;

-- ให้จุดแดงขึ้นทันทีเมื่อมีอัปเดต (แอปยังมี polling สำรองทุก 30 วินาที)
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'ss_branch_notifications'
     ) then
    alter publication supabase_realtime add table public.ss_branch_notifications;
  end if;
end $$;

notify pgrst, 'reload schema';
