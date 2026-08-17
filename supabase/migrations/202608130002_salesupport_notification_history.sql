-- ประวัติแจ้งเตือน SaleSupport: ระบุว่าใครแก้เมนู/รายการ/ข้อมูลใด
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
  on public.ss_branch_notifications for all using (true) with check (true);

create table if not exists public.ss_branch_notification_events (
  id          uuid primary key default gen_random_uuid(),
  branch      text not null check (branch in ('SRC', 'KKL', 'SSS')),
  actor_code  text not null check (actor_code in ('WAREHOUSE', 'PURCHASING')),
  menu_id     text not null,
  table_name  text not null,
  record_id   text,
  title       text not null,
  detail      text,
  created_at  timestamptz not null default now(),
  read_at     timestamptz
);

create index if not exists ss_branch_notification_events_branch_created_idx
  on public.ss_branch_notification_events (branch, created_at desc);
create index if not exists ss_branch_notification_events_unread_idx
  on public.ss_branch_notification_events (branch, read_at)
  where read_at is null;

alter table public.ss_branch_notification_events enable row level security;
drop policy if exists "anon all ss_branch_notification_events" on public.ss_branch_notification_events;
create policy "anon all ss_branch_notification_events"
  on public.ss_branch_notification_events
  for all
  using (true)
  with check (true);

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
declare
  event_time timestamptz := now();
begin
  insert into public.ss_branch_notification_events
    (branch, actor_code, menu_id, table_name, record_id, title, detail, created_at)
  select distinct
    upper(trim(value)),
    case when upper(trim(target_actor_code)) = 'WAREHOUSE' then 'WAREHOUSE' else 'PURCHASING' end,
    coalesce(nullif(trim(target_menu_id), ''), 'salesupport'),
    coalesce(nullif(trim(target_table_name), ''), 'unknown'),
    nullif(trim(target_record_id), ''),
    coalesce(nullif(trim(event_title), ''), 'อัปเดตข้อมูล'),
    nullif(trim(event_detail), ''),
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

-- เปิดประวัติแล้วทำเครื่องหมายอ่านทั้ง event และ summary ของสาขานั้น
create or replace function public.ss_mark_branch_notifications_read(target_branch text)
returns void
language plpgsql
security invoker
set search_path = public
as $$
declare
  read_time timestamptz := now();
  normalized_branch text := upper(trim(target_branch));
begin
  if normalized_branch not in ('SRC', 'KKL', 'SSS') then return; end if;

  update public.ss_branch_notification_events
  set read_at = read_time
  where branch = normalized_branch and read_at is null;

  insert into public.ss_branch_notifications (branch, last_read_at)
  values (normalized_branch, read_time)
  on conflict (branch) do update
    set last_read_at = excluded.last_read_at;
end;
$$;

grant select, insert, update on public.ss_branch_notifications to anon, authenticated;
grant select, insert, update on public.ss_branch_notification_events to anon, authenticated;
grant execute on function public.ss_create_branch_notifications(text[], text, text, text, text, text, text) to anon, authenticated;
grant execute on function public.ss_mark_branch_notifications_read(text) to anon, authenticated;

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
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'ss_branch_notification_events'
     ) then
    alter publication supabase_realtime add table public.ss_branch_notification_events;
  end if;
end $$;

notify pgrst, 'reload schema';
