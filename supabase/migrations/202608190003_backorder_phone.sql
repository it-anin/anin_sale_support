-- Customer phone number on a BackOrder, typed in by the branch on the add form.
-- Pairs with `customer_name` as the second line of one cell in the Two-line Row table layout.
-- No `contact_channel` counterpart here (unlike ss_orders) — the BackOrder form asks for a phone only.
alter table public.ss_backorders add column if not exists phone text;

notify pgrst, 'reload schema';
