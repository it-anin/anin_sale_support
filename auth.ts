// โปรไฟล์ล็อกอินแต่ละแผนก + รหัสผ่าน (แก้ไขรหัสได้ที่ไฟล์นี้)
export interface Profile {
  id: string;
  label: string;
  group: 'สาขา' | 'คลังสินค้า' | 'จัดซื้อ';
  password: string;
  icon: string;
}

export const PROFILES: Profile[] = [
  { id: 'SRC',        label: 'SRC',        group: 'สาขา',       password: '1234', icon: '🏪' },
  { id: 'KKL',        label: 'KKL',        group: 'สาขา',       password: '4567', icon: '🏪' },
  { id: 'SSS',        label: 'SSS',        group: 'สาขา',       password: '9999', icon: '🏪' },
  { id: 'WAREHOUSE',  label: 'คลังสินค้า',  group: 'คลังสินค้า',  password: '0000', icon: '📦' },
  { id: 'PURCHASING', label: 'จัดซื้อ',    group: 'จัดซื้อ',    password: '1111', icon: '🛒' },
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
