// โปรไฟล์ล็อกอินแต่ละแผนก + รหัสผ่าน (แก้ไขรหัสได้ที่ไฟล์นี้)
export interface Profile {
  id: string;
  label: string;
  group: 'สาขา' | 'คลังสินค้า' | 'จัดซื้อ';
  password: string;
  icon: string;
  /**
   * สาขาที่ใช้กับปุ่ม "เลือกตามหมวด" หน้าป้ายราคา
   * ต้องตรงกับ `CATEGORY_BRANCHES` ใน App.tsx และ `product_category.branch` เป๊ะ ๆ
   *
   * `null` = ไม่ปริ้นป้ายตามหมวด → ซ่อนปุ่มทั้งปุ่ม (กันปริ้นผิดสาขา)
   *   - `WAREHOUSE` คลังสินค้าไม่ได้ติดป้ายราคาที่ชั้นวาง
   *   - `PURCHASING` จัดซื้อไม่ใช่หน่วยหน้าร้าน
   * ฟีเจอร์นี้ใช้เฉพาะสาขาหน้าร้าน SRC / KKL / SSS เท่านั้น
   */
  branch: string | null;
}

export const PROFILES: Profile[] = [
  { id: 'SRC',        label: 'SRC',        group: 'สาขา',       password: '1234', icon: '🏪', branch: 'SRC' },
  { id: 'KKL',        label: 'KKL',        group: 'สาขา',       password: '4567', icon: '🏪', branch: 'KKL' },
  { id: 'SSS',        label: 'SSS',        group: 'สาขา',       password: '9999', icon: '🏪', branch: 'SSS' },
  { id: 'WAREHOUSE',  label: 'คลังสินค้า',  group: 'คลังสินค้า',  password: '0000', icon: '📦', branch: null },
  { id: 'PURCHASING', label: 'จัดซื้อ',    group: 'จัดซื้อ',    password: '1111', icon: '🛒', branch: null },
];

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
