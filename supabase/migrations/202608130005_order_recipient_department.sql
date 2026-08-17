-- Route new branch Orders to exactly one recipient department.
-- Legacy Orders remain visible to both departments and are not marked as new.

alter table public.ss_orders
  add column if not exists recipient_department text,
  add column if not exists recipient_read_at timestamptz;

update public.ss_orders
set recipient_department = 'BOTH',
    recipient_read_at = coalesce(recipient_read_at, now())
where recipient_department is null or btrim(recipient_department) = '';

alter table public.ss_orders
  alter column recipient_department set default 'BOTH',
  alter column recipient_department set not null;

alter table public.ss_orders
  drop constraint if exists ss_orders_recipient_department_check;
alter table public.ss_orders
  add constraint ss_orders_recipient_department_check
  check (recipient_department in ('WAREHOUSE', 'PURCHASING', 'BOTH'));

create index if not exists ss_orders_recipient_unread_idx
  on public.ss_orders (recipient_department, recipient_read_at)
  where recipient_read_at is null;

-- Realtime makes the SaleSupport page-nav dot appear for only the selected
-- WAREHOUSE or PURCHASING profile. Polling remains as a fallback in the app.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (
       select 1 from pg_publication_tables
       where pubname = 'supabase_realtime'
         and schemaname = 'public'
         and tablename = 'ss_orders'
     ) then
    alter publication supabase_realtime add table public.ss_orders;
  end if;
end $$;

notify pgrst, 'reload schema';
