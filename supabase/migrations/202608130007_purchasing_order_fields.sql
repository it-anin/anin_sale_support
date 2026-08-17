-- Fields edited by Purchasing in the Order detail popup.
-- All statements are idempotent because some databases already have these columns.
alter table public.ss_orders add column if not exists order_type text;
alter table public.ss_orders add column if not exists order_bill_no text;
alter table public.ss_orders add column if not exists order_date date;
alter table public.ss_orders add column if not exists order_source text;
alter table public.ss_orders add column if not exists eta_date date;

notify pgrst, 'reload schema';
