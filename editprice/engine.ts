export type SheetRows = unknown[][];
export type PriceLevel = 0 | 1 | 4 | 5;
export type CompareFilter = 'mismatch' | 'all' | 'matched' | 'notfound';
type Amount = number | null;

// ตำแหน่งคอลัมน์ตาม Product Master และ Promaxx ใน PROJECT-OVERVIEW.md
export const PM = { SKU: 0, NAME: 1, BASE_UNIT: 2, UNIT: 9, COST: 10 } as const;
export const PR = { SKU: 1, UNIT: 4, LEVEL: 5, LV0_PRICE: 6, OTHER_PRICE: 7 } as const;
export const PRICE_LEVELS: PriceLevel[] = [0, 1, 4, 5];

export interface ComparisonRow {
  id: string;
  sku: string;
  name: string;
  baseUnit: string;
  unit: string;
  oldCost: Amount;
  newCost: Amount;
  oldPrices: Record<0 | 1 | 5, Amount>;
  newPrices: Record<0 | 1 | 5, Amount>;
}

export interface ComparisonProduct {
  sku: string;
  matched: boolean;
  isMismatch: boolean;
  rows: ComparisonRow[];
}

export interface ComparisonResult {
  products: ComparisonProduct[];
  total: number;
  matched: number;
  mismatched: number;
  notFound: number;
  promaxxRecords: number;
  skippedMissingUnits: MissingMasterUnit[];
}

export interface MissingMasterUnit {
  sku: string;
  name: string;
}

export function findMissingMasterUnits(rows: SheetRows): MissingMasterUnit[] {
  return rows.slice(1).filter(row => cellText(row[PM.SKU]) && !cellText(row[PM.UNIT]))
    .map(row => ({ sku: cellText(row[PM.SKU]), name: cellText(row[PM.NAME]) }));
}

export function cellText(value: unknown): string {
  return String(value ?? '').trim();
}

export function parseNum(value: unknown): Amount {
  const text = cellText(value).replace(/,/g, '');
  if (!text) return null;
  const number = Number(text);
  return Number.isFinite(number) ? number : null;
}

export function formatPrice(value: Amount): string {
  return value === null ? '-' : value.toLocaleString('en-US', {
    minimumFractionDigits: 2, maximumFractionDigits: 2,
  });
}

function sameValue(a: Amount, b: Amount): boolean {
  return a === null || b === null ? a === b : Math.abs(a - b) <= 0.001;
}

function costRatio(newCost: Amount, oldCost: Amount, price: Amount): Amount {
  if (newCost === null || oldCost === null || oldCost === 0 || price === null) return null;
  const value = (newCost / oldCost) * price;
  return Number.isFinite(value) ? value : null;
}

export function compareSheets(masterRows: SheetRows, promaxxRows: SheetRows, options: { skipMissingUnits?: boolean } = {}): ComparisonResult {
  if (masterRows.length < 2 || (masterRows[0]?.length ?? 0) <= PM.COST) {
    throw new Error('Product Master ต้องมีหัวตารางและข้อมูลถึงคอลัมน์ K (ทุนใหม่)');
  }
  if (promaxxRows.length < 2 || (promaxxRows[0]?.length ?? 0) <= PR.OTHER_PRICE) {
    throw new Error('R05.105 ต้องมีหัวตารางและข้อมูลถึงคอลัมน์ H');
  }

  const oldProducts = new Map<string, Map<string, Record<PriceLevel, Amount>>>();
  let promaxxRecords = 0;
  for (const row of promaxxRows.slice(1)) {
    const sku = cellText(row[PR.SKU]);
    const unit = cellText(row[PR.UNIT]);
    if (!sku) continue;
    promaxxRecords++;
    const level = parseNum(row[PR.LEVEL]);
    if (!unit || level === null || !PRICE_LEVELS.includes(level as PriceLevel)) continue;
    let units = oldProducts.get(sku);
    if (!units) { units = new Map(); oldProducts.set(sku, units); }
    let prices = units.get(unit);
    if (!prices) { prices = { 0: null, 1: null, 4: null, 5: null }; units.set(unit, prices); }
    prices[level as PriceLevel] = parseNum(row[level === 0 ? PR.LV0_PRICE : PR.OTHER_PRICE]);
  }
  if (oldProducts.size === 0) {
    throw new Error('ไม่พบข้อมูล R05.105 ที่มี SKU (B), หน่วย (E) และระดับราคา 0/1/4/5 (F)');
  }

  const products: ComparisonProduct[] = [];
  const skippedMissingUnits: MissingMasterUnit[] = [];
  const masterSkus = new Set<string>();
  for (const [index, row] of masterRows.slice(1).entries()) {
    const sku = cellText(row[PM.SKU]);
    if (!sku) continue;
    const sourceUnit = cellText(row[PM.UNIT]);
    if (!sourceUnit) {
      if (options.skipMissingUnits) {
        skippedMissingUnits.push({ sku, name: cellText(row[PM.NAME]) });
        continue;
      }
      throw new Error(`Product Master แถว ${index + 2} (SKU ${sku}) ไม่มีหน่วยในคอลัมน์ J`);
    }
    if (masterSkus.has(sku)) {
      throw new Error(`Product Master มี SKU ${sku} ซ้ำที่แถว ${index + 2} กรุณาให้เหลือทุนใหม่หนึ่งรายการต่อ SKU`);
    }
    masterSkus.add(sku);
    const newCost = parseNum(row[PM.COST]);
    const oldUnits = oldProducts.get(sku);
    const referenceOldCost = oldUnits?.get(sourceUnit)?.[4] ?? null;
    const unitNames = new Set(oldUnits?.keys());
    unitNames.add(sourceUnit);
    const rows: ComparisonRow[] = Array.from(unitNames, unit => {
      const old = oldUnits?.get(unit);
      const oldCost = old?.[4] ?? null;
      const newCostUnit = unit === sourceUnit ? newCost : costRatio(newCost, referenceOldCost, oldCost);
      const oldPrices = { 0: old?.[0] ?? null, 1: old?.[1] ?? null, 5: old?.[5] ?? null };
      const newPrices = { 0: null, 1: null, 5: null } as ComparisonRow['newPrices'];
      for (const level of [0, 1, 5] as const) {
        const price = costRatio(newCostUnit, oldCost, oldPrices[level]);
        newPrices[level] = price === null ? null : Math.round(price);
      }
      return {
        id: JSON.stringify([sku, unit]), sku, name: cellText(row[PM.NAME]),
        baseUnit: cellText(row[PM.BASE_UNIT]), unit, oldCost, newCost: newCostUnit,
        oldPrices, newPrices,
      };
    });
    products.push({
      sku, matched: !!oldUnits,
      isMismatch: !!oldUnits && rows.some(unit =>
        ([0, 1, 5] as const).some(level => !sameValue(unit.oldPrices[level], unit.newPrices[level]))),
      rows,
    });
  }
  if (products.length === 0) throw new Error(skippedMissingUnits.length
    ? 'ไม่มีรายการที่มีหน่วยในคอลัมน์ J สำหรับเปรียบเทียบ กรุณาแก้ไขไฟล์ Product Master'
    : 'ไม่พบรหัสสินค้าในคอลัมน์ A ของ Product Master');
  const matched = products.filter(product => product.matched).length;
  return {
    products, total: products.length, matched,
    mismatched: products.filter(product => product.isMismatch).length,
    notFound: products.length - matched, promaxxRecords, skippedMissingUnits,
  };
}

export function filterRows(result: ComparisonResult, filter: CompareFilter, search: string): ComparisonRow[] {
  const query = search.trim().toLocaleLowerCase();
  return result.products.filter(product => {
    if (filter === 'mismatch') return product.isMismatch;
    if (filter === 'matched') return product.matched && !product.isMismatch;
    if (filter === 'notfound') return !product.matched;
    return true;
  }).flatMap(product => product.rows).filter(row =>
    !query || [row.sku, row.name, row.unit].some(value => value.toLocaleLowerCase().includes(query)));
}

export function priceAtLevel(row: ComparisonRow, level: PriceLevel, kind: 'old' | 'new'): Amount {
  return level === 4 ? (kind === 'old' ? row.oldCost : row.newCost)
    : (kind === 'old' ? row.oldPrices[level] : row.newPrices[level]);
}

export interface ExportOptions {
  unit?: string;
  baseUnitOnly?: boolean;
}

export function posExportRows(rows: ComparisonRow[], level: PriceLevel, options: ExportOptions = {}): ComparisonRow[] {
  return rows.filter(row => row.newCost !== null && row.oldCost !== null && row.newCost > row.oldCost
    && (options.unit === undefined || row.unit === options.unit)
    && (!options.baseUnitOnly || row.unit === row.baseUnit)
    && priceAtLevel(row, level, 'new') !== null);
}

export function buildPosText(rows: ComparisonRow[], level: PriceLevel, options: ExportOptions = {}): string {
  const lines = posExportRows(rows, level, options).map(row =>
    `${row.sku}\t${formatPrice(priceAtLevel(row, level, 'new'))}\t${level}`);
  return lines.length ? '\uFEFF' + lines.join('\r\n') + '\r\n' : '';
}

export function reportRows(rows: ComparisonRow[]) {
  return rows.map(row => ({
    'รหัสสินค้า': row.sku, 'ชื่อสินค้า': row.name, 'หน่วย': row.unit,
    'ทุนเก่า': row.oldCost, 'ทุนใหม่': row.newCost,
    'ราคาระดับ 0 ใหม่': row.newPrices[0], 'ราคาระดับ 0 เก่า': row.oldPrices[0],
    'ราคาระดับ 1 ใหม่': row.newPrices[1], 'ราคาระดับ 1 เก่า': row.oldPrices[1],
    'ราคาระดับ 5 ใหม่': row.newPrices[5], 'ราคาระดับ 5 เก่า': row.oldPrices[5],
  }));
}
