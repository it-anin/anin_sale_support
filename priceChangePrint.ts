import type { SupabaseClient } from '@supabase/supabase-js';

export interface PriceChangePrintProduct {
  barcode: string;
  sku: string;
  name: string;
  unit: string;
  price: number;
  rowIndex: number;
  quantity: number;
}

const PAGE_SIZE = 1000;
const BARCODE_CHUNK_SIZE = 100;

/** โหลดทั้ง batch ใหม่เสมอ — รายการใน drawer อาจถูกตัดด้วยเพดานประวัติ
 *  จับคู่ด้วย barcode เพื่อเก็บหน่วยต่างกันของ SKU เดียวกัน และใช้ราคาปัจจุบัน
 *  แทนราคาในประวัติ (กดพิมพ์รอบเก่าก็ต้องไม่พิมพ์ราคาที่เลิกใช้แล้ว) */
export async function loadPriceChangePrintProducts(
  client: SupabaseClient,
  batchId: string,
): Promise<PriceChangePrintProduct[]> {
  const barcodes = new Set<string>();
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await client
      .from('price_change_log')
      .select('barcode')
      .eq('batch_id', batchId)
      .order('sku', { ascending: true })
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`โหลดรายการราคาเปลี่ยนไม่สำเร็จ: ${error.message}`);
    for (const row of data ?? []) {
      if (!row.barcode) throw new Error('มีรายการที่ไม่มีบาร์โค้ด กรุณาตรวจสอบข้อมูลก่อนพิมพ์');
      barcodes.add(row.barcode);
    }
    if ((data?.length ?? 0) < PAGE_SIZE) break;
  }
  if (barcodes.size === 0) throw new Error('ไม่พบรายการราคาเปลี่ยนในรอบนี้');

  const barcodeList = [...barcodes];
  const currentProducts = new Map<string, PriceChangePrintProduct>();
  for (let i = 0; i < barcodeList.length; i += BARCODE_CHUNK_SIZE) {
    const chunk = barcodeList.slice(i, i + BARCODE_CHUNK_SIZE);
    for (let from = 0; ; from += PAGE_SIZE) {
      const { data, error } = await client
        .from('products')
        .select('barcode, sku, name, unit, price')
        .in('barcode', chunk)
        // products ไม่ได้บังคับ unique barcode — ใช้แถวล่าสุดเหมือน log_price_changes()
        .order('id', { ascending: false })
        .range(from, from + PAGE_SIZE - 1);
      if (error) throw new Error(`โหลดสินค้าสำหรับพิมพ์ไม่สำเร็จ: ${error.message}`);
      for (const row of data ?? []) {
        if (currentProducts.has(row.barcode)) continue;
        if (typeof row.price !== 'number' || !Number.isFinite(row.price)) {
          throw new Error(`ราคาสินค้า SKU ${row.sku ?? ''} ไม่ถูกต้อง กรุณาตรวจสอบก่อนพิมพ์`);
        }
        currentProducts.set(row.barcode, {
          barcode: row.barcode,
          sku: row.sku ?? '',
          name: row.name ?? '',
          unit: row.unit ?? '',
          price: row.price,
          rowIndex: 0,
          quantity: 1,
        });
      }
      if ((data?.length ?? 0) < PAGE_SIZE) break;
    }
  }

  const missing = barcodeList.filter(barcode => !currentProducts.has(barcode));
  if (missing.length > 0) {
    throw new Error(`ไม่พบสินค้าปัจจุบัน ${missing.length.toLocaleString()} รายการ กรุณาตรวจสอบข้อมูลก่อนพิมพ์`);
  }
  return barcodeList.map((barcode, rowIndex) => ({ ...currentProducts.get(barcode)!, rowIndex }));
}
