-- Transfer / delivery number the warehouse fills in on a BackOrder, mirroring ss_orders.transfer_no.
alter table public.ss_backorders add column if not exists transfer_no text;

notify pgrst, 'reload schema';
