import type { SupabaseClient } from '@supabase/supabase-js';
import type { SheetRows } from './engine';

interface ProductMasterRow {
  sku: string;
  name: string | null;
  base_unit: string | null;
  purchase_unit: string | null;
  cost: string | number | null;
}

/** อ่านชุดเดียวกับปุ่มอัปโหลด Product Master ของ SaleSupport รวมทุก ABC */
export async function loadProductMaster(client: SupabaseClient, signal: AbortSignal): Promise<SheetRows> {
  const rows: SheetRows = [['SKU', 'NAME', 'BASE_UNIT', 'PURCHASE_UNIT', 'ทุนซื้อ']];
  let from = 0;
  while (true) {
    signal.throwIfAborted();
    const { data, error } = await client.from('product_master')
      .select('sku,name,base_unit,purchase_unit,cost').order('sku')
      .range(from, from + 999).abortSignal(signal);
    signal.throwIfAborted();
    if (error) throw new Error(`โหลด Product Master ไม่สำเร็จ: ${error.message}`);
    if (!data) throw new Error('โหลด Product Master ไม่สำเร็จ กรุณาลองอีกครั้ง');
    if (data.length === 0) break;
    for (const row of data as ProductMasterRow[]) {
      rows.push([row.sku, row.name, row.base_unit, row.purchase_unit, row.cost]);
    }
    // เดินตามจำนวนที่ได้รับจริง รองรับกรณี Data API จำกัดต่ำกว่า 1,000 แถว
    from += data.length;
  }
  if (rows.length === 1) throw new Error('ยังไม่มี Product Master กรุณาอัปโหลดที่หน้า SaleSupport แล้วกดโหลดข้อมูลล่าสุด');
  return rows;
}
