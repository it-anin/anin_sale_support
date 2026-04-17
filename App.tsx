import React, { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import Papa from 'papaparse';
import JsBarcode from 'jsbarcode';
import QRCode from 'qrcode';
import { supabase } from './supabase';
import './App.css';

// Types
interface Product {
  barcode: string;
  sku: string;
  name: string;
  unit: string;
  price: number;
  category?: string;
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
  qrSize: 6,  
  fontSize: 4.5, skuSize: 4.5,
};

// Sheet/Grid ค่าตายตัว — ห้ามแก้ไขโดยไม่ได้รับอนุญาต
const FIXED_THERMAL: Pick<ThermalSettings, 'sheetW'|'sheetH'|'cols'|'rows'|'gapX'|'gapY'|'offsetTop'|'offsetLeft'> = {
  sheetW: 90, sheetH: 62,
  cols: 4, rows: 5,
  gapX: 2, gapY: 2,
  offsetTop: 0, offsetLeft: 1,
};

function loadThermalSettings(): ThermalSettings {
  try {
    const s = localStorage.getItem('thermalSettings');
    const saved = s ? JSON.parse(s) : {};
    // โหลดเฉพาะ qrSize, fontSize, skuSize จาก localStorage — sheet/grid ใช้ค่าตายตัวเสมอ
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


const App: React.FC = () => {
  const [selectedProducts, setSelectedProducts] = useState<Map<string, SelectedProduct>>(new Map());
  const [searchInput, setSearchInput] = useState('');
  const [searchTerm, setSearchTerm] = useState('');
  const [scannedHistory, setScannedHistory] = useState<Map<string, Product>>(new Map());
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
    localStorage.setItem('thermalSettings', JSON.stringify({ qrSize: enforced.qrSize, fontSize: enforced.fontSize, skuSize: enforced.skuSize }));
  };

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
        const parsedProducts: Product[] = [];
        const data = results.data as string[][];

        for (let i = 1; i < data.length; i++) {
          const row = data[i];
          if (row.length > 4 && row[0] && row[4]) {
            const product: Product = {
              barcode: row[0]?.trim() || '',
              sku: row[4]?.trim() || '',
              name: (row[5]?.trim() || '').split(/[\r\n]/)[0].trim(),
              unit: row[6]?.trim() || '',
              price: parseFloat(row[1]) || 0,   // col B = ราคาของ Barcode นั้น
              category: row[2]?.trim() || 'ทั่วไป',
              rowIndex: i
            };
            if (product.barcode || product.sku) parsedProducts.push(product);
          }
        }

        setUploadStatus(`กำลังอัปโหลด ${parsedProducts.length} รายการ...`);

        // ลบข้อมูลเก่าและใส่ใหม่
        const { error: delError } = await supabase.from('products').delete().neq('id', 0);
        if (delError) { setUploadStatus('เกิดข้อผิดพลาด: ' + delError.message); setIsLoading(false); return; }

        const rows = parsedProducts.map(p => ({ barcode: p.barcode, sku: p.sku, name: p.name, unit: p.unit, price: p.price, category: p.category }));
        const CHUNK = 500;
        for (let i = 0; i < rows.length; i += CHUNK) {
          const { error } = await supabase.from('products').insert(rows.slice(i, i + CHUNK));
          if (error) { setUploadStatus('เกิดข้อผิดพลาด: ' + error.message); setIsLoading(false); return; }
        }

        setUploadStatus(`✅ อัปโหลดสำเร็จ ${parsedProducts.length} รายการ`);
        setIsLoading(false);
        if (event.target) event.target.value = '';
      },
      error: (error) => {
        console.error('Error parsing CSV:', error);
        setUploadStatus('เกิดข้อผิดพลาด: ' + error.message);
        setIsLoading(false);
      }
    });
  };

  const [filteredProducts, setFilteredProducts] = useState<Product[]>([]);

  // Handle search input change
  const handleSearchChange = (value: string) => {
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
        // Exact match for SKU (6 digits)
        const { data, error } = await query.eq('sku', search).limit(30);
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

  const visibleProducts = useMemo(() => {
    //  search term  show only filteredProducts
    if (searchTerm.trim()) {
      return filteredProducts.map((p, i) => ({ ...p, rowIndex: i }));
    }
    // No search term: show scannedHistory (scan mode)
    const map = new Map<string, Product>();
    for (const p of scannedHistory.values()) {
      const key = `${p.sku}-${p.unit}`;
      if (!hiddenKeys.has(key)) map.set(key, p);
    }
    return Array.from(map.values()).map((p, i) => ({ ...p, rowIndex: i }));
  }, [filteredProducts, hiddenKeys, scannedHistory, searchTerm]);

  // Auto-add เมื่อค้นหาด้วย barcode ตรง (เช่น สแกนเนอร์)
  useEffect(() => {
    const search = searchTerm.trim();
    if (!search || filteredProducts.length === 0) return;
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

  const handleSelectAll = useCallback(() => {
    visibleProducts.forEach(p => handleAddToCart(p, rowQty.get(`${p.sku}-${p.unit}`) ?? 1));
  }, [visibleProducts, handleAddToCart, rowQty]);

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
  };

  //  clearAll: cart + search + hidden
  const clearAll = () => {
    setSelectedProducts(new Map());
    setHiddenKeys(new Set());
    setSearchInput('');
    setSearchTerm('');
    setScannedHistory(new Map());
  };

  // Generate barcode
  const generateBarcode = (barcode: string): string => {
    try {
      const canvas = document.createElement('canvas');
      JsBarcode(canvas, barcode, {
        format: 'CODE128',
        width: 2,
        height: 60,
        displayValue: false,
        margin: 0
      });
      return canvas.toDataURL('image/png');
    } catch (error) {
      console.error('Barcode generation error:', error);
      return '';
    }
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

  return (
    <div className="app-container">
      {/* Hero Header */}
      <div className="hero-header">
        <div className="hero-content">
          <h1 className="logo-premium">
            ANIN LABEL AND BARCODE
          </h1>
          <div className="tagline-row">
            {lastUpdated ? (
              <span className="updated-badge">Last Updated : {lastUpdated}</span>
            ) : (
              <span className="updated-badge updated-badge--loading">Loading...</span>
            )}
            </div>
          <div className="search-premium">
            <input
              type="text"
              className="search-input-premium"
              placeholder="Search SKU, Barcode or Name..."
              value={searchInput}
              onChange={(e) => handleSearchChange(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
            <button className="search-btn-premium">🔍</button>
          </div>
        </div>
      </div>

      {/* Main Container */}
      <div className="container">

        {/* Upload CSV hidden input */}
        <input ref={fileInputRef} type="file" accept=".csv" onChange={handleFileUpload} style={{ display: 'none' }} />

        {/* Main split layout */}
        <div className="main-split">
        <div className="single-col">

          <div className="product-table-wrap" style={{ opacity: isLoading ? 0.5 : 1, transition: 'opacity 0.15s' }}>
              <div className="selected-table-header">
                <span>
                  {!searchTerm.trim() && scannedHistory.size > 0 && (
                    <span className="scan-mode-badge"></span>
                  )}
                  {visibleProducts.length} รายการ {totalItems > 0 && `· เลือกแล้ว ${totalItems} (${totalLabels} ป้าย)`}
                </span>
                <div style={{ display: 'flex', gap: '0.5rem', position: 'relative' }}>
                  <div className="cart-dropdown-wrap">
                    {showCart && <div className="cart-overlay" onClick={() => setShowCart(false)} />}
                    <button className="btn-clear-small btn-cart-toggle" onClick={() => setShowCart(v => !v)}>
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
                                      <button className="qty-btn" onClick={() => updateQuantity(k, -1)}>−</button>
                                      <span className="cart-row-qty-num">{p.quantity}</span>
                                      <button className="qty-btn" onClick={() => updateQuantity(k, 1)}>+</button>
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
                  <button className="btn-clear-small btn-cart-toggle" onClick={handleSelectAll}>เลือกทั้งหมด</button>
                  <button className="btn-clear-small btn-cart-toggle" onClick={clearAll}>ลบทั้งหมด</button>
                </div>
              </div>
              <table className="product-table">
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
                        <td>{product.name}</td>
                        <td>{product.unit}</td>
                        <td>฿{product.price.toFixed(2)}</td>
                        <td>
                          <div className="qty-control">
                            <button className="qty-btn" onClick={() => { const cur = rowQty.get(key) ?? 1; if (cur <= 1) { removeProduct(key); } else { setRowQty(prev => { const next = new Map(prev); next.set(key, cur - 1); return next; }); } }}>−</button>
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
                            <button className="qty-btn" onClick={() => setRowQty(prev => { const next = new Map(prev); next.set(key, (prev.get(key) ?? 1) + 1); return next; })}>+</button>
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
                        <div className="lbl-logo">BIGYA</div>
                      </div>
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
                      <div className="lbl-member-section">
                        <div className="lbl-member-labels">
                          <span>Member</span>
                          <span>สมาชิก</span>
                        </div>
                        <div className="lbl-member-value">
                          <span className="lbl-member-int">{Math.ceil(previewPriceProduct.price * 0.95).toLocaleString()}</span>
                        </div>
                        <span className="lbl-baht">บาท</span>
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

      {/* Footer Actions */}
      <div className="footer-actions">
        {totalItems > 0 && (
          <>
            <button className="btn-premium" onClick={handlePrint}>
              🖨️ พิมพ์ป้ายราคา ({totalLabels} ป้าย)
            </button>
            <button className="btn-outline" onClick={() => handlePrintThermal(thermalSettings)}>
              🖨️ พิมพ์บาร์โค้ด
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
                    Upload
                  </button>
                  {uploadStatus && (
                    <div style={{ padding: '0.75rem', background: '#f9f9f9', borderRadius: 8, fontSize: '0.9rem' }}>
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
                      <div className="lbl-logo">BIGYA</div>
                    </div>
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
                    <div className="lbl-member-section">
                      <div className="lbl-member-labels">
                        <span>Member</span>
                        <span>สมาชิก</span>
                      </div>
                      <div className="lbl-member-value">
                        <span className="lbl-member-int">{Math.ceil(product.price * 0.95).toLocaleString()}</span>
                      </div>
                      <span className="lbl-baht">บาท</span>
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
                <div className="lbl-logo">BIGYA</div>
              </div>
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
              <div className="lbl-member-section">
                <div className="lbl-member-labels">
                  <span>Member</span>
                  <span>สมาชิก</span>
                </div>
                <div className="lbl-member-value">
                  <span className="lbl-member-int">{Math.ceil(product.price * 0.95).toLocaleString()}</span>
                </div>
                <span className="lbl-baht">บาท</span>
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
    </div>
  );
};

export default App;
