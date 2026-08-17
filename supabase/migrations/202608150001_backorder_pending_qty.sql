-- Quantity still owed to the customer on a BackOrder, typed in by the branch on the add form.
-- Separate from the warehouse stock figure shown beside it, which is read live from `stock`.
alter table public.ss_backorders add column if not exists pending_qty numeric;

notify pgrst, 'reload schema';
