export type Lang = 'th' | 'en' | 'zh' | 'ja' | 'my' | 'km';

export const LANGS: { code: Lang; label: string }[] = [
  { code: 'th', label: 'ไทย' },
  { code: 'en', label: 'อังกฤษ' },
  { code: 'zh', label: 'จีน' },
  { code: 'ja', label: 'ญี่ปุ่น' },
  { code: 'my', label: 'พม่า' },
  { code: 'km', label: 'กัมพูชา' },
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
