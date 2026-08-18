import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { supabase } from './supabase';
import { DrugLabelPage } from './druglabel/DrugLabelPage';
import { StockCheckPage } from './StockCheckPage';
import { CustomerHistoryPage } from './CustomerHistoryPage';
import { OutboundPage } from './OutboundPage';
import { SaleSupportPage } from './SaleSupportPage';
import { AnimatedLogoText } from './AnimatedLogo';
import { SearchIcon } from './SearchIcon';
import { LoginPage } from './LoginPage';
import { loadAuthProfile, saveAuthProfile, clearAuthProfile, type Profile } from './auth';
import { PageVisibilityContext, PageNotificationContext, PageNavRow, PAGE_NAV, DEFAULT_VISIBILITY, type PageId, type PageVisibility, type NavHandlers } from './pageAccess';
import './App.css';

// Types
interface Product {
  barcode: string;
  sku: string;
  name: string;
  unit: string;
  price: number;
  category?: string;
  /** ตำแหน่งชั้นวาง (เช่น A14) — มีเฉพาะสินค้าที่โหลดมาจากปุ่ม "เลือกตามหมวด"
   *  เพราะข้อมูลนี้อยู่ใน product_category ไม่ได้อยู่ใน products
   *  แสดงมุมซ้ายบนของป้ายราคาคู่กับโลโก้ · ถ้าไม่มีก็ไม่แสดงอะไร */
  location?: string;
  rowIndex: number;
}

interface SelectedProduct extends Product {
  quantity: number;
}

interface ThermalSettings {
  sheetW: number;     // mm — ความกว้าง sheet ทั้งแผ่น
  sheetH: number;     // mm — ความสูง sheet ทั้งแผ่น
  cols: number;
  rows: number;
  offsetTop: number;  // mm — เลื่อนขึ้น/ลง
  offsetLeft: number; // mm — เลื่อนซ้าย/ขวา
  gapX: number;       // mm — ระยะห่างแนวนอนระหว่างช่อง
  gapY: number;       // mm — ระยะห่างแนวตั้งระหว่างช่อง
  qrSize: number;     // mm
  fontSize: number;   // pt
  skuSize: number;    // pt
}

const DEFAULT_THERMAL_SETTINGS: ThermalSettings = {
  sheetW: 90, sheetH: 62,
  cols: 4, rows: 5,
  offsetTop: 0, offsetLeft: 2,
  gapX: 2, gapY: 2,
  qrSize: 7,
  fontSize: 3.5, skuSize: 3.5,
};

// ── หมวดสินค้า (เลือกตามหมวด) ────────────────────────────────
// label ใช้คำของผู้ใช้ ไม่ใช่ข้อความในไฟล์ Excel — ข้อความในไฟล์ต่างกันระหว่างสาขา
// เช่น SSS = "6. เครื่องสำอาง" แต่ WH = "6. เวชสำอาง / เครื่องสำอาง"
// key ที่เสถียรคือ "เลขนำหน้า" เท่านั้น
const PRODUCT_CATEGORIES: { no: number; label: string }[] = [
  { no: 1, label: 'ยาแผนปัจจุบัน (กิน)' },
  { no: 2, label: 'ยาแผนปัจจุบัน (ภายนอก/เฉพาะที่)' },
  { no: 3, label: 'ยาแผนโบราณ-สมุนไพร (กิน)' },
  { no: 4, label: 'ยาแผนโบราณ-สมุนไพร (ภายนอก/เฉพาะที่)' },
  { no: 5, label: 'อาหารเสริม' },
  { no: 6, label: 'เวชสำอาง/เครื่องสำอาง' },
  { no: 7, label: 'เวชภัณฑ์/เครื่องมือแพทย์/ทำแผล' },
  { no: 8, label: 'สินค้าอุปโภค/บริโภค' },
  { no: 9, label: 'ยาโรคเรื้อรัง/พิเศษ/ประสาท/ฉีด' },
];

// สาขาที่ปริ้นป้ายตามหมวดได้ — **เฉพาะสาขาหน้าร้าน**
// ไม่มี 'คลังสินค้า' โดยตั้งใจ (คลังไม่ได้ติดป้ายราคาที่ชั้นวาง) — ชุดนี้จึงสั้นกว่า
// TABS ใน StockCheckPage.tsx / BRANCH_MAP ใน upload-stock.mjs ที่มี 4 สาขา
const CATEGORY_BRANCHES = ['SRC', 'KKL', 'SSS'] as const;

// เดาสาขาจากชื่อไฟล์ — ใช้เตือนใน confirm เท่านั้น ไม่ใช่ตัวตัดสิน
// สาขาจริงมาจากโปรไฟล์ที่ล็อกอิน
// ยังเดา 'คลังสินค้า' ไว้ทั้งที่ปริ้นไม่ได้ เพื่อให้เตือนได้ถ้าเผลอเอาไฟล์ WH มาลงสาขาหน้าร้าน
function guessBranchFromFileName(name: string): string | null {
  const n = name.toLowerCase();
  if (/\bwh\b|warehouse|คลัง/.test(n)) return 'คลังสินค้า';
  if (/\bsss\b/.test(n)) return 'SSS';
  if (/\bkkl\b/.test(n)) return 'KKL';
  if (/\bsrc\b|front\s*store/.test(n)) return 'SRC';
  return null;
}

const CAT_PREFIX_RE = /^\s*(\d{1,2})\s*\./;

/** สิ่งที่กำลังเลือกอยู่บนตาราง — หมวด หรือ กลุ่มชั้นวาง (เลือกได้ทีละอย่าง)
 *  locGroup เก็บรายชื่อชั้นวางในกลุ่มมาด้วย เพื่อ query ด้วย .in() แบบตรงตัว
 *  (ไม่ใช้ LIKE 'A%' เพราะถ้าวันหน้ามีกลุ่ม A กับ AB พร้อมกัน prefix จะกินกัน) */
type CatSelection =
  | { kind: 'category'; no: number }
  | { kind: 'locGroup'; prefix: string; locs: string[] };

/** กลุ่มของรหัสชั้นวาง = ตัดเลขท้ายออก — 1A12→1A · U42→U · M2→M · K→K */
const locationGroupOf = (v: string) => v.replace(/\d+$/, '') || v;

/** เรียงรหัสชั้นวางแบบ natural — string sort ธรรมดาจะได้ M1 M11 M12 M2
 *  ที่ถูกคือ M1 M2 M3 M11 (ข้อมูลจริงมีทั้ง M2 และ M11 อยู่ด้วยกัน) */
const compareLocation = (a: string, b: string) =>
  a.localeCompare(b, undefined, { numeric: true, sensitivity: 'base' });

// ── Barcode generator + cache ────────────────────────────────
// ⚠️ ต้อง cache: .print-only render ตลอดเวลา (ซ่อนด้วย CSS display:none เท่านั้น)
// และขยายตาม quantity → ถ้าไม่ cache จะเรียก JsBarcode + canvas.toDataURL()
// ทีละป้าย ทุกครั้งที่ App re-render (1,300 รายการ = แอปค้าง)
// input เดิม → output เดิมทุกพิกเซล ไม่ขัดกฎ FROZEN (width: 3, height: 90 ไม่ถูกแตะ)
const barcodeCache = new Map<string, string>();

const generateBarcode = (barcode: string): string => {
  const hit = barcodeCache.get(barcode);
  if (hit !== undefined) return hit;
  try {
    const canvas = document.createElement('canvas');
    JsBarcode(canvas, barcode, {
      format: 'CODE128',
      width: 3,
      height: 90,
      displayValue: false,
      margin: 0
    });
    const url = canvas.toDataURL('image/png');
    barcodeCache.set(barcode, url);
    return url;
  } catch (error) {
    console.error('Barcode generation error:', error);
    return '';
  }
};

// ── Products CSV (รายงาน R05.106 จาก Promax) ────────────────
// 27 คอลัมน์ ชื่อหัวคอลัมน์นิ่งมาตลอด (ตรวจกับ export จริง 11 ไฟล์ พ.ค.–ส.ค. 2569)
// ⚠️ ค้นคอลัมน์จาก "ชื่อหัว" เท่านั้น ไม่มี fallback ตำแหน่ง — ถ้า fallback ไฟล์ผิดรูปแบบ
//    จะหลุดผ่านแล้วลบ products ทิ้งทั้งตาราง ซึ่งเป็นปัญหาที่ validation นี้มีไว้กัน
const PRODUCT_CSV_COLUMNS = [
  { key: 'barcode',  header: 'CF_BARCODE',               label: 'บาร์โค้ด' },
  { key: 'price',    header: 'CF_FMLPRICE',              label: 'ราคา' },
  { key: 'sku',      header: 'CF_ITEMID',                label: 'SKU' },
  { key: 'name',     header: 'CF_ITEMNAME',              label: 'ชื่อสินค้า' },
  { key: 'unit',     header: 'CF_UNITNAME',              label: 'หน่วย' },
  // คอลัมน์ H — 1 = หน่วยเล็กสุด, >1 = หน่วยใหญ่ (กล่อง = 10 แผง ฯลฯ)
  // เก็บทุกแถว การกรองเหลือ =1 ทำที่ view v_products_by_category (หน้าเลือกตามหมวด)
  { key: 'baseMultiple', header: 'CF_BASEMULTIPLE',      label: 'ตัวคูณหน่วย' },
  // หมวดอยู่คอลัมน์ Q ไม่ใช่ C — C คือ CF_COMMENTS (โน้ตอิสระ ว่าง 99.5% ของแถว)
  { key: 'category', header: 'CF_ITEMGROUPL1_GROUPNAME', label: 'หมวด' },
] as const;

type ProductCsvKey = typeof PRODUCT_CSV_COLUMNS[number]['key'];

// index → ตัวอักษรคอลัมน์แบบ Excel (0→A, 25→Z, 26→AA) ใช้โชว์ใน confirm ให้ตรวจง่าย
function colLetter(idx: number): string {
  let s = '';
  for (let n = idx; n >= 0; n = Math.floor(n / 26) - 1) {
    s = String.fromCharCode(65 + (n % 26)) + s;
  }
  return s;
}

// ค้น index ของทุกคอลัมน์ที่ต้องใช้จากแถวหัว — ขาดตัวไหน throw ทันทีก่อนแตะ DB
function resolveProductCsvColumns(headerRow: string[]): Record<ProductCsvKey, number> {
  const head = headerRow.map(h => String(h ?? '').trim().toUpperCase());
  const idx = {} as Record<ProductCsvKey, number>;
  const missing: string[] = [];

  for (const col of PRODUCT_CSV_COLUMNS) {
    const i = head.indexOf(col.header);
    if (i < 0) missing.push(`${col.header} (${col.label})`);
    else idx[col.key] = i;
  }

  if (missing.length > 0) {
    const found = head.filter(Boolean).slice(0, 8).join(', ');
    throw new Error(
      `ไฟล์นี้ไม่ใช่รายงาน R05.106\n\n` +
      `ไม่พบคอลัมน์: ${missing.join(', ')}\n\n` +
      `หัวคอลัมน์ที่เจอ: ${found}${head.filter(Boolean).length > 8 ? ' ...' : ''}\n\n` +
      `→ ยังไม่ได้ลบข้อมูลเดิม`
    );
  }
  return idx;
}

interface CategoryRow { sku: string; category_no: number; category_name: string; location: string | null }
interface LocationParseResult {
  rows: CategoryRow[];
  skipped: number;
  conflicts: string[];
  skuHeader: string;
  catHeader: string;
  usedFallback: boolean;
}

// อ่านชีท Location จากไฟล์ .xlsx → SKU + เลขหมวด 1-9
// ตำแหน่งคอลัมน์ต่างกันระหว่างไฟล์ (SSS: SKU=D, WH: SKU=A) แต่ชื่อหัวคอลัมน์เหมือนกัน
// → หาโดยชื่อหัวคอลัมน์เสมอ (หมวด fallback เป็นคอลัมน์ F ตามที่ผู้ใช้ระบุ)
function parseLocationSheet(ws: XLSX.WorkSheet): LocationParseResult {
  // header:1 (array-of-arrays) ไม่ใช่ object mode เพราะ (ก) ต้องรู้ตำแหน่งคอลัมน์เพื่อทำ fallback index 5
  // (ข) Location-WH มี CF_UNITNAME ซ้ำ 2 คอลัมน์ object mode จะเปลี่ยนชื่อตัวที่สองเงียบ ๆ
  // raw:false → ใช้ค่าที่แสดงผล กัน SKU ที่เป็น text ถูกแปลงเป็นตัวเลข
  const aoa = XLSX.utils.sheet_to_json<unknown[]>(ws, {
    header: 1, defval: '', blankrows: false, raw: false,
  });
  if (aoa.length < 2) throw new Error('ไฟล์ไม่มีข้อมูล');

  const head = (aoa[0] as unknown[]).map(h => String(h ?? '').trim().toUpperCase());

  let skuIdx = head.indexOf('CF_ITEMID');
  if (skuIdx < 0) skuIdx = head.findIndex(h => /^CF[_ ]?ITEM[_ ]?ID$/.test(h));
  if (skuIdx < 0) {
    throw new Error(`ไม่พบคอลัมน์ CF_ITEMID (หัวคอลัมน์ที่เจอ: ${head.slice(0, 10).join(', ')})`);
  }

  let catIdx = head.indexOf('CF_ITEMGROUPL1_GROUPNAME');
  let usedFallback = false;
  if (catIdx < 0) catIdx = head.findIndex(h => h.includes('GROUPL1'));
  if (catIdx < 0) { catIdx = 5; usedFallback = true; }   // คอลัมน์ F

  // ตำแหน่งชั้นวาง — คอลัมน์ A ในไฟล์สาขา (SSS/SRC) แต่คอลัมน์ E ในไฟล์ WH
  // จึงหาโดยชื่อหัวคอลัมน์เหมือนกัน · ไม่บังคับ ถ้าไม่มีก็ปล่อยว่าง ไม่ throw
  const locIdx = head.indexOf('LOCATION');

  const map = new Map<string, CategoryRow>();
  const conflicts = new Set<string>();
  let skipped = 0;

  for (let i = 1; i < aoa.length; i++) {
    const r = aoa[i] as unknown[];
    let sku = String(r[skuIdx] ?? '').trim();
    const rawCat = String(r[catIdx] ?? '').trim();
    if (!sku || !rawCat) { skipped++; continue; }

    // กัน xlsx ตัด 0 นำหน้าเมื่อ cell เป็นตัวเลข (products ใช้ SKU 6 หลัก)
    if (/^\d{1,5}$/.test(sku)) sku = sku.padStart(6, '0');

    // regex เดียวคัดออกครบ: 'DELETE', 'อุปกรณ์สำนักงาน / ค่าใช้จ่าย / ขนส่ง', ค่าว่าง
    const m = CAT_PREFIX_RE.exec(rawCat);
    if (!m) { skipped++; continue; }
    const no = parseInt(m[1], 10);
    if (!(no >= 1 && no <= 9)) { skipped++; continue; }   // ตัด '12. ของใช้ประจำภายในร้าน'

    // ไฟล์ WH ใช้ '-' แทนค่าว่าง — ตัดทิ้งไม่ให้ไปโผล่บนป้าย
    const rawLoc = locIdx >= 0 ? String(r[locIdx] ?? '').trim() : '';
    const loc = rawLoc && rawLoc !== '-' ? rawLoc : null;

    const prev = map.get(sku);
    if (prev) { if (prev.category_no !== no) conflicts.add(sku); continue; }  // เก็บค่าแรก
    map.set(sku, { sku, category_no: no, category_name: rawCat, location: loc });
  }

  return {
    rows: [...map.values()],
    skipped,
    conflicts: [...conflicts],
    skuHeader: head[skuIdx] ?? `col ${skuIdx}`,
    catHeader: head[catIdx] ?? `col ${catIdx}`,
    usedFallback,
  };
}

// Sheet/Grid ค่าตายตัว — ห้ามแก้ไขโดยไม่ได้รับอนุญาต
const FIXED_THERMAL: Pick<ThermalSettings, 'sheetW'|'sheetH'|'cols'|'rows'|'gapX'|'gapY'|'offsetTop'|'offsetLeft'> = {
  sheetW: 90, sheetH: 62,
  cols: 4, rows: 5,
  gapX: 2, gapY: 2,
  offsetTop: 0, offsetLeft: 1,
};

const THERMAL_SETTINGS_VERSION = 2;

function loadThermalSettings(): ThermalSettings {
  try {
    const s = localStorage.getItem('thermalSettings');
    const saved = s ? JSON.parse(s) : {};
    if (saved.version !== THERMAL_SETTINGS_VERSION) {
      return { ...DEFAULT_THERMAL_SETTINGS, ...FIXED_THERMAL };
    }
    return {
      ...DEFAULT_THERMAL_SETTINGS,
      ...FIXED_THERMAL,
      qrSize: saved.qrSize ?? DEFAULT_THERMAL_SETTINGS.qrSize,
      fontSize: saved.fontSize ?? DEFAULT_THERMAL_SETTINGS.fontSize,
      skuSize: saved.skuSize ?? DEFAULT_THERMAL_SETTINGS.skuSize,
    };
  } catch { return DEFAULT_THERMAL_SETTINGS; }
}

interface QrSettings {
  sheetW: number;      // mm
  sheetH: number;      // mm
  cols: number;
  rows: number;
  offsetTop: number;   // mm
  offsetLeft: number;  // mm
  qrSize: number;      // mm
  fontSize: number;    // pt
  skuSize: number;     // pt
}

const DEFAULT_QR_SETTINGS: QrSettings = {
  sheetW: 90, sheetH: 60,
  cols: 4, rows: 6,
  offsetTop: 0, offsetLeft: 0,
  qrSize: 8,
  fontSize: 3.5, skuSize: 3,
};

function loadQrSettings(): QrSettings {
  try {
    const s = localStorage.getItem('qrSettings');
    if (!s) return DEFAULT_QR_SETTINGS;
    const saved = JSON.parse(s) as Partial<QrSettings>;
    return { ...DEFAULT_QR_SETTINGS, ...saved };
  } catch { return DEFAULT_QR_SETTINGS; }
}


function loadCartFromStorage(): Map<string, SelectedProduct> {
  try {
    const s = localStorage.getItem('cartItems');
    if (!s) return new Map();
    const entries: [string, SelectedProduct][] = JSON.parse(s);
    return new Map(entries);
  } catch { return new Map(); }
}

function loadHistoryFromStorage(): Map<string, Product> {
  try {
    const s = localStorage.getItem('scannedHistory');
    if (!s) return new Map();
    const entries: [string, Product][] = JSON.parse(s);
    return new Map(entries);
  } catch { return new Map(); }
}

const App: React.FC = () => {
  const [selectedProducts, setSelectedProducts] = useState<Map<string, SelectedProduct>>(loadCartFromStorage);
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [scannedHistory, setScannedHistory] = useState<Map<string, Product>>(loadHistoryFromStorage);
  const [showPreview, setShowPreview] = useState(false);
  const [previewQrSrc, setPreviewQrSrc] = useState<string>('');
  const [isLoading, setIsLoading] = useState(false);
  const [showQrSettings, setShowQrSettings] = useState(false);
  const [qrSettings, setQrSettings] = useState<QrSettings>(loadQrSettings);

  const [thermalSettings, setThermalSettings] = useState<ThermalSettings>(loadThermalSettings);
  const [hiddenKeys, setHiddenKeys] = useState<Set<string>>(new Set());
  const [hoveredProduct, setHoveredProduct] = useState<Product | null>(null);
  const [previewPriceProduct, setPreviewPriceProduct] = useState<Product | null>(null);
  const [previewBarcodeProduct, setPreviewBarcodeProduct] = useState<Product | null>(null);
  const [printSingle, setPrintSingle] = useState<SelectedProduct | null>(null);
  const [isAdmin, setIsAdmin] = useState(false);
  const [adminPassword, setAdminPassword] = useState('');
  const [adminVerified, setAdminVerified] = useState(false);
  const [uploadStatus, setUploadStatus] = useState('');
  const [lastUpdated, setLastUpdated] = useState<string>('');
  const [showCart, setShowCart] = useState(false);
  const [rowQty, setRowQty] = useState<Map<string, number>>(new Map());
  const fileInputRef = useRef<HTMLInputElement>(null);
  const lastAutoAddedBarcode = useRef<string>('');

  // ── เลือกตามหมวด ──
  const [showCategoryMenu, setShowCategoryMenu] = useState(false);
  const [showLocationMenu, setShowLocationMenu] = useState(false);
  // เลือกได้ทีละอย่าง — หมวด หรือ location ใช้ตาราง/loader/สถานะชุดเดียวกัน
  const [activeSel, setActiveSel] = useState<CatSelection | null>(null);
  const activeCategory = activeSel?.kind === 'category' ? activeSel.no : null;
  const activeLocGroup = activeSel?.kind === 'locGroup' ? activeSel.prefix : null;
  const [categoryProducts, setCategoryProducts] = useState<Product[]>([]);
  // รหัสชั้นวางทั้งหมดของสาขา (โหลดครั้งเดียว) — ยุบเป็นกลุ่มตัวอักษรใน locationGroups
  const [locationOptions, setLocationOptions] = useState<string[] | null>(null);
  // แยกจาก isLoading เพราะ search effect เรียก setIsLoading(false) ตอน early-return
  // ซึ่งจะยิงตอน loadCategory เคลียร์ searchTerm แล้วฆ่า spinner กลางคัน
  const [categoryLoading, setCategoryLoading] = useState(false);
  const [categoryError, setCategoryError] = useState('');
  // key = `${branch}|${category_no}` — 1 คำขอได้ครบทุกสาขาทุกหมวด (สูงสุด 36 แถว)
  const [categoryCounts, setCategoryCounts] = useState<Record<string, number> | null>(null);
  const categoryReqRef = useRef(0);   // token กัน race เมื่อกดหลายหมวดเร็ว ๆ
  // status แยกจาก uploadStatus ไม่งั้นอัปโหลด Location จะลบผลอัปโหลด CSV สินค้าทิ้ง
  const [locationStatus, setLocationStatus] = useState('');
  const [locationBusy, setLocationBusy] = useState(false);
  const locationFileRef = useRef<HTMLInputElement>(null);
  const [currentPage, setCurrentPage] = useState<PageId>('pricetag');
  const [authProfile, setAuthProfile] = useState<Profile | null>(loadAuthProfile);
  const [saleSupportUnreadCount, setSaleSupportUnreadCount] = useState(0);

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0, behavior: 'auto' });
  }, [currentPage]);

  // แหล่งจุดแดงหน้า SaleSupport — 3 เคส แต่มีแค่ 2 ทรง query
  //  สาขา SRC/KKL/SSS → ตารางเหตุการณ์ (คลัง/จัดซื้อแก้ข้อมูล)
  //  จัดซื้อ          → ตารางเหตุการณ์เดียวกัน ใช้ 'PURCHASING' เป็นค่า branch (= ผู้รับ) — เพิ่ม 2569-08-17
  //  คลังสินค้า       → Order ใหม่ที่ยังไม่เปิด (recipient_department บน ss_orders) — ไม่ย้ายโดยตั้งใจ
  // ⚠️ ต้อง useMemo — ถ้าสร้าง object ใหม่ทุก render effect จะ resubscribe realtime ทุกครั้ง
  const notificationSource = useMemo(() => {
    const branch = authProfile?.branch ?? '';
    if (branch === 'SRC' || branch === 'KKL' || branch === 'SSS') return { kind: 'events', key: branch } as const;
    if (authProfile?.id === 'PURCHASING') return { kind: 'events', key: 'PURCHASING' } as const;
    if (authProfile?.id === 'WAREHOUSE') return { kind: 'orders', key: 'WAREHOUSE' } as const;
    return null;
  }, [authProfile?.branch, authProfile?.id]);

  useEffect(() => {
    if (!notificationSource) {
      setSaleSupportUnreadCount(0);
      return;
    }
    const src = notificationSource;
    let cancelled = false;
    setSaleSupportUnreadCount(0);

    const loadUnread = async () => {
      const { count, error } = src.kind === 'events'
        ? await supabase
            .from('ss_branch_notification_events')
            .select('id', { count: 'exact', head: true })
            .eq('branch', src.key)
            .is('read_at', null)
        : await supabase
            .from('ss_orders')
            .select('id', { count: 'exact', head: true })
            // 'BOTH' ต้องนับด้วย — SKU ที่หาไม่เจอใน Product Master ตอนบันทึก Order จะได้ recipient_department = 'BOTH'
            // (กันออเดอร์ไม่มีใครเห็นเลย) ถ้าใช้ .eq() เฉยๆ แถวพวกนี้จะไม่ขึ้นแจ้งเตือนให้คลังเลย
            .in('recipient_department', [src.key, 'BOTH'])
            .is('recipient_read_at', null);
      if (cancelled || error) return;
      setSaleSupportUnreadCount(count ?? 0);
    };

    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') void loadUnread();
    };
    void loadUnread();
    const notificationChannel = src.kind === 'events'
      ? supabase
          .channel(`ss-branch-notifications-${src.key}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'ss_branch_notifications', filter: `branch=eq.${src.key}` },
            () => { void loadUnread(); },
          )
          .subscribe()
      : supabase
          .channel(`ss-department-orders-${src.key}`)
          .on(
            'postgres_changes',
            // in.() ให้ตรงกับ loadUnread ด้านบน — ต้องรับรู้แถว 'BOTH' ด้วย ไม่ใช่แค่แผนกตัวเอง
            { event: '*', schema: 'public', table: 'ss_orders', filter: `recipient_department=in.(${src.key},BOTH)` },
            () => { void loadUnread(); },
          )
          .subscribe();
    const timer = window.setInterval(loadUnread, 30_000);
    window.addEventListener('focus', loadUnread);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      cancelled = true;
      void supabase.removeChannel(notificationChannel);
      window.clearInterval(timer);
      window.removeEventListener('focus', loadUnread);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [notificationSource]);

  // ── เปิด/ปิดปุ่มแต่ละหน้า (ตั้งค่าโดย admin, ซิงค์ผ่าน Supabase) ──
  const [pageVisibility, setPageVisibility] = useState<PageVisibility>(DEFAULT_VISIBILITY);
  const [showPageSettings, setShowPageSettings] = useState(false);
  const [pageSettingsPw, setPageSettingsPw] = useState('');
  const [pageSettingsVerified, setPageSettingsVerified] = useState(false);
  const [pageSettingsError, setPageSettingsError] = useState(false);

  const handleLogin = (profile: Profile) => {
    saveAuthProfile(profile.id);
    setAuthProfile(profile);
  };
  const handleLogout = () => {
    clearAuthProfile();
    setAuthProfile(null);
  };

  // สาขาของผู้ใช้ที่ล็อกอินอยู่ — ล็อกตายตาม profile เปลี่ยนเองไม่ได้ (กันปริ้นผิดสาขา)
  // null = ไม่สังกัดสาขา (จัดซื้อ) → ซ่อนปุ่ม "เลือกตามหมวด" ทั้งปุ่ม
  const profileBranch = useMemo(() => {
    const b = authProfile?.branch ?? null;
    if (!b) return null;
    // ชื่อสาขาอยู่คนละไฟล์ (auth.ts) กับที่ใช้ query ถ้าสะกดไม่ตรง DB จะได้ 0 แถวเงียบ ๆ ตลอดไป
    if (!(CATEGORY_BRANCHES as readonly string[]).includes(b)) {
      console.error(
        `[เลือกตามหมวด] สาขา "${b}" ของโปรไฟล์ ${authProfile?.id} ไม่ตรงกับ CATEGORY_BRANCHES ` +
        `(${CATEGORY_BRANCHES.join(' / ')}) — ซ่อนปุ่มไว้ก่อน แก้ที่ auth.ts`
      );
      return null;
    }
    return b;
  }, [authProfile?.branch, authProfile?.id]);

  // เปลี่ยนโปรไฟล์ (logout/login คนละคน) → ทิ้งข้อมูลหมวดของสาขาเดิม
  // component ไม่ได้ unmount ตอน logout state จึงค้างอยู่ถ้าไม่ล้าง
  useEffect(() => {
    categoryReqRef.current++;
    setActiveSel(null);
    setCategoryProducts([]);
    setCategoryError('');
    setCategoryLoading(false);
    setShowCategoryMenu(false);
    setShowLocationMenu(false);
    setLocationOptions(null);   // รหัสชั้นวางเป็นของแต่ละสาขา ต้องโหลดใหม่
    // key เป็น sku-unit ซึ่งข้ามสาขาชนกันได้ ไม่ล้างแล้วสินค้าของสาขาใหม่จะถูกซ่อนโดยไม่มีสาเหตุ
    setHiddenKeys(new Set());
    setLocationStatus('');
  }, [authProfile?.id]);

  // โหลดสถานะเปิด/ปิดหน้าจาก Supabase ตอน mount + เด้งออกจากหน้าที่ถูกปิด
  useEffect(() => {
    supabase.from('app_page_settings').select('page_id, visible').then(({ data, error }) => {
      if (error || !data) return;
      const map: PageVisibility = { ...DEFAULT_VISIBILITY };
      data.forEach((r) => { if (r.page_id in map) map[r.page_id as PageId] = !!r.visible; });
      setPageVisibility(map);
      setCurrentPage(cur => (map[cur] ? cur : (PAGE_NAV.find(p => map[p.id])?.id ?? cur)));
    });
  }, []);

  // สลับเปิด/ปิดหน้า (optimistic + บันทึกลง Supabase, revert ถ้าพลาด)
  const togglePageVisible = async (id: PageId) => {
    const next = !pageVisibility[id];
    setPageVisibility(prev => ({ ...prev, [id]: next }));
    const { error } = await supabase
      .from('app_page_settings')
      .upsert({ page_id: id, visible: next, updated_at: new Date().toISOString() });
    if (error) {
      setPageVisibility(prev => ({ ...prev, [id]: !next }));
      alert('บันทึกไม่สำเร็จ: ' + error.message);
    }
  };

  // โหลดวันที่ update ล่าสุดจาก Supabase ตอน mount
  useEffect(() => {
    const fetchLastUpdated = async () => {
      const { data } = await supabase
        .from('products')
        .select('updated_at')
        .order('updated_at', { ascending: false })
        .limit(1);
      if (data && data[0]?.updated_at) {
        const d = new Date(data[0].updated_at);
        setLastUpdated(d.toLocaleString('en-GB', { dateStyle: 'short', timeStyle: 'short' }));
      }
    };
    fetchLastUpdated();
  }, []);

  const saveQrSettings = (s: QrSettings) => {
    setQrSettings(s);
    localStorage.setItem('qrSettings', JSON.stringify(s));
  };

  const saveThermalSettings = (s: ThermalSettings) => {
    const enforced = { ...s, ...FIXED_THERMAL };
    setThermalSettings(enforced);
    localStorage.setItem('thermalSettings', JSON.stringify({ version: THERMAL_SETTINGS_VERSION, qrSize: enforced.qrSize, fontSize: enforced.fontSize, skuSize: enforced.skuSize }));
  };

  // บันทึก cart และ scannedHistory ลง localStorage ทุกครั้งที่เปลี่ยน
  useEffect(() => {
    localStorage.setItem('cartItems', JSON.stringify(Array.from(selectedProducts.entries())));
  }, [selectedProducts]);

  useEffect(() => {
    localStorage.setItem('scannedHistory', JSON.stringify(Array.from(scannedHistory.entries())));
  }, [scannedHistory]);

  // Parse CSV และ push ขึ้น Supabase (Admin only)
  const handleFileUpload = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    setIsLoading(true);
    setUploadStatus('กำลัง parse CSV...');

    Papa.parse(file, {
      skipEmptyLines: true,
      quoteChar: '"',
      complete: async (results) => {
        try {
          const data = results.data as string[][];
          if (data.length < 2) throw new Error('ไฟล์ไม่มีข้อมูล');

          // ── เช็คหัวคอลัมน์ก่อนแตะ DB — ไฟล์ผิดรูปแบบต้องตกตรงนี้ ──
          // (PapaParse ตัด UTF-8 BOM ให้แล้ว head[0] จึงสะอาด)
          const col = resolveProductCsvColumns(data[0]);

          // baseMultiple ไม่อยู่ใน Product (ไม่ได้ใช้แสดงผล) แต่ต้องส่งขึ้น DB
          const parsedProducts: (Product & { baseMultiple: number | null })[] = [];
          for (let i = 1; i < data.length; i++) {
            const row = data[i];
            const barcode = (row[col.barcode] ?? '').trim();
            const sku = (row[col.sku] ?? '').trim();
            if (!barcode || !sku) continue;
            const bm = parseFloat(row[col.baseMultiple]);
            parsedProducts.push({
              barcode,
              sku,
              name: ((row[col.name] ?? '').trim()).split(/[\r\n]/)[0].trim(),
              unit: (row[col.unit] ?? '').trim(),
              price: parseFloat(row[col.price]) || 0,
              category: (row[col.category] ?? '').trim() || 'ทั่วไป',
              baseMultiple: Number.isFinite(bm) ? bm : null,
              rowIndex: i,
            });
          }
          if (parsedProducts.length === 0) throw new Error('ไม่พบแถวที่มีทั้งบาร์โค้ดและ SKU');

          // ── ยืนยันก่อนลบ — โชว์จำนวนเดิมเทียบไฟล์ใหม่ ──
          setUploadStatus('กำลังตรวจข้อมูลเดิม...');
          const { count: existing } = await supabase
            .from('products')
            .select('id', { count: 'exact', head: true });

          const shrink = existing && existing > 0 ? 1 - parsedProducts.length / existing : 0;
          const shrinkWarn = shrink > 0.2
            ? `\n\n🚨 ไฟล์นี้น้อยกว่าข้อมูลเดิม ${Math.round(shrink * 100)}% — ถ้า export มาไม่ครบ ข้อมูลที่หายจะถูกลบ\nไม่แน่ใจให้กด Cancel แล้ว export ใหม่`
            : '';

          const mapping = PRODUCT_CSV_COLUMNS
            .map(c => `${c.label}=${colLetter(col[c.key])}`)
            .join(' · ');

          const baseUnits = parsedProducts.filter(p => p.baseMultiple === 1).length;

          const ok = window.confirm(
            `ไฟล์: ${file.name}\n` +
            `✅ ตรวจหัวคอลัมน์ผ่าน (R05.106)\n` +
            `   ${mapping}\n\n` +
            `   เดิมมี ${(existing ?? 0).toLocaleString()} รายการ → ไฟล์ใหม่ ${parsedProducts.length.toLocaleString()} รายการ\n` +
            `   ในนั้นเป็นหน่วยเล็กสุด ${baseUnits.toLocaleString()} รายการ (หน้าเลือกตามหมวดจะเห็นเท่านี้)\n\n` +
            `⚠️ จะลบข้อมูลเดิมทั้งหมดแล้วใส่ใหม่` +
            shrinkWarn
          );
          if (!ok) { setUploadStatus(''); return; }

          setUploadStatus(`กำลังอัปโหลด ${parsedProducts.length.toLocaleString()} รายการ...`);

          // ลบข้อมูลเก่าและใส่ใหม่
          const { error: delError } = await supabase.from('products').delete().neq('id', 0);
          if (delError) throw new Error(delError.message);

          const rows = parsedProducts.map(p => ({ barcode: p.barcode, sku: p.sku, name: p.name, unit: p.unit, price: p.price, category: p.category, base_multiple: p.baseMultiple }));
          const CHUNK = 500;
          for (let i = 0; i < rows.length; i += CHUNK) {
            setUploadStatus(`กำลังอัปโหลด ${Math.min(i + CHUNK, rows.length).toLocaleString()}/${rows.length.toLocaleString()} รายการ...`);
            const { error } = await supabase.from('products').insert(rows.slice(i, i + CHUNK));
            if (error) throw new Error(error.message);
          }

          setUploadStatus(`✅ อัปโหลดสำเร็จ ${parsedProducts.length.toLocaleString()} รายการ`);
        } catch (e) {
          setUploadStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          setIsLoading(false);
          // reset เสมอ — ของเดิม reset เฉพาะตอนสำเร็จ ทำให้เลือกไฟล์เดิมซ้ำหลัง error ไม่ทำงาน
          if (event.target) event.target.value = '';
        }
      },
      error: (error) => {
        console.error('Error parsing CSV:', error);
        setUploadStatus('❌ อ่านไฟล์ไม่สำเร็จ: ' + error.message);
        setIsLoading(false);
        if (event.target) event.target.value = '';
      }
    });
  };

  // อัปโหลดไฟล์ Location (.xlsx) → ตาราง product_category
  // "แทนที่ทั้งสาขา": upsert ทุกแถวด้วย uploaded_at ชุดเดียว แล้วลบแถวของสาขานี้ที่ timestamp เก่ากว่า
  // (= ไม่มีในไฟล์รอบนี้ เช่นถูกย้ายไปหมวด DELETE หรือเลิกขาย) — สาขาอื่นไม่กระทบ
  const handleLocationUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;
    setLocationBusy(true);
    setLocationStatus('กำลังอ่านไฟล์ Location...');
    try {
      const wb = XLSX.read(await file.arrayBuffer());
      // ต้องอ่านชีทแรกเท่านั้น — ชีท 2 (R5.106) คอลัมน์คนละตำแหน่ง
      const sheetName = wb.SheetNames.find(n => n.trim().toLowerCase() === 'location') ?? wb.SheetNames[0];
      const ws = wb.Sheets[sheetName];
      if (!ws) throw new Error('ไม่พบชีทข้อมูลในไฟล์');

      const { rows, skipped, conflicts, skuHeader, catHeader, usedFallback } = parseLocationSheet(ws);
      if (rows.length === 0) throw new Error('ไม่พบแถวที่มีหมวด 1-9');

      // สาขาที่บันทึก = สาขาของโปรไฟล์ที่ล็อกอิน เปลี่ยนเองไม่ได้
      const branch = profileBranch;
      if (!branch) throw new Error('โปรไฟล์นี้ไม่สังกัดสาขา อัปโหลดไม่ได้');
      const guessed = guessBranchFromFileName(file.name);
      const mismatch = guessed && guessed !== branch
        ? `\n\n⚠️ ชื่อไฟล์ดูเหมือนของสาขา "${guessed}" แต่คุณล็อกอินเป็น "${branch}"\nถ้าไฟล์ผิด กด Cancel แล้วเลือกไฟล์ของสาขา ${branch}`
        : '';

      // จำนวนที่มีอยู่เดิม — ให้ผู้ใช้เทียบก่อนตัดสินใจ กันเผลออัปโหลดไฟล์ที่ export มาไม่ครบ
      setLocationStatus('กำลังตรวจข้อมูลเดิม...');
      const { count: existing } = await supabase
        .from('product_category')
        .select('sku', { count: 'exact', head: true })
        .eq('branch', branch);

      // ไฟล์เล็กลงผิดปกติ = สัญญาณว่า export มาไม่ครบ
      const shrink = existing && existing > 0 ? 1 - rows.length / existing : 0;
      const shrinkWarn = shrink > 0.2
        ? `\n\n🚨 ไฟล์นี้น้อยกว่าข้อมูลเดิม ${Math.round(shrink * 100)}% — ถ้า export มาไม่ครบ ข้อมูลที่หายจะถูกลบ\nไม่แน่ใจให้กด Cancel แล้ว export ใหม่`
        : '';

      const ok = window.confirm(
        `ไฟล์: ${file.name}\nชีท: ${sheetName}\n` +
        `คอลัมน์ SKU: ${skuHeader} · คอลัมน์หมวด: ${catHeader}${usedFallback ? ' (ใช้คอลัมน์ F)' : ''}\n\n` +
        `▶ บันทึกลงสาขา: ${branch}\n` +
        `   เดิมมี ${(existing ?? 0).toLocaleString()} SKU → ไฟล์ใหม่ ${rows.length.toLocaleString()} SKU\n\n` +
        `ข้าม ${skipped.toLocaleString()} แถว (DELETE / ว่าง / นอกหมวด 1-9)` +
        (conflicts.length ? `\n⚠️ SKU ซ้ำคนละหมวด ${conflicts.length} รายการ (จะใช้ค่าแรก)` : '') +
        `\n\n⚠️ แทนที่ทั้งสาขา ${branch}: SKU ที่ไม่มีในไฟล์นี้จะถูกลบออก (สาขาอื่นไม่กระทบ)` +
        shrinkWarn +
        mismatch
      );
      if (!ok) { setLocationStatus(''); return; }

      const CHUNK = 500;
      const uploadedAt = new Date().toISOString();
      const payload = rows.map(r => ({ ...r, branch, uploaded_at: uploadedAt }));
      for (let i = 0; i < payload.length; i += CHUNK) {
        setLocationStatus(`กำลังบันทึก ${Math.min(i + CHUNK, payload.length).toLocaleString()}/${payload.length.toLocaleString()} รายการ...`);
        const { error } = await supabase
          .from('product_category')
          .upsert(payload.slice(i, i + CHUNK), { onConflict: 'sku,branch' });
        if (error) {
          if (error.code === '42P01' || error.code === 'PGRST205' || error.code === '42703') {
            throw new Error('schema ไม่ตรง — รัน product-category-setup.sql ใน Supabase ก่อน (เวอร์ชันล่าสุดเพิ่มคอลัมน์ location)');
          }
          throw new Error(error.message);
        }
      }

      // sweep: ลบแถวของสาขานี้ที่ไม่ได้ถูกแตะในรอบนี้ (uploaded_at เก่ากว่า timestamp ชุดนี้)
      // ⚠️ ต้องอยู่หลัง loop upsert — ถ้า chunk ไหน error จะ throw ออกไปก่อนถึงบรรทัดนี้
      //    จึงไม่มีทางลบข้อมูลทิ้งตอนที่ upsert ยังไม่ครบ
      setLocationStatus('กำลังลบรายการที่ไม่มีในไฟล์...');
      const { count: removed, error: pruneErr } = await supabase
        .from('product_category')
        .delete({ count: 'exact' })
        .eq('branch', branch)
        .lt('uploaded_at', uploadedAt);
      if (pruneErr) throw new Error(`ลบรายการเก่าไม่สำเร็จ: ${pruneErr.message}`);

      setLocationStatus(
        `✅ ${branch}: ${rows.length.toLocaleString()} SKU` +
        (removed ? ` · ลบที่ไม่มีในไฟล์ ${removed.toLocaleString()}` : '') +
        ` · ข้าม ${skipped.toLocaleString()} แถว` +
        (conflicts.length ? ` · ⚠️ ซ้ำคนละหมวด ${conflicts.length}` : '')
      );
      setCategoryCounts(null);              // ล้าง cache badge
      setLocationOptions(null);             // รหัสชั้นวางอาจเปลี่ยนจากไฟล์ใหม่
      if (activeSel) loadSelection(activeSel, branch);   // reload สิ่งที่เปิดค้างอยู่
    } catch (e) {
      setLocationStatus(`❌ ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLocationBusy(false);
      // reset ใน finally เสมอ — ไม่ใช่เฉพาะตอนสำเร็จ ไม่งั้นเลือกไฟล์เดิมซ้ำหลัง error ไม่ทำงาน
      if (event.target) event.target.value = '';
    }
  };

  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);

  // Handle search input change
  const handleSearchChange = (value: string) => {
    // พิมพ์อะไรก็ตาม (รวมถึงลบจนว่าง) = ออกจากโหมดหมวด
    // กันสถานะซ่อนเร้นแบบ "ช่องค้นหาว่างแต่ยังอยู่ในหมวด"
    if (activeSel !== null) exitCategory();
    setSearchInput(value);
    const trimmed = value.trim();
    
    // Check if it's a numeric search (SKU or barcode)
    const isNumeric = /^\d+$/.test(trimmed);
    
    if (isNumeric) {
      // Numeric: auto-search when >= 6 digits
      if (trimmed.length >= 6) {
        setSearchTerm(trimmed);
      } else {
        // Less than 6 digits: clear results, wait
        setSearchTerm('');
        setFilteredProducts([]);
      }
    } else {
      // Non-numeric (name search): auto-search with debounce
      setSearchTerm(trimmed);
    }
  };

  // Handle Enter key for manual search trigger
  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      const trimmed = searchInput.trim();
      if (trimmed) {
        setSearchTerm(trimmed);
      }
    }
  };

  useEffect(() => {
    const search = searchTerm.trim();
    lastAutoAddedBarcode.current = '';
    setHiddenKeys(new Set());
    if (!search) {
      setFilteredProducts([]);
      setIsLoading(false);
      return;
    }
    const controller = new AbortController();
    const doSearch = async () => {
      setIsLoading(true);

      // Check if search is SKU (all digits, exactly 6)
      const isSkuSearch = /^\d{6}$/.test(search);

      // Build search query
      let query = supabase.from('products').select('*');

      if (isSkuSearch) {
        // เลข 6 หลักเป็นได้ทั้ง SKU และ barcode — ค้นทั้งสองคอลัมน์แบบตรงตัว
        // ⚠️ ห้ามกลับไปใช้ `.eq('sku', …)` อย่างเดียว: ในตารางมี barcode 6 หลัก 1,308 แถว
        //    ซึ่ง 159 แถวไม่ตรงกับ sku ของตัวเอง (เช่น barcode 109331 = sku 100056)
        //    ถ้าค้นแค่ sku เลขพวกนี้จะหาไม่เจอเลยทั้งที่มีสินค้าอยู่จริง
        const { data, error } = await query.or(`sku.eq.${search},barcode.eq.${search}`).limit(30);
        if (!controller.signal.aborted) {
          if (error) {
            console.error('Supabase search error:', error);
          } else if (data) {
            setFilteredProducts(data.map((row, i) => ({
              barcode: row.barcode || '',
              sku: row.sku || '',
              name: row.name || '',
              unit: row.unit || '',
              price: row.price || 0,
              category: row.category || 'ทั่วไป',
              rowIndex: i,
            })));
          }
          setIsLoading(false);
        }
        return;
      }

      // Non-SKU search: search name and barcode
      const { data, error } = await query.or(`name.ilike.%${search}%,barcode.ilike.%${search}%`).limit(30);
      if (!controller.signal.aborted) {
        if (error) {
          console.error('Supabase search error:', error);
        } else if (data) {
          setFilteredProducts(data.map((row, i) => ({
            barcode: row.barcode || '',
            sku: row.sku || '',
            name: row.name || '',
            unit: row.unit || '',
            price: row.price || 0,
            category: row.category || 'ทั่วไป',
            rowIndex: i,
          })));
        }
        setIsLoading(false);
      }
    };
    const timer = setTimeout(doSearch, 150);
    return () => { clearTimeout(timer); controller.abort(); };
  }, [searchTerm]);

  // จัดรหัสชั้นวางเป็นกลุ่มตามตัวอักษร — 488 รหัสของ SRC ยุบเหลือ 27 ปุ่ม
  const locationGroups = useMemo(() => {
    if (!locationOptions) return null;
    const g = new Map<string, string[]>();
    for (const v of locationOptions) {
      const k = locationGroupOf(v);
      const arr = g.get(k);
      if (arr) arr.push(v); else g.set(k, [v]);
    }
    return [...g.entries()]
      .map(([prefix, locs]) => ({ prefix, locs }))
      .sort((a, b) => compareLocation(a.prefix, b.prefix));
  }, [locationOptions]);

  // ลำดับความสำคัญ: category > search > scan
  const visibleProducts = useMemo(() => {
    const strip = (list: Product[]) =>
      list.filter((p: Product) => !hiddenKeys.has(`${p.sku}-${p.unit}`))
          .map((p: Product, i: number) => ({ ...p, rowIndex: i }));

    // โหมดเลือก (หมวด หรือ กลุ่มชั้นวาง) — categoryProducts dedupe sku-unit มาแล้วตอน fetch
    // ⚠️ ต้องเช็ค activeSel ไม่ใช่ activeCategory ไม่งั้นโหมด location จะตกไป branch search แล้วว่างเปล่า
    if (activeSel !== null) return strip(categoryProducts);

    //  search term  show only filteredProducts
    if (searchTerm.trim()) return strip(filteredProducts);

    // No search term: show scannedHistory (scan mode)
    const map = new Map<string, Product>();
    for (const p of scannedHistory.values()) {
      const key = `${p.sku}-${p.unit}`;
      if (!hiddenKeys.has(key)) map.set(key, p);
    }
    return Array.from(map.values()).map((p, i) => ({ ...p, rowIndex: i }));
  }, [activeSel, categoryProducts, filteredProducts, hiddenKeys, scannedHistory, searchTerm]);

  // Auto-add เมื่อค้นหาด้วย barcode ตรง (เช่น สแกนเนอร์)
  useEffect(() => {
    const search = searchTerm.trim();
    if (!search || filteredProducts.length === 0) return;
    // ⚠️ ได้หลายแถว = คำค้นกำกวม ห้าม auto-add เด็ดขาด
    //    สินค้า 647 SKU ใช้เลข SKU เป็น barcode ของหน่วยเล็ก (ไม่มี EAN จริง)
    //    พิมพ์ "100074" จึงตรงทั้ง sku (แผง + กล่อง) และ barcode (แผง)
    //    ของเดิม auto-add แถวแผงแล้ว setSearchTerm('') ทำให้ตารางตกไปโหมด scan
    //    เหลือโชว์แถวเดียว — แถวกล่องหายไปทั้งที่ผู้ใช้อาจอยากปริ้นป้ายกล่อง
    //    ตอนนี้ปล่อยให้แสดงครบทุกหน่วยแล้วให้ผู้ใช้กด 🛒 เลือกเองว่าจะเอาอันไหน
    if (filteredProducts.length > 1) return;
    const exact = filteredProducts.find(p => p.barcode === search);
    if (!exact) return;
    if (lastAutoAddedBarcode.current === search) return;
    lastAutoAddedBarcode.current = search;
    handleAddToCart(exact, rowQty.get(`${exact.sku}-${exact.unit}`) ?? 1);
    setScannedHistory(prev => {
      const next = new Map(prev);
      next.set(`${exact.sku}-${exact.unit}`, exact);
      return next;
    });
    setSearchInput('');
    setSearchTerm('');
  }, [filteredProducts]);

  // Sync pulse animation ทุกปุ่ม 🛒 ให้กระพริบพร้อมกัน (global toggle)
  useEffect(() => {
    document.body.classList.add('pulse-a');
    const interval = setInterval(() => {
      document.body.classList.toggle('pulse-a');
      document.body.classList.toggle('pulse-b');
    }, 700);
    return () => {
      clearInterval(interval);
      document.body.classList.remove('pulse-a', 'pulse-b');
    };
  }, []);


  // เพิ่มสินค้าเข้าตะกร้าพร้อมจำนวนที่กำหนด (ใช้กับปุ่ม 🛒 ในตาราง)
  const handleAddToCart = useCallback((product: Product, qty: number) => {
    const key = `${product.sku}-${product.unit}`;
    setSelectedProducts(prev => {
      const next = new Map(prev);
      next.set(key, { ...product, quantity: qty });
      return next;
    });
  }, []);

  // batch เป็น setState เดียว — ของเดิมเรียก handleAddToCart ใน loop ทำให้ new Map(prev)
  // ซ้ำทุกรอบ (O(n²)) ที่ 1,300 รายการ ≈ 850k inserts
  const handleSelectAll = useCallback(() => {
    const items = visibleProducts;
    if (items.length === 0) return;
    if (items.length > 200 && !window.confirm(
      `จะเพิ่มสินค้า ${items.length.toLocaleString()} รายการเข้าตะกร้า — อาจใช้เวลาสักครู่\nยืนยันหรือไม่?`
    )) return;
    setSelectedProducts(prev => {
      const next = new Map(prev);
      for (const p of items) {
        const key = `${p.sku}-${p.unit}`;
        next.set(key, { ...p, quantity: rowQty.get(key) ?? 1 });
      }
      return next;
    });
  }, [visibleProducts, rowQty]);

  // ── เลือกตามหมวด / ตาม Location: ใช้ view v_products_by_category ตัวเดียวกัน ──
  // ต่างกันแค่เงื่อนไข filter ที่เหลือ (dedupe, pagination, race token, error) ใช้ร่วมกันหมด
  const exitCategory = useCallback(() => {
    categoryReqRef.current++;          // ยกเลิกคำขอที่ค้างอยู่
    setActiveSel(null);
    setCategoryProducts([]);
    setCategoryError('');
    setCategoryLoading(false);
    setShowCategoryMenu(false);
    setShowLocationMenu(false);
    setHiddenKeys(new Set());
  }, []);

  const loadSelection = useCallback(async (sel: CatSelection, branch: string) => {
    const token = ++categoryReqRef.current;
    setShowCategoryMenu(false);
    setShowLocationMenu(false);
    setShowCart(false);
    setActiveSel(sel);
    setCategoryProducts([]);
    setCategoryError('');
    setCategoryLoading(true);
    setHiddenKeys(new Set());
    setSearchInput('');
    setSearchTerm('');

    const PAGE = 1000;                 // Supabase db-max-rows default
    const acc: Product[] = [];
    const seen = new Set<string>();    // dedupe sku-unit — products มีคู่ซ้ำ 80 คู่
    try {
      for (let from = 0; ; from += PAGE) {
        let q = supabase
          .from('v_products_by_category')
          .select('barcode, sku, name, unit, price, category_name, location')
          .eq('branch', branch);
        q = sel.kind === 'category' ? q.eq('category_no', sel.no) : q.in('location', sel.locs);
        const { data, error } = await q
          .order('sku', { ascending: true })
          .order('unit', { ascending: true })
          .order('barcode', { ascending: true })
          .range(from, from + PAGE - 1);
        if (error) throw error;
        if (token !== categoryReqRef.current) return;   // มีคำขอใหม่แล้ว ทิ้งผลนี้
        if (!data || data.length === 0) break;
        for (const row of data) {
          const key = `${row.sku ?? ''}-${row.unit ?? ''}`;
          if (seen.has(key)) continue;
          seen.add(key);
          acc.push({
            barcode: row.barcode || '',
            sku: row.sku || '',
            name: row.name || '',
            unit: row.unit || '',
            price: row.price || 0,
            category: row.category_name || 'ทั่วไป',
            location: row.location || undefined,
            rowIndex: acc.length,
          });
        }
        if (data.length < PAGE) break;
      }
      if (token !== categoryReqRef.current) return;
      setCategoryProducts(acc);
    } catch (e) {
      if (token !== categoryReqRef.current) return;
      const code = (e as { code?: string })?.code;
      setCategoryError(
        code === 'PGRST205' || code === '42P01' || code === '42703'
          ? 'schema ไม่ตรง — รัน product-category-setup.sql ใน Supabase ก่อน'
          : (e instanceof Error ? e.message : String(e))
      );
      setActiveSel(null);
    } finally {
      if (token === categoryReqRef.current) setCategoryLoading(false);
    }
  }, []);

  // รหัสชั้นวางทั้งหมดของสาขา — ยิงตอนเปิด dropdown, cache ทั้ง session
  // PostgREST ไม่มี DISTINCT เลยต้องวนอ่านทีละ 1000 (ดึงคอลัมน์เดียว payload เล็ก)
  const ensureLocationOptions = useCallback(async (branch: string) => {
    if (locationOptions) return;
    const found = new Set<string>();
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase
        .from('product_category')
        .select('location')
        .eq('branch', branch)
        .range(from, from + 999);
      if (error || !data) return;      // โหลดไม่ได้ก็ไม่ต้องโชว์รายการ
      for (const r of data) {
        const v = String(r.location ?? '').trim();
        if (v) found.add(v);
      }
      if (data.length < 1000) break;
    }
    setLocationOptions([...found].sort(compareLocation));
  }, [locationOptions]);

  // นับจำนวนต่อสาขา+หมวด — ยิงตอนเปิด dropdown ไม่ใช่ตอน mount, cache ทั้ง session
  const ensureCategoryCounts = useCallback(async () => {
    if (categoryCounts) return;
    const { data, error } = await supabase.from('v_product_category_counts').select('*');
    if (error || !data) return;        // badge หายไปเฉย ๆ ไม่ต้องรบกวนผู้ใช้
    setCategoryCounts(Object.fromEntries(
      data.map(r => [`${r.branch}|${r.category_no}`, r.product_rows])
    ));
  }, [categoryCounts]);

  // Update quantity ใน cart dropdown
  const updateQuantity = (key: string, delta: number) => {
    setSelectedProducts(prev => {
      const product = prev.get(key);
      if (!product) return prev;
      const newQty = product.quantity + delta;
      if (newQty <= 0) {
        const next = new Map(prev);
        next.delete(key);
        return next;
      }
      const next = new Map(prev);
      next.set(key, { ...product, quantity: newQty });
      return next;
    });
  };

  // Remove product
  const removeProduct = (key: string) => {
    setSelectedProducts(prev => {
      const next = new Map(prev);
      next.delete(key);
      return next;
    });
    setHiddenKeys(prev => new Set(prev).add(key));
  };

  // Clear all
  // ล้างเฉพาะตะกร้า ไม่กระทบ search
  const clearCart = () => {
    setSelectedProducts(new Map());
    localStorage.removeItem('cartItems');
  };

  //  clearAll: cart + search + hidden + category
  const clearAll = () => {
    setSelectedProducts(new Map());
    setHiddenKeys(new Set());
    setSearchInput('');
    setSearchTerm('');
    setScannedHistory(new Map());
    categoryReqRef.current++;
    setActiveSel(null);
    setCategoryProducts([]);
    setCategoryError('');
    setCategoryLoading(false);
    setShowCategoryMenu(false);
    setShowLocationMenu(false);
    localStorage.removeItem('cartItems');
    localStorage.removeItem('scannedHistory');
  };


const generateQR = useCallback(async (barcode: string): Promise<string> => {
    try {
      return await QRCode.toDataURL(barcode, { margin: 0, width: 150 });
    } catch {
      return '';
    }
  }, []);

  const handlePrintQr = useCallback(async (s: QrSettings) => {
    const map = new Map<string, string>();
    for (const product of selectedProducts.values()) {
      if (product.barcode && !map.has(product.barcode)) {
        map.set(product.barcode, await generateQR(product.barcode));
      }
    }

    const allStickers = Array.from(selectedProducts.values()).flatMap(product =>
      Array.from({ length: product.quantity }, () => ({
        name: product.name, sku: product.sku, barcode: product.barcode, unit: product.unit,
        qrSrc: map.get(product.barcode) || ''
      }))
    );

    const perSheet = s.cols * s.rows;
    const cellW = (s.sheetW / s.cols).toFixed(3);
    const cellH = (s.sheetH / s.rows).toFixed(3);
    const sheets: typeof allStickers[] = [];
    for (let i = 0; i < allStickers.length; i += perSheet) sheets.push(allStickers.slice(i, i + perSheet));

    const sheetsHtml = sheets.map((sheet, idx) => `
      <div class="qr-sheet${idx < sheets.length - 1 ? ' break' : ''}">
        ${sheet.map(st => `
          <div class="qr-sticker">
            <img src="${st.qrSrc}" class="qr-img" />
            <div class="qr-info">
              <div class="qr-name">${st.name}</div>
              <div class="qr-sku">${st.sku}</div>
            </div>
          </div>`).join('')}
      </div>`).join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>QR Sticker</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: ${s.sheetW}mm ${s.sheetH}mm; margin: 0; }
  body { font-family: 'Sarabun', sans-serif; padding-top: ${s.offsetTop}mm; padding-left: ${s.offsetLeft}mm; }
  .qr-sheet { width: ${s.sheetW}mm; height: ${s.sheetH}mm; display: grid;
    grid-template-columns: repeat(${s.cols}, ${cellW}mm);
    grid-template-rows: repeat(${s.rows}, ${cellH}mm); }
  .qr-sheet.break { page-break-after: always; }
  .qr-sticker { width: ${cellW}mm; height: ${cellH}mm; display: flex; align-items: center; gap: 1mm; padding: 0.5mm 1mm; overflow: hidden; }
  .qr-img { width: ${s.qrSize}mm; height: ${s.qrSize}mm; flex-shrink: 0; }
  .qr-info { display: flex; flex-direction: column; justify-content: center; overflow: hidden; flex: 1; }
  .qr-name { font-size: ${s.fontSize}pt; font-weight: 700; color: #000; line-height: 1.2;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .qr-sku { font-size: ${s.skuSize}pt; color: #333; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; margin-top: 0.5pt; }
</style></head><body>
${sheetsHtml}
<script>window.onload=function(){if(window._printed)return;window._printed=true;window.print();window.onafterprint=function(){window.close();};};<\/script>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [selectedProducts, generateQR]);

  // Thermal QR Print
  const handlePrintThermal = useCallback(async (s: ThermalSettings) => {
    const map = new Map<string, string>();
    for (const product of selectedProducts.values()) {
      if (product.barcode && !map.has(product.barcode)) {
        map.set(product.barcode, await generateQR(product.barcode));
      }
    }

    const stickers = Array.from(selectedProducts.values()).flatMap(product =>
      Array.from({ length: product.quantity }, () => ({
        name: product.name,
        sku: product.sku,
        barcode: product.barcode,
        unit: product.unit,
        qrSrc: map.get(product.barcode) || ''
      }))
    );

    const perSheet = s.cols * s.rows;
    const cellW = ((s.sheetW - s.gapX * (s.cols - 1)) / s.cols).toFixed(3);
    const cellH = ((s.sheetH - s.gapY * (s.rows - 1)) / s.rows).toFixed(3);
    const sheets: typeof stickers[] = [];
    for (let i = 0; i < stickers.length; i += perSheet) sheets.push(stickers.slice(i, i + perSheet));

    const sheetsHtml = sheets.map((sheet, idx) => `
      <div class="sheet${idx < sheets.length - 1 ? ' break' : ''}">
        ${sheet.map(st => `
          <div class="sticker">
            <img src="${st.qrSrc}" class="qr-img" />
            <div class="info">
              <div class="name">${st.name}</div>
              <div class="sku">${st.sku}</div>
              <div class="sku">${st.unit}</div>
            </div>
          </div>`).join('')}
      </div>`).join('');

    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Thermal QR</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: ${s.sheetW}mm ${s.sheetH}mm; margin: 0; }
  body { font-family: 'Sarabun', sans-serif; padding-top: ${s.offsetTop}mm; padding-left: ${s.offsetLeft}mm; }
  .sheet {
    width: ${s.sheetW}mm; height: ${s.sheetH}mm;
    display: grid;
    grid-template-columns: repeat(${s.cols}, ${cellW}mm);
    grid-template-rows: repeat(${s.rows}, ${cellH}mm);
    column-gap: ${s.gapX}mm;
    row-gap: ${s.gapY}mm;
  }
  .sheet.break { page-break-after: always; }
  .sticker {
    width: ${cellW}mm; height: ${cellH}mm;
    display: flex; flex-direction: row;
    align-items: center; gap: 0.4mm;
    padding: 0.3mm 0.5mm;
    overflow: hidden;
  }
  .qr-img { width: ${s.qrSize}mm; height: ${s.qrSize}mm; flex-shrink: 0; }
  .info { display: flex; flex-direction: column; justify-content: center; overflow: hidden; flex: 1; }
  .name { font-size: ${s.fontSize}pt; font-weight: 700; color: #000; line-height: 1.2;
    overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .sku { font-size: ${s.skuSize}pt; color: #000; margin-top: 0.5pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .barcode { font-size: 2.5pt; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style></head><body>
${sheetsHtml}
<script>window.onload=function(){if(window._printed)return;window._printed=true;window.print();window.onafterprint=function(){window.close();};};<\/script>
</body></html>`;

    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) setTimeout(() => URL.revokeObjectURL(url), 5000);
  }, [selectedProducts, generateQR]);

  // Print
  const handlePrint = () => {
    setPrintSingle(null);
    window.print();
  };

  const handlePrintSingleLabel = (product: SelectedProduct) => {
    setPrintSingle(product);
    setTimeout(() => {
      window.print();
      setPrintSingle(null);
    }, 50);
  };

  const handlePrintSingle = useCallback(async (product: Product, qty: number) => {
    const qrSrc = await generateQR(product.barcode);
    const s = thermalSettings;
    const cellW = ((s.sheetW - s.gapX * (s.cols - 1)) / s.cols).toFixed(3);
    const cellH = ((s.sheetH - s.gapY * (s.rows - 1)) / s.rows).toFixed(3);
    const perSheet = s.cols * s.rows;
    const stickers = Array.from({ length: qty }, () => ({ name: product.name, sku: product.sku, barcode: product.barcode, unit: product.unit, qrSrc }));
    const sheets: typeof stickers[] = [];
    for (let i = 0; i < stickers.length; i += perSheet) sheets.push(stickers.slice(i, i + perSheet));
    const sheetsHtml = sheets.map(sheet => `
      <div class="sheet">
        ${sheet.map(st => `
          <div class="sticker">
            <img src="${st.qrSrc}" class="qr-img" />
            <div class="info">
              <div class="name">${st.name}</div>
              <div class="sku">${st.sku}</div>
              <div class="sku">${st.unit}</div>
            </div>
          </div>`).join('')}
      </div>`).join('');
    const html = `<!DOCTYPE html>
<html><head><meta charset="UTF-8"/><title>Thermal QR</title>
<link href="https://fonts.googleapis.com/css2?family=Sarabun:wght@400;600;700&display=swap" rel="stylesheet">
<style>
  * { margin: 0; padding: 0; box-sizing: border-box; }
  @page { size: ${s.sheetW}mm ${s.sheetH}mm; margin: 0; }
  body { font-family: 'Sarabun', sans-serif; padding-top: ${s.offsetTop}mm; padding-left: ${s.offsetLeft}mm; }
  .sheet { width: ${s.sheetW}mm; height: ${s.sheetH}mm; display: grid;
    grid-template-columns: repeat(${s.cols}, ${cellW}mm);
    grid-template-rows: repeat(${s.rows}, ${cellH}mm);
    column-gap: ${s.gapX}mm; row-gap: ${s.gapY}mm; page-break-after: always; }
  .sticker { width: ${cellW}mm; height: ${cellH}mm; display: flex; flex-direction: row; align-items: center; gap: 0.4mm; padding: 0.3mm 0.5mm; overflow: hidden; }
  .qr-img { width: ${s.qrSize}mm; height: ${s.qrSize}mm; flex-shrink: 0; }
  .info { display: flex; flex-direction: column; justify-content: center; overflow: hidden; flex: 1; }
  .name { font-size: ${s.fontSize}pt; font-weight: 700; color: #000; line-height: 1.2; overflow: hidden; display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; }
  .sku { font-size: ${s.skuSize}pt; color: #000; margin-top: 0.5pt; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .barcode { font-size: 2.5pt; color: #555; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
</style></head><body>
${sheetsHtml}
<script>window.onload=function(){window.print();window.onafterprint=function(){window.close();};};<\/script>
</body></html>`;
    const blob = new Blob([html], { type: 'text/html;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const win = window.open(url, '_blank');
    if (win) win.onload = () => URL.revokeObjectURL(url);
  }, [thermalSettings, generateQR]);

  // Stats
  const totalItems = selectedProducts.size;
  const totalLabels = Array.from(selectedProducts.values()).reduce((sum, p) => sum + p.quantity, 0);

  // Generate QR for barcode preview
  useEffect(() => {
    if (!previewBarcodeProduct) { setPreviewQrSrc(''); return; }
    generateQR(previewBarcodeProduct.barcode).then(setPreviewQrSrc);
  }, [previewBarcodeProduct, generateQR]);

  // Gate: ต้องล็อกอินก่อนเข้าใช้งานโปรแกรม
  if (!authProfile) {
    return <LoginPage onLogin={handleLogin} />;
  }

  const navHandlers: NavHandlers = {
    pricetag: () => setCurrentPage('pricetag'),
    druglabel: () => setCurrentPage('druglabel'),
    stockcheck: () => setCurrentPage('stockcheck'),
    customerhistory: () => setCurrentPage('customerhistory'),
    outbound: () => setCurrentPage('outbound'),
    salesupport: () => setCurrentPage('salesupport'),
  };

  return (
    <PageVisibilityContext.Provider value={pageVisibility}>
    <PageNotificationContext.Provider value={{ salesupport: saleSupportUnreadCount }}>
    <div className="app-container">
      {/* แถบผู้ใช้ปัจจุบัน + ออกจากระบบ (แสดงทุกหน้า) */}
      <div className="app-userbar">
        <span className="app-userbar-icon">{authProfile.icon}</span>
        <span className="app-userbar-name">{authProfile.label}</span>
        <button className="app-userbar-gear" onClick={() => { setShowPageSettings(true); setPageSettingsPw(''); setPageSettingsVerified(false); setPageSettingsError(false); }} title="ตั้งค่าการแสดงหน้า (admin)">⚙️</button>
        <button className="app-userbar-logout" onClick={handleLogout} title="ออกจากระบบ">ออกจากระบบ</button>
      </div>

      {/* Hero Header — shown only on price tag page */}
      {currentPage === 'pricetag' && (<div className="hero-header">
        <div className="hero-content">
          <h1 className="logo-premium">
            <AnimatedLogoText text="Price Tag and QR CODE" />
          </h1>
          <div className="tagline-row">
            {lastUpdated ? (
              <span className="updated-badge">Last Updated : {lastUpdated}</span>
            ) : (
              <span className="updated-badge updated-badge--loading">Loading...</span>
            )}
            </div>
          <PageNavRow current="pricetag" handlers={navHandlers} />
        </div>
      </div>)}

      {/* Main Container — Price Tag Page */}
      {currentPage === 'pricetag' && (
      <div className="container">

        {/* Upload CSV hidden input */}
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} />

        {/* Upload Location (.xlsx) hidden input — หมวดสินค้า */}
        <input ref={locationFileRef} type="file" accept=".xlsx,.xls" onChange={handleLocationUpload} style={{ display: 'none' }} />

        <div className="table-search-row table-search-row--center">
          <div className="search-premium">
            <input
              type="text"
              className="search-input-premium"
              placeholder="Search SKU, Barcode or Name..."
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            <button className="search-btn-premium"><SearchIcon /></button>
          </div>
        </div>

        {/* Main split layout */}
        <div className="main-split">
        <div className="single-col">

          <div className="product-table-wrap" style={{ opacity: (isLoading || categoryLoading) ? 0.5 : 1, transition: 'opacity 0.15s' }}>
              <div className="selected-table-header">
                <span>
                  {!searchTerm.trim() && activeSel === null && scannedHistory.size > 0 && (
                    <span className="scan-mode-badge"></span>
                  )}
                  {activeCategory !== null && (
                    <span className="cat-mode-badge">
                      {profileBranch} · หมวด {activeCategory} · {PRODUCT_CATEGORIES.find(c => c.no === activeCategory)?.label}
                    </span>
                  )}
                  {activeSel?.kind === 'locGroup' && (
                    <span className="cat-mode-badge">
                      {profileBranch} · ชั้นวาง {activeSel.prefix} ({activeSel.locs.length} ชั้น)
                    </span>
                  )}
                  {categoryLoading
                    ? 'กำลังโหลด...'
                    : categoryError
                      ? `❌ ${categoryError}`
                      : <>{visibleProducts.length.toLocaleString()} รายการ {totalItems > 0 && `· เลือกแล้ว ${totalItems.toLocaleString()} (${totalLabels.toLocaleString()} ป้าย)`}</>}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', position: 'relative' }}>
                  {/* ซ่อนทั้งปุ่มถ้าโปรไฟล์ไม่สังกัดสาขา (จัดซื้อ) — กันปริ้นผิดสาขา */}
                  {profileBranch && (
                  <div className="cat-dropdown-wrap">
                    {showCategoryMenu && <div className="cat-overlay" onClick={() => setShowCategoryMenu(false)} />}
                    <button
                      className={`btn-nav-style${activeCategory !== null ? ' btn-nav-style--on' : ''}`}
                      onClick={() => {
                        // คำนวณค่าถัดไปนอก updater — setState updater ต้องเป็น pure
                        // (StrictMode เรียกซ้ำ จะทำให้ ensureCategoryCounts ยิง 2 รอบ)
                        const next = !showCategoryMenu;
                        setShowCategoryMenu(next);
                        if (next) { setShowCart(false); setShowLocationMenu(false); ensureCategoryCounts(); }
                      }}
                    >
                      เลือกตามหมวด{activeCategory !== null ? ` · ${activeCategory}` : ''}
                    </button>
                    {showCategoryMenu && (
                      <div className="cat-dropdown">
                        <div className="cat-dropdown-header">
                          <span>เลือกตามหมวด</span>
                          <button className="cat-dropdown-close" onClick={() => setShowCategoryMenu(false)}>✕</button>
                        </div>
                        <div className="cat-branch-locked" title="สาขาล็อกตามผู้ใช้ที่ล็อกอิน">
                          🔒 สาขา <strong>{profileBranch}</strong>
                        </div>
                        <div className="cat-dropdown-list">
                          {PRODUCT_CATEGORIES.map(c => {
                            const n = categoryCounts?.[`${profileBranch}|${c.no}`];
                            return (
                              <button
                                key={c.no}
                                className={`cat-dropdown-item${activeCategory === c.no ? ' is-active' : ''}`}
                                disabled={categoryLoading || (categoryCounts != null && !n)}
                                onClick={() => loadSelection({ kind: 'category', no: c.no }, profileBranch)}
                              >
                                <span className="cat-item-no">{c.no}</span>
                                <span className="cat-item-label">{c.label}</span>
                                <span className="cat-item-count">{n?.toLocaleString() ?? ''}</span>
                              </button>
                            );
                          })}
                        </div>
                        {categoryCounts && !PRODUCT_CATEGORIES.some(c => categoryCounts[`${profileBranch}|${c.no}`]) && (
                          <div className="cat-dropdown-status">
                            สาขา {profileBranch} ยังไม่มีข้อมูลหมวด — อัปโหลดไฟล์ Location ของสาขานี้ก่อน
                          </div>
                        )}
                        <div className="cat-dropdown-footer">
                          <button
                            className="btn-clear-small"
                            disabled={locationBusy}
                            onClick={() => locationFileRef.current?.click()}
                          >
                            {locationBusy ? 'กำลังอัปโหลด...' : `📁 อัปโหลด Location → ${profileBranch}`}
                          </button>
                          {activeCategory !== null && (
                            <button className="btn-clear-small" onClick={exitCategory}>ล้างหมวด</button>
                          )}
                        </div>
                        {locationStatus && <div className="cat-dropdown-status">{locationStatus}</div>}
                      </div>
                    )}
                  </div>
                  )}

                  {/* เลือกตาม Location — ใช้ข้อมูล/loader ชุดเดียวกับเลือกตามหมวด */}
                  {profileBranch && (
                  <div className="cat-dropdown-wrap">
                    {showLocationMenu && <div className="cat-overlay" onClick={() => setShowLocationMenu(false)} />}
                    <button
                      className={`btn-nav-style${activeLocGroup !== null ? ' btn-nav-style--on' : ''}`}
                      onClick={() => {
                        const next = !showLocationMenu;
                        setShowLocationMenu(next);
                        if (next) { setShowCart(false); setShowCategoryMenu(false); ensureLocationOptions(profileBranch); }
                      }}
                    >
                      เลือกตาม Location{activeLocGroup !== null ? ` · ${activeLocGroup}` : ''}
                    </button>
                    {showLocationMenu && (
                      <div className="cat-dropdown cat-dropdown--loc">
                        <div className="cat-dropdown-header">
                          <span>เลือกตาม Location</span>
                          <button className="cat-dropdown-close" onClick={() => setShowLocationMenu(false)}>✕</button>
                        </div>
                        <div className="cat-branch-locked" title="สาขาล็อกตามผู้ใช้ที่ล็อกอิน">
                          🔒 สาขา <strong>{profileBranch}</strong>
                          {locationGroups && (
                            <span className="cat-loc-total">
                              {locationGroups.length} กลุ่ม · {locationOptions?.length} ชั้นวาง
                            </span>
                          )}
                        </div>
                        {locationGroups === null ? (
                          <div className="cat-dropdown-status">กำลังโหลดรหัสชั้นวาง...</div>
                        ) : locationGroups.length === 0 ? (
                          <div className="cat-dropdown-status">
                            สาขา {profileBranch} ยังไม่มีข้อมูลชั้นวาง — อัปโหลดไฟล์ Location ของสาขานี้ก่อน
                          </div>
                        ) : (
                          <div className="cat-loc-grid">
                            {locationGroups.map(g => (
                              <button
                                key={g.prefix}
                                className={`cat-loc-chip${activeLocGroup === g.prefix ? ' is-active' : ''}`}
                                disabled={categoryLoading}
                                title={`${g.locs.length} ชั้นวาง: ${g.locs.slice(0, 12).join(' ')}${g.locs.length > 12 ? ' ...' : ''}`}
                                onClick={() => loadSelection({ kind: 'locGroup', prefix: g.prefix, locs: g.locs }, profileBranch)}
                              >
                                <span className="cat-loc-name">{g.prefix}</span>
                                <span className="cat-loc-sub">{g.locs.length}</span>
                              </button>
                            ))}
                          </div>
                        )}
                        {activeLocGroup !== null && (
                          <div className="cat-dropdown-footer">
                            <button className="btn-clear-small" onClick={exitCategory}>ล้าง Location</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                  )}

                  <div className="cart-dropdown-wrap">
                    {showCart && <div className="cart-overlay" onClick={() => setShowCart(false)} />}
                    <button className="btn-nav-style" onClick={() => {
                      const next = !showCart;
                      setShowCart(next);
                      if (next) { setShowCategoryMenu(false); setShowLocationMenu(false); }
                    }}>
                      รายการที่เลือก{totalItems > 0 ? ` (${totalItems})` : ''}
                    </button>
                    {showCart && (
                      <div className="cart-dropdown">
                        <div className="cart-dropdown-header">
                          <span>🛒 รายการที่เลือก</span>
                          <button className="cart-dropdown-close" onClick={() => setShowCart(false)}>✕</button>
                        </div>
                        {selectedProducts.size === 0 ? (
                          <div className="cart-dropdown-empty">ยังไม่มีสินค้าในตะกร้า</div>
                        ) : (
                          <>
                            <div className="cart-dropdown-list">
                              {Array.from(selectedProducts.values()).map(p => {
                                const k = `${p.sku}-${p.unit}`;
                                return (
                                  <div key={k} className="cart-dropdown-row">
                                    <div className="cart-dropdown-info">
                                      <span className="cart-dropdown-sku">{p.sku}</span>
                                      <span className="cart-dropdown-name">{p.name}</span>
                                      <span className="cart-dropdown-badge">{p.unit}</span>
                                    </div>
                                    <div className="cart-dropdown-qty">
                                      <button className="qty-btn qty-btn--minus" onClick={() => updateQuantity(k, -1)}>−</button>
                                      <span className="cart-row-qty-num">{p.quantity}</span>
                                      <button className="qty-btn qty-btn--plus" onClick={() => updateQuantity(k, 1)}>+</button>
                                    </div>
                                    <button className="cart-row-del" onClick={() => removeProduct(k)}>✕</button>
                                  </div>
                                );
                              })}
                            </div>
                            <div className="cart-dropdown-footer">
                              <span>{totalLabels} ป้ายรวม</span>
                              <button className="btn-clear-small" onClick={() => { clearCart(); setShowCart(false); }}>ล้างทั้งหมด</button>
                            </div>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                  <button className="btn-nav-style" onClick={handleSelectAll}>เลือกทั้งหมด</button>
                  <button className="btn-nav-style" onClick={clearAll}>ลบทั้งหมด</button>
                </div>
              </div>
              <table className="product-table pricetag-table">
                <thead>
                  <tr>
                    <th>SKU</th>
                    <th>Barcode</th>
                    <th>ชื่อสินค้า</th>
                    <th>หน่วย</th>
                    <th>ราคา</th>
                    <th>จำนวนที่ต้องการพิมพ์</th>
                    <th>ปริ้นป้ายราคา</th>
                    <th>ปริ้นป้ายบาร์โค้ด</th>
                    <th> </th>
                  </tr>
                </thead>
                <tbody>
                  {visibleProducts.map((product) => {
                    const key = `${product.sku}-${product.unit}`;
                    const selected = selectedProducts.get(key);
                    return (
                      <tr key={key} className={selected ? 'row-selected' : ''}>
                        <td>{product.sku}</td>
                        <td>{product.barcode}</td>
                        <td title={product.name}>{product.name}</td>
                        <td>{product.unit}</td>
                        <td>฿{product.price.toFixed(2)}</td>
                        <td>
                          <div className="qty-control">
                            <button className="qty-btn qty-btn--minus" onClick={() => { const cur = rowQty.get(key) ?? 1; if (cur <= 1) { removeProduct(key); } else { setRowQty(prev => { const next = new Map(prev); next.set(key, cur - 1); return next; }); } }}>−</button>
                            <input
                              className="qty-input"
                              type="number"
                              min={1}
                              value={rowQty.get(key) ?? 1}
                              onChange={(e) => {
                                const v = parseInt(e.target.value);
                                if (v >= 1) setRowQty(prev => { const next = new Map(prev); next.set(key, v); return next; });
                              }}
                            />
                            <button className="qty-btn qty-btn--plus" onClick={() => setRowQty(prev => { const next = new Map(prev); next.set(key, (prev.get(key) ?? 1) + 1); return next; })}>+</button>
                            <button className={`qty-btn cart-inline-btn${selected ? ' in-cart' : ''}`} onClick={() => handleAddToCart(product, rowQty.get(key) ?? 1)} title="เพิ่มเข้าตะกร้า">🛒</button>
                          </div>
                        </td>
                        <td>
                          <button className="icon-btn" onClick={() => selected && handlePrintSingleLabel(selected)}>🏷️</button>
                          <button className="icon-btn" onClick={() => setPreviewPriceProduct(product)}>🔍</button>
                        </td>
                        <td>
                          <button className="icon-btn" onClick={() => handlePrintSingle(product, selected?.quantity ?? 1)}>🖨️</button>
                          <button className="icon-btn" onClick={() => setPreviewBarcodeProduct(product)}>🔍</button>
                        </td>
                        <td>
                          <button className="icon-btn" onClick={() => removeProduct(key)}>❌️</button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

        </div>

        {/* Live Preview Panel - Price Label */}
        {previewPriceProduct && (
        <div className="live-preview-panel">
          <div className="live-preview-card">
            <div className="live-preview-card-header">
              <span>🏷️ Preview ป้ายราคา</span>
              <span className="live-preview-size">4.5 × 4 cm</span>
            </div>
            <div className="live-preview-card-subheader">
              <span>{previewPriceProduct.name}</span>
              <button className="preview-close-btn" onClick={() => setPreviewPriceProduct(null)}>✕</button>
            </div>
            <div className="live-preview-card-body">
              <div className="live-preview-ruler-wrap">
                <div />
                <div className="ruler-h">
                  <div className="ruler-line" />
                  <span className="ruler-label">4.5 cm</span>
                  <div className="ruler-line" />
                </div>
                <div className="ruler-v">
                  <div className="ruler-line-v" />
                  <span className="ruler-label-v">4 cm</span>
                  <div className="ruler-line-v" />
                </div>
                <div className="ruler-label-col">
                  <div className="label-preview">
                    <>
                      <div className="lbl-header">
                        {previewPriceProduct.location && <div className="lbl-loc">{previewPriceProduct.location}</div>}
                        <div className="lbl-logo">BIGYA</div>
                      </div>
                      <div className="lbl-mid">
                        <div className="lbl-name-row">
                          <span className="lbl-name">{previewPriceProduct.name}</span>
                          <span className="lbl-unit">{previewPriceProduct.unit}</span>
                        </div>
                        <div className="lbl-price-section">
                          <div className="lbl-price-labels">
                            <span>Price</span>
                            <span>ราคา</span>
                          </div>
                          <div className="lbl-price-value">
                            <span className="lbl-price-int">{Math.floor(previewPriceProduct.price).toLocaleString()}</span>
                          </div>
                          <span className="lbl-baht">บาท</span>
                        </div>
                      </div>
                      <div className="lbl-footer">
                        <div className="lbl-codes">
                          <div>{new Date().toLocaleDateString('th-TH')}</div>
                          <div>{previewPriceProduct.sku}</div>
                        </div>
                        <div className="lbl-barcode">
                          <img src={generateBarcode(previewPriceProduct.barcode)} alt="barcode" />
                          <div className="lbl-barcode-num">{previewPriceProduct.barcode}</div>
                        </div>
                      </div>
                    </>
                  </div>
                </div>
              </div>
            </div>
          </div>
        </div>)}

        {/* Live Preview Panel - Barcode */}
        {previewBarcodeProduct && (
        <div className="live-preview-panel">
          <div className="live-preview-card">
            <div className="live-preview-card-header">
              <span>🖨️ Preview ป้ายบาร์โค้ด</span>
              <span className="live-preview-size">{thermalSettings.sheetW} × {thermalSettings.sheetH} mm</span>
            </div>
            <div className="live-preview-card-subheader">
              <span>{previewBarcodeProduct.name}</span>
              <button className="preview-close-btn" onClick={() => setPreviewBarcodeProduct(null)}>✕</button>
            </div>
            <div className="live-preview-card-body">
              {(() => {
                const s = thermalSettings;
                const cellW = (s.sheetW - s.gapX * (s.cols - 1)) / s.cols;
                const cellH = (s.sheetH - s.gapY * (s.rows - 1)) / s.rows;
                const scale = 8;
                const pxPerPt = scale * 0.3528;
                const maxQr = parseFloat(Math.min(cellW, cellH).toFixed(1));
                const maxFont = parseFloat(((cellH / 3) / 0.3528).toFixed(1));
                const maxSku = parseFloat(((cellH / 3.5) / 0.3528).toFixed(1));
                return (
                  <>
                    <div className="barcode-sticker-preview" style={{
                      width: `${cellW * scale}px`,
                      height: `${cellH * scale}px`,
                      padding: `${0.5 * scale}px ${1 * scale}px`,
                      gap: `${0.4 * scale}px`,
                    }}>
                      {previewBarcodeProduct && previewQrSrc ? (<>
                        <img src={previewQrSrc} alt="QR" style={{ width: `${s.qrSize * scale}px`, height: `${s.qrSize * scale}px`, flexShrink: 0 }} />
                        <div className="bsp-info">
                          <div className="bsp-name" style={{ fontSize: `${s.fontSize * pxPerPt}px` }}>{previewBarcodeProduct.name}</div>
                          <div className="bsp-sku" style={{ fontSize: `${s.skuSize * pxPerPt}px` }}>{previewBarcodeProduct.sku}</div>
                          <div className="bsp-unit" style={{ fontSize: `${s.skuSize * pxPerPt}px` }}>{previewBarcodeProduct.unit}</div>
                        </div>
                      </>) : null}
                    </div>
                    <div className="bsp-size-label">{cellW.toFixed(1)} × {cellH.toFixed(1)} mm / ชิ้น</div>
                    <div className="bsp-controls">
                      <div className="bsp-control-row">
                        <span className="bsp-control-label">QR</span>
                        <input type="range" min={2} max={maxQr} step={0.5} value={Math.min(s.qrSize, maxQr)}
                          onChange={e => saveThermalSettings({ ...s, qrSize: parseFloat(e.target.value) })} />
                        <span className="bsp-control-val">{s.qrSize} mm</span>
                      </div>
                      <div className="bsp-control-row">
                        <span className="bsp-control-label">ชื่อ</span>
                        <input type="range" min={1} max={maxFont} step={0.5} value={Math.min(s.fontSize, maxFont)}
                          onChange={e => saveThermalSettings({ ...s, fontSize: parseFloat(e.target.value) })} />
                        <span className="bsp-control-val">{s.fontSize} pt</span>
                      </div>
                      <div className="bsp-control-row">
                        <span className="bsp-control-label">SKU</span>
                        <input type="range" min={1} max={maxSku} step={0.5} value={Math.min(s.skuSize, maxSku)}
                          onChange={e => saveThermalSettings({ ...s, skuSize: parseFloat(e.target.value) })} />
                        <span className="bsp-control-val">{s.skuSize} pt</span>
                      </div>
                    </div>
                  </>
                );
              })()}
            </div>
          </div>
        </div>)}{/* end live-preview-panel */}
        </div>{/* end main-split */}

      </div>
      )}{/* end pricetag page */}

      {/* Drug Label Page */}
      {currentPage === 'druglabel' && (
        <DrugLabelPage
          onGoPriceTag={() => setCurrentPage('pricetag')}
          onGoDrugLabel={() => setCurrentPage('druglabel')}
          onGoStockCheck={() => setCurrentPage('stockcheck')}
          onGoCustomerHistory={() => setCurrentPage('customerhistory')}
          onGoOutbound={() => setCurrentPage('outbound')}
          onGoSaleSupport={() => setCurrentPage('salesupport')}
        />
      )}

      {/* Customer History Page */}
      {currentPage === 'customerhistory' && (
        <CustomerHistoryPage
          onGoPriceTag={() => setCurrentPage('pricetag')}
          onGoDrugLabel={() => setCurrentPage('druglabel')}
          onGoStockCheck={() => setCurrentPage('stockcheck')}
          onGoCustomerHistory={() => setCurrentPage('customerhistory')}
          onGoOutbound={() => setCurrentPage('outbound')}
          onGoSaleSupport={() => setCurrentPage('salesupport')}
        />
      )}

      {/* Stock Check Page */}
      {currentPage === 'stockcheck' && (
        <StockCheckPage
          onGoPriceTag={() => setCurrentPage('pricetag')}
          onGoDrugLabel={() => setCurrentPage('druglabel')}
          onGoStockCheck={() => setCurrentPage('stockcheck')}
          onGoCustomerHistory={() => setCurrentPage('customerhistory')}
          onGoOutbound={() => setCurrentPage('outbound')}
          onGoSaleSupport={() => setCurrentPage('salesupport')}
        />
      )}

      {/* Outbound Page */}
      {currentPage === 'outbound' && (
        <OutboundPage
          onGoPriceTag={() => setCurrentPage('pricetag')}
          onGoDrugLabel={() => setCurrentPage('druglabel')}
          onGoStockCheck={() => setCurrentPage('stockcheck')}
          onGoCustomerHistory={() => setCurrentPage('customerhistory')}
          onGoOutbound={() => setCurrentPage('outbound')}
          onGoSaleSupport={() => setCurrentPage('salesupport')}
          isWarehouse={authProfile.group === 'คลังสินค้า'}
          isPurchasing={authProfile.id === 'PURCHASING'}
          userBranch={authProfile.group === 'สาขา' ? authProfile.id : undefined}
        />
      )}

      {/* SaleSupport Page */}
      {currentPage === 'salesupport' && (
        <SaleSupportPage
          onGoPriceTag={() => setCurrentPage('pricetag')}
          onGoDrugLabel={() => setCurrentPage('druglabel')}
          onGoStockCheck={() => setCurrentPage('stockcheck')}
          onGoCustomerHistory={() => setCurrentPage('customerhistory')}
          onGoOutbound={() => setCurrentPage('outbound')}
          onGoSaleSupport={() => setCurrentPage('salesupport')}
          isPurchasing={authProfile.id === 'PURCHASING'}
          isWarehouse={authProfile.group === 'คลังสินค้า'}
          userBranch={authProfile.branch ?? undefined}
        />
      )}

      {/* Footer Actions */}
      <div className="footer-actions">
        {currentPage === 'pricetag' && totalItems > 0 && (
          <>
            <button className="print-action-btn" onClick={handlePrint}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <polyline points="6 9 6 2 18 2 18 9" />
                <path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
                <rect x="6" y="14" width="12" height="8" rx="1" />
              </svg>
              <span>พิมพ์ป้ายราคา ({totalLabels} ป้าย)</span>
            </button>
            <button className="print-action-btn" onClick={() => handlePrintThermal(thermalSettings)}>
              <svg viewBox="0 0 24 24" aria-hidden="true">
                <path d="M3 5v14" /><path d="M7 5v14" /><path d="M11 5v14" />
                <path d="M14 5v14" /><path d="M18 5v14" /><path d="M21 5v14" />
              </svg>
              <span>พิมพ์บาร์โค้ด</span>
            </button>
          </>
        )}
        <button
          className="admin-trigger"
          onClick={() => setIsAdmin(v => !v)}
          title="Admin"
        >💻</button>
      </div>

      {/* Admin Panel */}
      {isAdmin && (
        <div className="modal-overlay" onClick={() => setIsAdmin(false)}>
          <div className="modal-content" style={{ maxWidth: 420 }} onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <div>
                <h2 style={{ margin: 0 }}>Admin | Login</h2>
                <p style={{ fontSize: '11px', color: '#b49150', margin: 0 }}>© Data →  R05.106 | Assignee : Inbound</p>
                </div>
              <button className="modal-close" onClick={() => setIsAdmin(false)}>✕</button>
            </div>
            <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
              <div>
                <label style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>Password</label>
                <input
                  type="password"
                  className="search-input-premium"
                  style={{ width: '100%', fontSize: '1rem' }}
                  placeholder="Input password..."
                  value={adminPassword}
                  onChange={e => { setAdminPassword(e.target.value); setAdminVerified(false); }}
                  onKeyDown={e => { if (e.key === 'Enter' && adminPassword === (import.meta.env.VITE_ADMIN_PASSWORD || 'admin1234')) setAdminVerified(true); }}
                />
              </div>
              {adminVerified && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '0.75rem' }}>
                  <button className="btn-premium" onClick={() => fileInputRef.current?.click()}>
                    Upload R05.106
                  </button>
                  {uploadStatus && (
                    // pre-line: ข้อความ error หัวคอลัมน์เป็นหลายบรรทัด ถ้าไม่ตั้งจะยุบเป็นบรรทัดเดียว
                    <div style={{ padding: '0.75rem', background: '#f9f9f9', borderRadius: 8, fontSize: '0.9rem', whiteSpace: 'pre-line', lineHeight: 1.5, wordBreak: 'break-word' }}>
                      {uploadStatus}
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* QR Settings Modal */}
      {showQrSettings && (
        <div className="modal-overlay" onClick={() => setShowQrSettings(false)}>
          <div className="modal-content qr-settings-modal" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>⚙️ ตั้งค่าการพิมพ์สติ๊กเกอร์ QR</h2>
              <button className="modal-close" onClick={() => setShowQrSettings(false)}>✕</button>
            </div>
            <div className="qr-settings-body">
              <div className="settings-section">
                <h4>ขนาด Sheet และ Grid</h4>
                <div className="settings-grid">
                  {([
                    ['กว้าง Sheet (mm)', 'sheetW'],
                    ['สูง Sheet (mm)', 'sheetH'],
                    ['จำนวนคอลัมน์', 'cols'],
                    ['จำนวนแถว', 'rows'],
                  ] as [string, keyof QrSettings][]).map(([label, key]) => (
                    <label key={key} className="settings-row">
                      <span>{label}</span>
                      <input type="number" value={qrSettings[key]} min={1} step={key === 'cols' || key === 'rows' ? 1 : 0.5}
                        onChange={e => saveQrSettings({ ...qrSettings, [key]: parseFloat(e.target.value) || 0 })} />
                    </label>
                  ))}
                </div>
              </div>
              <div className="settings-section">
                <h4>Offset ปรับตำแหน่ง (สำหรับปรับให้ตรงช่อง)</h4>
                <div className="settings-grid">
                  {([
                    ['Offset บน (mm)', 'offsetTop'],
                    ['Offset ซ้าย (mm)', 'offsetLeft'],
                  ] as [string, keyof QrSettings][]).map(([label, key]) => (
                    <label key={key} className="settings-row">
                      <span>{label}</span>
                      <input type="number" value={qrSettings[key]} step={0.1}
                        onChange={e => saveQrSettings({ ...qrSettings, [key]: parseFloat(e.target.value) || 0 })} />
                    </label>
                  ))}
                </div>
              </div>
              <div className="settings-section">
                <h4>ขนาด QR และตัวอักษร</h4>
                <div className="settings-grid">
                  {([
                    ['ขนาด QR (mm)', 'qrSize'],
                    ['ขนาดชื่อสินค้า (pt)', 'fontSize'],
                    ['ขนาด SKU (pt)', 'skuSize'],
                  ] as [string, keyof QrSettings][]).map(([label, key]) => (
                    <label key={key} className="settings-row">
                      <span>{label}</span>
                      <input type="number" value={qrSettings[key]} min={1} step={0.5}
                        onChange={e => saveQrSettings({ ...qrSettings, [key]: parseFloat(e.target.value) || 0 })} />
                    </label>
                  ))}
                </div>
              </div>
              <div className="settings-section">
                <h4>ขนาดต่อช่อง (คำนวณอัตโนมัติ)</h4>
                <div className="settings-info">
                  <span>กว้าง: <b>{(qrSettings.sheetW / qrSettings.cols).toFixed(1)} mm</b></span>
                  <span>สูง: <b>{(qrSettings.sheetH / qrSettings.rows).toFixed(1)} mm</b></span>
                  <span>ต่อแผ่น: <b>{qrSettings.cols * qrSettings.rows} ดวง</b></span>
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn-outline" onClick={() => { saveQrSettings(DEFAULT_QR_SETTINGS); }}>
                รีเซ็ต
              </button>
              <button className="btn-outline" onClick={() => setShowQrSettings(false)}>ปิด</button>
              <button className="btn-premium" onClick={() => { setShowQrSettings(false); handlePrintQr(qrSettings); }}>
                📦 พิมพ์เลย
              </button>
            </div>
          </div>
        </div>
      )}


      {/* Preview Modal */}
      {showPreview && (
        <div className="modal-overlay" onClick={() => setShowPreview(false)}>
          <div className="modal-content" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>ตัวอย่างป้ายราคา ({totalLabels} ป้าย)</h2>
              <button className="modal-close" onClick={() => setShowPreview(false)}>✕</button>
            </div>
            <div className="preview-labels">
              {Array.from(selectedProducts.values()).flatMap(product =>
                Array.from({ length: product.quantity }, (_, i) => (
                  <div key={`${product.sku}-${product.unit}-${i}`} className="label-preview">
                    <div className="lbl-header">
                      {product.location && <div className="lbl-loc">{product.location}</div>}
                      <div className="lbl-logo">BIGYA</div>
                    </div>
                    <div className="lbl-mid">
                      <div className="lbl-name-row">
                        <span className="lbl-name">{product.name}</span>
                        <span className="lbl-unit">{product.unit}</span>
                      </div>
                      <div className="lbl-price-section">
                        <div className="lbl-price-labels">
                          <span>Price</span>
                          <span>ราคา</span>
                        </div>
                        <div className="lbl-price-value">
                          <span className="lbl-price-int">{Math.floor(product.price).toLocaleString()}</span>
                        </div>
                        <span className="lbl-baht">บาท</span>
                      </div>
                    </div>
                    <div className="lbl-footer">
                      <div className="lbl-codes">
                        <div>{new Date().toLocaleDateString('th-TH')}</div>
                        <div>{product.sku}</div>
                      </div>
                      <div className="lbl-barcode">
                        <img src={generateBarcode(product.barcode)} alt="barcode" />
                        <div className="lbl-barcode-num">{product.barcode}</div>
                      </div>
                    </div>
                  </div>
                ))
              )}
            </div>
            <div className="modal-footer">
              <button className="btn-outline" onClick={() => setShowPreview(false)}>
                ปิด
              </button>
              <button className="btn-premium" onClick={handlePrint}>
                🖨️ พิมพ์
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Price Label Print Layout */}
      <div className="print-only">
        {(printSingle ? [printSingle] : Array.from(selectedProducts.values())).flatMap(product =>
          Array.from({ length: product.quantity }, (_, i) => (
            <div key={`${product.sku}-${product.unit}-${i}`} className="label-print">
              <div className="lbl-header">
                {product.location && <div className="lbl-loc">{product.location}</div>}
                <div className="lbl-logo">BIGYA</div>
              </div>
              <div className="lbl-mid">
                <div className="lbl-name-row">
                  <span className="lbl-name">{product.name}</span>
                  <span className="lbl-unit">{product.unit}</span>
                </div>
                <div className="lbl-price-section">
                  <div className="lbl-price-labels">
                    <span>Price</span>
                    <span>ราคา</span>
                  </div>
                  <div className="lbl-price-value">
                    <span className="lbl-price-int">{Math.floor(product.price).toLocaleString()}</span>
                  </div>
                  <span className="lbl-baht">บาท</span>
                </div>
              </div>
              <div className="lbl-footer">
                <div className="lbl-codes">
                  <div>{new Date().toLocaleDateString('th-TH')}</div>
                  <div>{product.sku}</div>
                </div>
                <div className="lbl-barcode">
                  <img src={generateBarcode(product.barcode)} alt="barcode" />
                  <div className="lbl-barcode-num">{product.barcode}</div>
                </div>
              </div>
            </div>
          ))
        )}
      </div>

      {/* Page Settings Modal — เปิด/ปิดปุ่มแต่ละหน้า (admin) */}
      {showPageSettings && (
        <div className="modal-overlay" onClick={() => setShowPageSettings(false)}>
          <div className="modal-content page-settings-modal" onClick={e => e.stopPropagation()}>
            {pageSettingsVerified && (
              <div className="modal-header">
                <div>
                  <h2 style={{ margin: 0 }}>⚙️ ตั้งค่าการแสดงหน้า</h2>
                  <p style={{ fontSize: '12px', color: '#8194a8', margin: '2px 0 0' }}>เปิด/ปิดปุ่มเมนูแต่ละหน้า — มีผลทุกเครื่อง</p>
                </div>
                <button className="modal-close" onClick={() => setShowPageSettings(false)}>✕</button>
              </div>
            )}
            <div className={`page-settings-body${!pageSettingsVerified ? ' page-settings-body--lock' : ''}`}>
              {!pageSettingsVerified ? (
                <div className="page-settings-lock">
                  <button className="page-settings-lock-close" onClick={() => setShowPageSettings(false)}>✕</button>
                  <div className="page-settings-lock-icon">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                      <rect x="5" y="11" width="14" height="10" rx="2" />
                      <path d="M8 11V7a4 4 0 0 1 8 0v4" />
                    </svg>
                  </div>
                  <div className="page-settings-lock-form">
                    <label style={{ fontWeight: 600, display: 'block', marginBottom: 6 }}>รหัส admin</label>
                    <input
                      type="password"
                      className="search-input-premium"
                      style={{ width: '100%', fontSize: '1rem' }}
                      placeholder="ใส่รหัส admin..."
                      autoFocus
                      value={pageSettingsPw}
                      onChange={e => { setPageSettingsPw(e.target.value); setPageSettingsError(false); }}
                      onKeyDown={e => {
                        if (e.key !== 'Enter') return;
                        if (pageSettingsPw === (import.meta.env.VITE_ADMIN_PASSWORD || 'admin1234')) setPageSettingsVerified(true);
                        else setPageSettingsError(true);
                      }}
                    />
                    <button
                      className="btn-premium"
                      style={{ marginTop: 12, width: '100%' }}
                      onClick={() => {
                        if (pageSettingsPw === (import.meta.env.VITE_ADMIN_PASSWORD || 'admin1234')) setPageSettingsVerified(true);
                        else setPageSettingsError(true);
                      }}
                    >ปลดล็อก 🔓</button>
                    {pageSettingsError && (
                      <div style={{ marginTop: 8, color: '#c0392b', fontSize: 13 }}>รหัสไม่ถูกต้อง</div>
                    )}
                  </div>
                </div>
              ) : (
                <div className="page-toggle-list">
                  {PAGE_NAV.map(p => (
                    <div className="page-toggle-row" key={p.id}>
                      <span className="page-toggle-label"><span className="page-toggle-icon">{p.icon}</span>{p.label}</span>
                      <button
                        className={`page-toggle-switch${pageVisibility[p.id] ? ' on' : ''}`}
                        onClick={() => togglePageVisible(p.id)}
                        role="switch"
                        aria-checked={pageVisibility[p.id]}
                        title={pageVisibility[p.id] ? 'กำลังแสดง — คลิกเพื่อซ่อน' : 'ถูกซ่อน — คลิกเพื่อแสดง'}
                      >
                        <span className="page-toggle-knob" />
                      </button>
                    </div>
                  ))}
                  <p className="page-settings-hint">ปิดแล้วปุ่มเมนูหน้านั้นจะหายจากทุกหน้า/ทุกเครื่อง (บันทึกอัตโนมัติ)</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
    </PageNotificationContext.Provider>
    </PageVisibilityContext.Provider>
  );
};

export default App;
