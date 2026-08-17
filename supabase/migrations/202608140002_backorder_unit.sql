-- Unit of the barcode scanned/picked in the Add BackOrder form (in `products` one barcode always
-- maps to exactly one unit). The warehouse quantity shown beside it comes from `stock`, which
-- always counts in the smallest unit — so the two can differ (530 แผง on hand, unit = กล่อง).
alter table public.ss_backorders add column if not exists unit text;

notify pgrst, 'reload schema';
