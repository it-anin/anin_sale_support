/**
 * ตัดสินว่าหน้า Price ต้องเตือน "ตรวจราคาล้มเหลว" หรือไม่ (เพิ่ม 2026-11-18)
 *
 * ที่มา: รอบ 08:00 ของ Price Agent ล้ม (SQL Server ปฏิเสธสิทธิ์อ่านตาราง) แล้วไม่มีใครรู้ —
 * Agent ไม่ลองซ้ำโดยตั้งใจ และหน้าเว็บไม่แสดงอะไร จนพนักงานเห็นว่า popup ราคาเปลี่ยนว่างเปล่า
 *
 * ใช้เฉพาะแถวสถานะ price_sync ที่ usePriceSync อ่านอยู่แล้ว → ไม่เพิ่มคำขอ Supabase
 * ไฟล์นี้ต้องไม่ import อะไร: เทสต์โหลดผ่าน esbuild เป็น data: URL (ดู priceCache.test.mjs)
 */

export interface PriceSyncHealthInput {
  last_error?: string | null;
  last_error_at?: string | null;
  last_checked_at?: string | null;
}

export type PriceSyncProblem =
  /** รอบล่าสุดล้มเหลว — last_error มีค่า (ถูกล้างเมื่อรอบถัดไปสำเร็จ) */
  | { kind: 'error'; since: string | null }
  /** ไม่ได้ตรวจเกินกำหนด — since = เวลาที่ตรวจสำเร็จล่าสุด, null = ไม่เคยตรวจ */
  | { kind: 'stale'; since: string | null };

/**
 * "เกิน 1 วัน" = 25 ชั่วโมง (24 + เผื่อ 1 ชั่วโมง)
 * Agent ตรวจวันละครั้งตอน 08:00 และใช้เวลาไม่กี่วินาที ถ้านับ 24 ชม. เป๊ะ จะมีช่วงสั้น ๆ ราว 08:00
 * ที่เกินกำหนดไปเล็กน้อยก่อนรอบใหม่เสร็จ → เตือนผิด · รอบที่พลาดจริงจะเตือนตอน ~09:00 ของวันถัดไป
 */
export const PRICE_CHECK_STALE_MS = 25 * 60 * 60 * 1000;

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

function parseTime(value: string | null | undefined): number | null {
  if (!value) return null;
  const ms = Date.parse(value);
  return Number.isFinite(ms) ? ms : null;
}

/** null = ปกติ ไม่ต้องเตือน · ยังไม่มีแถวสถานะ (ระบบ Agent ยังไม่ติดตั้ง / ยังไม่โหลด) = ไม่เตือน */
export function evaluatePriceSync(
  row: PriceSyncHealthInput | null | undefined,
  now: number = Date.now(),
): PriceSyncProblem | null {
  if (!row) return null;

  if (typeof row.last_error === 'string' && row.last_error.trim() !== '') {
    return { kind: 'error', since: parseTime(row.last_error_at) === null ? null : row.last_error_at ?? null };
  }

  const checked = parseTime(row.last_checked_at);
  // เวลาในอนาคต (นาฬิกาเครื่องไม่ตรง) ให้ now - checked ติดลบ = ไม่ถือว่าเก่า
  if (checked === null) return { kind: 'stale', since: null };
  if (now - checked > PRICE_CHECK_STALE_MS) return { kind: 'stale', since: row.last_checked_at ?? null };
  return null;
}

/** เทียบก่อน setState — คืนอ็อบเจ็กต์เดิมเมื่อเท่ากัน React จะไม่เรนเดอร์ซ้ำทุกรอบ timer */
export function samePriceSyncProblem(a: PriceSyncProblem | null, b: PriceSyncProblem | null): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  return a.kind === b.kind && a.since === b.since;
}

function formatThaiTime(iso: string): string {
  // medium = "18 พ.ย. 2569 08:56" ตรงกับ popup ราคาเปลี่ยน · short ให้ปีสองหลัก ("18/11/69") กำกวม
  return new Date(iso).toLocaleString('th-TH', { dateStyle: 'medium', timeStyle: 'short', timeZone: 'Asia/Bangkok' });
}

function elapsedText(ms: number): string {
  const days = Math.floor(ms / DAY_MS);
  if (days >= 1) return `${days} วัน`;
  return `${Math.max(1, Math.floor(ms / HOUR_MS))} ชั่วโมง`;
}

/** รายละเอียดสำหรับ tooltip ของแบนเนอร์ — ตัวแบนเนอร์เองแสดงแค่ "ตรวจราคาล้มเหลว" */
export function describePriceSyncProblem(problem: PriceSyncProblem, now: number = Date.now()): string {
  const advice = 'ราคาที่เห็นอาจไม่ใช่ล่าสุด · แจ้งผู้ดูแลระบบ';
  if (problem.kind === 'error') {
    return `รอบตรวจราคาล่าสุดล้มเหลว${problem.since ? ` (${formatThaiTime(problem.since)})` : ''} — ${advice}`;
  }
  const checked = parseTime(problem.since);
  if (checked === null) return `ยังไม่เคยตรวจราคาสำเร็จ — ${advice}`;
  return `ไม่ได้ตรวจราคามาแล้ว ${elapsedText(now - checked)} (ตรวจสำเร็จล่าสุด ${formatThaiTime(problem.since as string)}) — ${advice}`;
}
