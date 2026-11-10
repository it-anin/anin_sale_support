import type { SupabaseClient } from '@supabase/supabase-js';

export interface PriceCacheProduct {
  barcode: string;
  sku: string;
  name: string;
  unit: string;
  price: number;
  category?: string;
}

/** Refresh only barcodes already displayed/saved, with bounded request sizes. */
export async function loadCurrentPriceRows(client: Pick<SupabaseClient, 'from'>, barcodes: string[]) {
  const unique = [...new Set(barcodes.filter(Boolean))];
  const rows = new Map<string, PriceCacheProduct>();
  for (let i = 0; i < unique.length; i += 100) {
    const { data, error } = await client.from('products')
      .select('barcode,sku,name,unit,price,category').in('barcode', unique.slice(i, i + 100));
    if (error) throw error;
    for (const row of data ?? []) rows.set(row.barcode, {
      barcode: row.barcode, sku: row.sku ?? '', name: row.name ?? '', unit: row.unit ?? '',
      price: row.price ?? 0, category: row.category || 'ทั่วไป',
    });
  }
  return rows;
}

/** Keep quantities, shelf locations and other UI fields; remove deleted rows. */
export function currentPriceProduct<T extends PriceCacheProduct>(
  product: T, fresh: ReadonlyMap<string, PriceCacheProduct>, requested: ReadonlySet<string>,
): T | null {
  if (!requested.has(product.barcode)) return product; // Added while the request was in flight.
  const row = fresh.get(product.barcode);
  if (!row) return null;
  if (['sku', 'name', 'unit', 'price', 'category'].every(key =>
    product[key as keyof PriceCacheProduct] === row[key as keyof PriceCacheProduct])) return product;
  return { ...product, ...row };
}

export function refreshPriceMap<T extends PriceCacheProduct>(
  previous: Map<string, T>, fresh: ReadonlyMap<string, PriceCacheProduct>, requested: ReadonlySet<string>,
): Map<string, T> {
  const next = new Map<string, T>();
  let changed = false;
  for (const product of previous.values()) {
    const updated = currentPriceProduct(product, fresh, requested);
    if (updated !== product) changed = true;
    if (updated) next.set(`${updated.sku}-${updated.unit}`, updated);
  }
  return changed ? next : previous;
}
