-- Ensure every Order always has a visible status for the three branch workflow steps.
update public.ss_orders
set
  arrived_branch = coalesce(nullif(btrim(arrived_branch), ''), 'ยังไม่ถึง'),
  customer_notified = coalesce(nullif(btrim(customer_notified), ''), 'ยังไม่แจ้ง'),
  delivered = coalesce(nullif(btrim(delivered), ''), 'ยังไม่ส่งมอบ')
where arrived_branch is null or btrim(arrived_branch) = ''
   or customer_notified is null or btrim(customer_notified) = ''
   or delivered is null or btrim(delivered) = '';

alter table public.ss_orders
  alter column arrived_branch set default 'ยังไม่ถึง',
  alter column arrived_branch set not null,
  alter column customer_notified set default 'ยังไม่แจ้ง',
  alter column customer_notified set not null,
  alter column delivered set default 'ยังไม่ส่งมอบ',
  alter column delivered set not null;

notify pgrst, 'reload schema';
