alter table public.ss_orders
  add column if not exists contact_channel text;

alter table public.ss_request_items
  add column if not exists contact_channel text;

notify pgrst, 'reload schema';
