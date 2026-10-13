export type Lang = 'th' | 'en' | 'zh' | 'ja' | 'my' | 'km' | 'ko';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'th', label: 'ไทย' },
  { code: 'en', label: 'อังกฤษ' },
  { code: 'zh', label: 'จีน' },
  { code: 'ja', label: 'ญี่ปุ่น' },
  { code: 'my', label: 'พม่า' },
  { code: 'km', label: 'กัมพูชา' },
  { code: 'ko', label: 'เกาหลี' },
];

export interface Medicine {
  id: string;
  sku: string;
  barcode: string | null;
  trade_name: string;
  generic_name: string | null;
  usage: string | null;
  indication: string | null;
  warning: string | null;
  storage: string | null;
}

export interface ShopSettings {
  id: number;
  shop_name_th: string;
  shop_name_en: string;
  phone: string;
  line_id: string;
  logo_text: string;
}

/** ข้อมูลร้านที่ `Label` ใช้จริง = แถว `dl_settings` ทับด้วยค่าประจำสาขาที่ล็อกอิน (ชื่อร้าน/เบอร์โทร)
 *  + เภสัชกรประจำสาขา — ประกอบที่ `activeSettings` ใน DrugLabelPage (ข้อมูลสาขาอยู่ใน `BRANCH_PROFILES`)
 *  `pharmacist` เป็นข้อความสำเร็จรูปรวมเลขใบอนุญาต เช่น "วัชรพันธ์ สุริยะคุปต์ (ภ. 45878)" ไม่ได้มาจาก DB */
export interface LabelShopInfo extends ShopSettings {
  pharmacist: string;
}
