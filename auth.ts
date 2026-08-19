// โปรไฟล์ล็อกอินแต่ละแผนก + รหัสผ่าน (แก้ไขรหัสได้ที่ไฟล์นี้)
export interface Profile {
  id: string;
  label: string;
  group: 'สาขา' | 'คลังสินค้า' | 'จัดซื้อ';
  password: string;
  icon: string;
  /**
   * รหัสที่ใช้แทนตัวโปรไฟล์นี้ในฐานข้อมูล — ทำ 2 หน้าที่พร้อมกัน:
   *
   * 1. **ค่าในคอลัมน์ `branch`** ของ ss_orders / ss_request_items / ss_new_products /
   *    ss_tickets และเป็น `actor_code` ของตารางแจ้งเตือน (ดู `BRANCH_PROFILE_CODES` ด้านล่าง)
   * 2. **สาขาของปุ่ม "เลือกตามหมวด"** หน้าป้ายราคา — ใช้ได้เฉพาะค่าที่อยู่ใน
   *    `CATEGORY_BRANCHES` ของ App.tsx และ `product_category.branch` ด้วย
   *    (`SALE_ADMIN` ผ่านข้อ 1 แต่ไม่ผ่านข้อ 2 → ปุ่มถูกซ่อน ตั้งใจ ไม่ใช่บั๊ก)
   *
   * `null` = ไม่สังกัดสาขา ไม่ลงข้อมูลเป็นผู้ขอ และไม่ปริ้นป้ายตามหมวด
   *   - `WAREHOUSE` คลังสินค้าไม่ได้ติดป้ายราคาที่ชั้นวาง
   *   - `PURCHASING` จัดซื้อไม่ใช่หน่วยหน้าร้าน
   */
  branch: string | null;
}

export const PROFILES: Profile[] = [
  { id: 'SRC',        label: 'SRC',        group: 'สาขา',       password: '1234', icon: '🏪', branch: 'SRC' },
  { id: 'KKL',        label: 'KKL',        group: 'สาขา',       password: '4567', icon: '🏪', branch: 'KKL' },
  { id: 'SSS',        label: 'SSS',        group: 'สาขา',       password: '9999', icon: '🏪', branch: 'SSS' },
  // Sale Admin ใช้ group 'สาขา' โดยตั้งใจ — ทุกจุดที่เช็ค group === 'สาขา' อยู่แล้วจะรับเข้าเป็น
  // สาขาอัตโนมัติ ไม่ต้องขยาย union type แล้วไล่แก้ derivation ทีละจุด (เสี่ยงตกหล่น)
  // ⚠️ ไม่ใช่สาขาหน้าร้านจริง — ไม่มีชั้นวาง ไม่มีไฟล์ Location และไม่ใช้เมนู BackOrder/หน้าเบิกด่วน
  { id: 'SALE_ADMIN', label: 'Sale Admin', group: 'สาขา',       password: '5555', icon: '🧑‍💼', branch: 'SALE_ADMIN' },
  { id: 'WAREHOUSE',  label: 'คลังสินค้า',  group: 'คลังสินค้า',  password: '0000', icon: '📦', branch: null },
  { id: 'PURCHASING', label: 'จัดซื้อ',    group: 'จัดซื้อ',    password: '1111', icon: '🛒', branch: null },
];

/** รหัสโปรไฟล์ที่ "ลงข้อมูลเป็นผู้ขอ" ได้ = สาขาหน้าร้าน + Sale Admin
 *  ⚠️ ค่าเหล่านี้ถูกเขียนลงคอลัมน์ `branch` ของ ss_orders / ss_request_items /
 *     ss_new_products / ss_tickets และเป็น actor_code ของตารางแจ้งเตือน
 *     ต้องตรงกับ CHECK constraint + filter ใน RPC ฝั่ง Supabase เป๊ะ ๆ
 *  ⚠️ `ss_backorders` รับ SALE_ADMIN แล้วตั้งแต่ migration 202608190002 (2569-08-19)
 *     Sale Admin จึงใช้เมนู BackOrder ได้เต็มรูปแบบ ไม่มี role แยกซ่อนเมนูอีกแล้ว
 *  ⚠️ ยังไม่รวม `outbound_requests` — CHECK ของตารางนั้นยังเป็น SRC/KKL/SSS
 *     (Sale Admin จึงยังถูกกันออกจากหน้าเบิกด่วน — ดู branchNotSupported ใน OutboundPage.tsx) */
export const BRANCH_PROFILE_CODES = ['SRC', 'KKL', 'SSS', 'SALE_ADMIN'] as const;

/** แปลงรหัสในฐานข้อมูลเป็นชื่อที่แสดงให้ผู้ใช้เห็น (SALE_ADMIN → "Sale Admin")
 *  อ่านจาก PROFILES.label โดยตรงจึงไม่มี map ซ้ำให้หลุด sync · ค่าที่ไม่รู้จักคืนค่าเดิม
 *  (WAREHOUSE/PURCHASING มี branch: null จึงไม่ match โดยบังเอิญ) */
export function branchCodeLabel(code: unknown): string {
  const raw = String(code ?? '').trim();
  if (!raw) return '';
  return PROFILES.find(p => p.branch === raw)?.label ?? raw;
}

const AUTH_KEY = 'authProfileId';

// โหลดโปรไฟล์ที่ล็อกอินค้างไว้จาก localStorage (คงสถานะข้ามการรีเฟรช/ปิดเปิดเบราว์เซอร์)
export function loadAuthProfile(): Profile | null {
  try {
    const id = localStorage.getItem(AUTH_KEY);
    return PROFILES.find(p => p.id === id) ?? null;
  } catch {
    return null;
  }
}

export function saveAuthProfile(id: string): void {
  try { localStorage.setItem(AUTH_KEY, id); } catch { /* ignore */ }
}

export function clearAuthProfile(): void {
  try { localStorage.removeItem(AUTH_KEY); } catch { /* ignore */ }
}
