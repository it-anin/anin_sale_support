-- Purchase-order number on a BackOrder, filled in by จัดซื้อ (PURCHASING) only.
-- Everyone else sees it read-only: the branch needs to know whether purchasing has
-- already raised a PO for the row it is waiting on, but must not be able to type one in.
-- Edited straight from the table cell (same pattern as ss_request_items.sku / .moq),
-- so there is no add-form field for it — the value arrives after the row already exists.
alter table public.ss_backorders add column if not exists po_no text;

notify pgrst, 'reload schema';
